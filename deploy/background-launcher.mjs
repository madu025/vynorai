#!/usr/bin/env node
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";

const socketPath =
  process.env.BG_LAUNCHER_SOCKET || "/run/vynor-bg/launcher.sock";
const stagingRoot = path.resolve(
  process.env.BG_STAGING_DIR || "/var/lib/vynor-background/staging",
);
const runnerImage =
  process.env.BG_RUNNER_IMAGE || "vynor-background-runner:local";
const cacheRoot = path.resolve(
  process.env.BG_CACHE_DIR || "/var/lib/vynor-background/cache",
);
const active = new Map();

function insideStaging(candidate, taskId) {
  const taskRoot = path.join(stagingRoot, taskId);
  const resolved = path.resolve(candidate);
  return resolved.startsWith(`${taskRoot}${path.sep}`) && resolved !== taskRoot;
}

function validRequest(body) {
  return (
    body?.version === 1 &&
    /^[0-9a-f-]{36}$/i.test(body.taskId) &&
    insideStaging(body.inputArchive, body.taskId) &&
    insideStaging(body.outputDirectory, body.taskId) &&
    body.limits?.runtimeSeconds > 0 &&
    body.limits.runtimeSeconds <= 2700 &&
    body.limits?.memoryMb > 0 &&
    body.limits.memoryMb <= 1536 &&
    body.limits?.cpus > 0 &&
    body.limits.cpus <= 1 &&
    body.limits?.pids > 0 &&
    body.limits.pids <= 512 &&
    body.limits?.diskMb > 0 &&
    body.limits.diskMb <= 2048 &&
    /^http:\/\/vynor-bg-egress:8080\/model\/v1\/chat\/completions$/.test(
      body.modelRelayUrl,
    ) &&
    typeof body.modelToken === "string" &&
    body.modelToken.length < 4096 &&
    /^[a-f0-9]{64}$/.test(body.cacheKey)
  );
}

function docker(args) {
  return new Promise((resolve) => {
    const child = spawn("docker", args, { stdio: ["ignore", "pipe", "pipe"] });
    const stderr = [];
    let bytes = 0;
    child.stderr.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes <= 16_384) stderr.push(chunk);
    });
    child.on("close", (code) =>
      resolve({
        code,
        stderr: Buffer.concat(stderr).toString("utf8").slice(-4000),
      }),
    );
    child.on("error", (error) => resolve({ code: 127, stderr: error.message }));
  });
}

async function runSandbox(body) {
  const name = `vynor-bg-${body.taskId}`;
  const startedAt = new Date().toISOString();
  fs.mkdirSync(body.outputDirectory, { recursive: true, mode: 0o700 });
  fs.mkdirSync(cacheRoot, { recursive: true, mode: 0o700 });
  const seed = path.join(cacheRoot, body.cacheKey);
  const args = [
    "run",
    "--name",
    name,
    "--runtime=runsc",
    "--network=vynor-bg-sandbox",
    "--read-only",
    "--cap-drop=ALL",
    "--security-opt=no-new-privileges:true",
    `--memory=${body.limits.memoryMb}m`,
    `--cpus=${body.limits.cpus}`,
    `--pids-limit=${body.limits.pids}`,
    "--user=65532:65532",
    `--tmpfs=/work:rw,noexec,nosuid,nodev,size=${body.limits.diskMb}m,uid=65532,gid=65532`,
    "--tmpfs=/tmp:rw,noexec,nosuid,nodev,size=128m,uid=65532,gid=65532",
    "--tmpfs=/output:rw,noexec,nosuid,nodev,size=320m,uid=65532,gid=65532",
    "--tmpfs=/cache:rw,noexec,nosuid,nodev,size=256m,uid=65532,gid=65532",
    `--mount=type=bind,src=${path.resolve(body.inputArchive)},dst=/input/project.zip,readonly`,
    `--mount=type=bind,src=${path.resolve(path.join(path.dirname(body.inputArchive), "prompt.txt"))},dst=/input/prompt.txt,readonly`,
    `--env=VYNOR_TASK_ID=${body.taskId}`,
    `--env=VYNOR_MODEL_URL=${body.modelRelayUrl}`,
    `--env=VYNOR_MODEL_TOKEN=${body.modelToken}`,
    "--env=HTTP_PROXY=http://vynor-bg-egress:8080",
    "--env=HTTPS_PROXY=http://vynor-bg-egress:8080",
    "--env=NO_PROXY=vynor-bg-egress,localhost,127.0.0.1",
    runnerImage,
  ];
  if (fs.existsSync(seed))
    args.splice(
      args.length - 1,
      0,
      `--mount=type=bind,src=${seed},dst=/cache-seed,readonly`,
    );
  const operation = { name, canceled: false };
  active.set(body.taskId, operation);
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    void docker(["kill", name]);
  }, body.limits.runtimeSeconds * 1000);
  const result = await docker(args);
  clearTimeout(timer);
  active.delete(body.taskId);
  if (result.code !== 127) {
    await docker(["cp", `${name}:/output/.`, body.outputDirectory]);
    await promoteCache(
      path.join(body.outputDirectory, "dependency-cache"),
      seed,
    );
  }
  await docker(["rm", "-f", name]);
  return {
    exitCode: result.code,
    reason: operation.canceled
      ? "canceled"
      : timedOut
        ? "timeout"
        : result.code === 0
          ? "completed"
          : "sandbox_error",
    timedOut,
    startedAt,
    finishedAt: new Date().toISOString(),
    workspaceDeletedAt: new Date().toISOString(),
  };
}

function directorySize(directory) {
  if (!fs.existsSync(directory)) return 0;
  let total = 0;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    total += entry.isDirectory()
      ? directorySize(target)
      : entry.isFile()
        ? fs.statSync(target).size
        : 0;
  }
  return total;
}

async function promoteCache(source, target) {
  if (!fs.existsSync(source)) return;
  const size = directorySize(source);
  if (size <= 0 || size > 256 * 1024 * 1024) return;
  if (!target.startsWith(`${cacheRoot}${path.sep}`))
    throw new Error("INVALID_CACHE_TARGET");
  if (!fs.existsSync(target)) fs.renameSync(source, target);
  fs.utimesSync(target, new Date(), new Date());
  const entries = fs
    .readdirSync(cacheRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^[a-f0-9]{64}$/.test(entry.name))
    .map((entry) => ({
      path: path.join(cacheRoot, entry.name),
      mtime: fs.statSync(path.join(cacheRoot, entry.name)).mtimeMs,
    }))
    .sort((a, b) => a.mtime - b.mtime);
  let total = entries.reduce(
    (sum, entry) => sum + directorySize(entry.path),
    0,
  );
  const limit = Number(process.env.BG_CACHE_MAX_GB || 20) * 1024 * 1024 * 1024;
  for (const entry of entries) {
    if (total <= limit) break;
    const bytes = directorySize(entry.path);
    fs.rmSync(entry.path, { recursive: true, force: true });
    total -= bytes;
  }
}

const server = http.createServer((req, res) => {
  if (req.method === "POST" && req.url === "/v1/run") {
    const chunks = [];
    let bytes = 0;
    req.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > 32_768) req.destroy();
      else chunks.push(chunk);
    });
    req.on("end", async () => {
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        if (!validRequest(body) || active.has(body.taskId))
          throw new Error("INVALID_LAUNCH_REQUEST");
        const result = await runSandbox(body);
        res
          .writeHead(200, { "content-type": "application/json" })
          .end(JSON.stringify(result));
      } catch (error) {
        res
          .writeHead(400, { "content-type": "application/json" })
          .end(JSON.stringify({ error: error.message }));
      }
    });
    return;
  }
  const cancel =
    req.method === "POST" &&
    req.url?.match(/^\/v1\/tasks\/([0-9a-f-]{36})\/cancel$/i);
  if (cancel) {
    const operation = active.get(cancel[1]);
    if (!operation) return res.writeHead(404).end();
    operation.canceled = true;
    void docker(["kill", operation.name]);
    return res.writeHead(200).end();
  }
  res.writeHead(404).end();
});

fs.mkdirSync(path.dirname(socketPath), { recursive: true, mode: 0o750 });
try {
  fs.unlinkSync(socketPath);
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
server.listen(socketPath, () => {
  fs.chmodSync(socketPath, 0o666);
  console.log(`[BackgroundLauncher] listening on ${socketPath}`);
});
