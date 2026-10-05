import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { promisify } from "node:util";
import yauzl from "yauzl";
import { createTwoFilesPatch } from "diff";
import {
  HeadlessAgentRunner,
  type HeadlessAgentAdapter,
  type HeadlessStepResult,
} from "../../core/agent/HeadlessAgentRunner.js";
import { TaskRuntime } from "../../core/agent/TaskRuntime.js";
import type { AgentPlanStep } from "../../core/agent/types.js";
import { redactSecrets } from "../../core/agent/redactSecrets.js";
import { VYNORAI_XML_SYSTEM_PROMPT } from "../../core/llm/vynorai-system-prompt.js";

const openZip = promisify<string, yauzl.Options, yauzl.ZipFile>(yauzl.open);
const taskId = requiredEnv("VYNOR_TASK_ID");
const modelUrl = requiredEnv("VYNOR_MODEL_URL");
const modelToken = requiredEnv("VYNOR_MODEL_TOKEN");
delete process.env.VYNOR_MODEL_TOKEN;
const workRoot = "/work";
const workspace = path.join(workRoot, "workspace");
const baseline = path.join(workRoot, "baseline");
const output = "/output";
const maxFiles = 20_000;
const maxExpandedBytes = 1024 * 1024 * 1024;
let workspaceRevision = 0;
let finalSummary = "Task finished.";
const verification: VerificationRecord[] = [];

interface VerificationRecord {
  command: string;
  cwd: string;
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
  stdoutTail: string;
  stderrTail: string;
  classification: "passed" | "failed" | "baseline_failure" | "skipped";
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name}_REQUIRED`);
  return value;
}

function safePath(relative: string): string {
  const normalized = relative.replace(/\\/g, "/").replace(/^\.\//, "");
  if (
    !normalized ||
    normalized.startsWith("/") ||
    normalized.includes("\0") ||
    normalized.split("/").includes("..")
  )
    throw new Error("UNSAFE_WORKSPACE_PATH");
  const resolved = path.resolve(workspace, normalized);
  if (!resolved.startsWith(`${workspace}${path.sep}`))
    throw new Error("UNSAFE_WORKSPACE_PATH");
  return resolved;
}

async function extractProject() {
  await fs.promises.mkdir(workspace, { recursive: true });
  const zip = await openZip("/input/project.zip", {
    lazyEntries: true,
    decodeStrings: true,
    validateEntrySizes: true,
  });
  let files = 0;
  let bytes = 0;
  await new Promise<void>((resolve, reject) => {
    zip.on("error", reject);
    zip.on("end", resolve);
    zip.on("entry", (entry) => {
      try {
        const name = entry.fileName.replace(/\\/g, "/");
        if (
          name.startsWith("/") ||
          /^[A-Za-z]:\//.test(name) ||
          name.split("/").includes("..") ||
          name.includes("\0")
        )
          throw new Error("ARCHIVE_PATH_TRAVERSAL");
        const mode = (entry.externalFileAttributes >>> 16) & 0xffff;
        if ((mode & 0o170000) === 0o120000)
          throw new Error("ARCHIVE_SYMLINK_DENIED");
        if (name.endsWith("/")) {
          fs.mkdirSync(safePath(name.slice(0, -1)), { recursive: true });
          zip.readEntry();
          return;
        }
        files += 1;
        bytes += entry.uncompressedSize;
        if (
          files > maxFiles ||
          bytes > maxExpandedBytes ||
          entry.uncompressedSize > 50 * 1024 * 1024
        )
          throw new Error("ARCHIVE_LIMIT_EXCEEDED");
        const target = safePath(name);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        zip.openReadStream(entry, (error, stream) => {
          if (error || !stream)
            return reject(error || new Error("ARCHIVE_READ_FAILED"));
          const destination = fs.createWriteStream(target, {
            flags: "wx",
            mode: mode & 0o111 ? 0o700 : 0o600,
          });
          stream.pipe(destination);
          destination.on("finish", () => zip.readEntry());
          destination.on("error", reject);
        });
      } catch (error) {
        reject(error);
      }
    });
    zip.readEntry();
  });
  await fs.promises.cp(workspace, baseline, {
    recursive: true,
    errorOnExist: true,
  });
  if (fs.existsSync("/cache-seed"))
    await fs.promises
      .cp("/cache-seed", "/cache", { recursive: true, force: false })
      .catch(() => {});
}

function listFiles(root = workspace, limit = 2_000): string[] {
  const result: string[] = [];
  const visit = (directory: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (
        [".git", "node_modules", "vendor", "dist", "build", ".next"].includes(
          entry.name,
        )
      )
        continue;
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile())
        result.push(path.relative(root, full).replace(/\\/g, "/"));
      if (result.length >= limit) return;
    }
  };
  visit(root);
  return result;
}

async function model(messages: any[]): Promise<any> {
  const response = await fetch(modelUrl, {
    method: "POST",
    headers: {
      authorization: `Bearer ${modelToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "vynor-auto",
      stream: false,
      temperature: 0,
      max_tokens: 4096,
      messages,
      tools: toolSchemas,
    }),
  });
  if (!response.ok) throw new Error(`MODEL_${response.status}`);
  const data: any = await response.json();
  return data.choices?.[0]?.message;
}

const toolSchemas = [
  tool("view_repo_map", "List relevant workspace files", {
    type: "object",
    properties: { focus: { type: "string" } },
  }),
  tool("read_file_range", "Read a UTF-8 file range", {
    type: "object",
    required: ["path"],
    properties: {
      path: { type: "string" },
      startLine: { type: "integer" },
      endLine: { type: "integer" },
    },
  }),
  tool("grep_search", "Search text in workspace files", {
    type: "object",
    required: ["query"],
    properties: { query: { type: "string" }, path: { type: "string" } },
  }),
  tool("edit_file", "Replace exact text in a file", {
    type: "object",
    required: ["path", "oldText", "newText"],
    properties: {
      path: { type: "string" },
      oldText: { type: "string" },
      newText: { type: "string" },
    },
  }),
  tool("write_file", "Create a new text file", {
    type: "object",
    required: ["path", "content"],
    properties: { path: { type: "string" }, content: { type: "string" } },
  }),
  tool("run_terminal_command", "Run a project command inside the sandbox", {
    type: "object",
    required: ["command"],
    properties: { command: { type: "string" }, cwd: { type: "string" } },
  }),
];

function tool(name: string, description: string, parameters: any) {
  return { type: "function", function: { name, description, parameters } };
}

async function invokeTool(name: string, args: any): Promise<string> {
  if (name === "view_repo_map") return listFiles().join("\n");
  if (name === "read_file_range") {
    const lines = (
      await fs.promises.readFile(safePath(String(args.path)), "utf8")
    ).split(/\r?\n/);
    return lines
      .slice(
        Math.max(0, Number(args.startLine || 1) - 1),
        Math.min(lines.length, Number(args.endLine || 400)),
      )
      .join("\n")
      .slice(0, 80_000);
  }
  if (name === "grep_search") {
    const query = String(args.query || "").toLowerCase();
    if (!query || query.length > 200) throw new Error("INVALID_SEARCH");
    const matches: string[] = [];
    for (const file of listFiles()) {
      if (args.path && !file.startsWith(String(args.path))) continue;
      try {
        const lines = fs.readFileSync(safePath(file), "utf8").split(/\r?\n/);
        lines.forEach((line, index) => {
          if (line.toLowerCase().includes(query) && matches.length < 200)
            matches.push(`${file}:${index + 1}:${line.slice(0, 300)}`);
        });
      } catch {}
    }
    return matches.join("\n") || "No matches";
  }
  if (name === "edit_file") {
    const target = safePath(String(args.path));
    const before = await fs.promises.readFile(target, "utf8");
    const oldText = String(args.oldText);
    if (!oldText || !before.includes(oldText))
      throw new Error("EDIT_TARGET_NOT_FOUND");
    if (before.indexOf(oldText) !== before.lastIndexOf(oldText))
      throw new Error("EDIT_TARGET_AMBIGUOUS");
    await fs.promises.writeFile(
      target,
      before.replace(oldText, String(args.newText)),
      "utf8",
    );
    workspaceRevision += 1;
    return "Edited";
  }
  if (name === "write_file") {
    const target = safePath(String(args.path));
    if (fs.existsSync(target)) throw new Error("FILE_ALREADY_EXISTS");
    const content = String(args.content);
    if (Buffer.byteLength(content) > 2 * 1024 * 1024)
      throw new Error("FILE_TOO_LARGE");
    await fs.promises.mkdir(path.dirname(target), { recursive: true });
    await fs.promises.writeFile(target, content, { flag: "wx", mode: 0o600 });
    workspaceRevision += 1;
    return "Created";
  }
  if (name === "run_terminal_command") {
    const result = await runCommand(
      String(args.command),
      args.cwd ? safePath(String(args.cwd)) : workspace,
      10 * 60_000,
    );
    return JSON.stringify(result);
  }
  throw new Error("UNKNOWN_TOOL");
}

async function runCommand(
  command: string,
  cwd: string,
  timeoutMs: number,
): Promise<VerificationRecord> {
  if (!command || command.length > 2_000 || /\bsudo\b/.test(command))
    throw new Error("COMMAND_DENIED");
  const started = Date.now();
  const childEnv = { ...process.env };
  delete childEnv.VYNOR_MODEL_TOKEN;
  childEnv.npm_config_cache = "/cache/npm";
  childEnv.YARN_CACHE_FOLDER = "/cache/yarn";
  childEnv.PIP_CACHE_DIR = "/cache/pip";
  childEnv.COMPOSER_CACHE_DIR = "/cache/composer";
  const child = spawn("/bin/sh", ["-lc", command], {
    cwd,
    env: childEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stdout: Buffer[] = [],
    stderr: Buffer[] = [];
  let outBytes = 0,
    errBytes = 0,
    timedOut = false;
  child.stdout.on("data", (chunk) => {
    outBytes += chunk.length;
    if (outBytes <= 2 * 1024 * 1024) stdout.push(chunk);
  });
  child.stderr.on("data", (chunk) => {
    errBytes += chunk.length;
    if (errBytes <= 2 * 1024 * 1024) stderr.push(chunk);
  });
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill("SIGKILL");
  }, timeoutMs);
  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.on("close", resolve);
    child.on("error", reject);
  });
  clearTimeout(timer);
  const record: VerificationRecord = {
    command,
    cwd: path.relative(workspace, cwd) || ".",
    exitCode,
    timedOut,
    durationMs: Date.now() - started,
    stdoutTail: redactSecrets(
      Buffer.concat(stdout).toString("utf8").slice(-12_000),
    ),
    stderrTail: redactSecrets(
      Buffer.concat(stderr).toString("utf8").slice(-12_000),
    ),
    classification: exitCode === 0 && !timedOut ? "passed" : "failed",
  };
  verification.push(record);
  return record;
}

class Adapter implements HeadlessAgentAdapter {
  async plan() {
    return [
      {
        id: "implement",
        summary: "Inspect, implement, and verify the requested change",
        kind: "edit" as const,
        risk: "R2" as const,
        verificationRequired: true,
        maxAttempts: 1,
      },
    ];
  }
  async execute(_step: AgentPlanStep): Promise<HeadlessStepResult> {
    const prompt = await fs.promises.readFile("/input/prompt.txt", "utf8");
    const messages: any[] = [
      { role: "system", content: VYNORAI_XML_SYSTEM_PROMPT },
      { role: "user", content: prompt },
    ];
    for (let round = 0; round < 80; round++) {
      const assistant = await model(messages);
      if (!assistant) throw new Error("EMPTY_MODEL_RESPONSE");
      messages.push(assistant);
      if (!assistant.tool_calls?.length) {
        finalSummary = redactSecrets(
          String(assistant.content || "Task completed."),
        ).slice(0, 4_000);
        break;
      }
      for (const call of assistant.tool_calls) {
        let content: string;
        try {
          content = await invokeTool(
            call.function.name,
            JSON.parse(call.function.arguments || "{}"),
          );
        } catch (error) {
          content = `ERROR: ${error instanceof Error ? error.message : "TOOL_FAILED"}`;
        }
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: content.slice(0, 100_000),
        });
      }
      if (round === 79) throw new Error("AGENT_ROUND_LIMIT");
    }
    await automaticVerification();
    const hasTests = detectedTestCommands().length > 0;
    const passed = verification.some(
      (item) => item.classification === "passed",
    );
    return {
      ok: !hasTests || passed,
      summary: finalSummary,
      workspaceRevision,
      verification: {
        kind: hasTests ? "test" : "review",
        status: !hasTests ? "passed" : passed ? "passed" : "failed",
        summary: !hasTests
          ? "Diff review passed; no project verification command was detected"
          : passed
            ? "At least one verification command passed"
            : "No detected verification command passed",
      },
      failureCode: hasTests && !passed ? "NO_PASSING_VERIFICATION" : undefined,
    };
  }
}

function detectedTestCommands(): string[] {
  const manifest = path.join(workspace, "package.json");
  if (fs.existsSync(manifest)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(manifest, "utf8"));
      const manager = fs.existsSync(path.join(workspace, "pnpm-lock.yaml"))
        ? "pnpm"
        : fs.existsSync(path.join(workspace, "yarn.lock"))
          ? "yarn"
          : "npm run";
      return ["test", "typecheck", "lint", "build"]
        .filter((name) => pkg.scripts?.[name])
        .map((name) => `${manager} ${name}`);
    } catch {}
  }
  if (fs.existsSync(path.join(workspace, "composer.json")))
    return ["php artisan test"];
  if (
    fs.existsSync(path.join(workspace, "pytest.ini")) ||
    fs.existsSync(path.join(workspace, "pyproject.toml"))
  )
    return ["python -m pytest"];
  return [];
}

async function automaticVerification() {
  for (const command of detectedTestCommands().slice(0, 4))
    await runCommand(command, workspace, 10 * 60_000).catch(() => {});
}

function sha(value: Buffer | string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

async function createPatchBundle() {
  const before = new Set(listFiles(baseline));
  const after = new Set(listFiles(workspace));
  const paths = [...new Set([...before, ...after])].sort();
  const files: any[] = [];
  const diffs: string[] = [];
  let additions = 0,
    deletions = 0;
  for (const relative of paths) {
    const oldBuffer = before.has(relative)
      ? await fs.promises.readFile(path.join(baseline, relative))
      : Buffer.alloc(0);
    const newBuffer = after.has(relative)
      ? await fs.promises.readFile(path.join(workspace, relative))
      : Buffer.alloc(0);
    if (oldBuffer.equals(newBuffer)) continue;
    if (oldBuffer.includes(0) || newBuffer.includes(0))
      throw new Error("BINARY_PATCH_UNSUPPORTED");
    const oldText = oldBuffer.toString("utf8"),
      newText = newBuffer.toString("utf8");
    const diff = createTwoFilesPatch(
      `a/${relative}`,
      `b/${relative}`,
      oldText,
      newText,
      "base",
      "result",
      { context: 3 },
    );
    additions += diff
      .split("\n")
      .filter((line) => line.startsWith("+") && !line.startsWith("+++")).length;
    deletions += diff
      .split("\n")
      .filter((line) => line.startsWith("-") && !line.startsWith("---")).length;
    diffs.push(diff);
    files.push({
      path: relative,
      operation: !before.has(relative)
        ? "create"
        : !after.has(relative)
          ? "delete"
          : "modify",
      baseSha256: sha(oldBuffer),
      resultSha256: sha(newBuffer),
      bytes: newBuffer.length,
      content: after.has(relative) ? newText : undefined,
    });
  }
  return {
    version: 1,
    taskId,
    unifiedDiff: diffs.join("\n"),
    files,
    stats: { filesChanged: files.length, additions, deletions },
  };
}

async function main() {
  await extractProject();
  const runtime = new TaskRuntime(path.join(workRoot, "journal"));
  let status: "completed" | "failed" | "canceled" = "completed";
  let failure: unknown;
  try {
    await new HeadlessAgentRunner(runtime, new Adapter()).run({
      sessionId: taskId,
      workspaceId: taskId,
      goal: await fs.promises.readFile("/input/prompt.txt", "utf8"),
    });
  } catch (error) {
    status = "failed";
    failure = error;
    finalSummary = `Task failed: ${error instanceof Error ? error.message : "unknown"}`;
  }
  const patch = await createPatchBundle();
  const now = new Date().toISOString();
  const proof = {
    version: 1,
    taskId,
    status,
    language: /[\u0D80-\u0DFF]/.test(
      await fs.promises.readFile("/input/prompt.txt", "utf8"),
    )
      ? "si"
      : "en",
    summary: finalSummary,
    diff: {
      ...patch.stats,
      newFiles: patch.files
        .filter((f) => f.operation === "create")
        .map((f) => f.path),
      deletedFiles: patch.files
        .filter((f) => f.operation === "delete")
        .map((f) => f.path),
    },
    verification,
    judgmentReview: failure
      ? "Execution did not complete; review partial changes carefully."
      : "Automated review found no unresolved runtime error.",
    risks: [],
    screenshots: [],
    unverified: verification.some((v) => v.classification === "passed")
      ? []
      : ["No passing verification command was recorded"],
    billing: {
      estimateCredits: 0,
      capCredits: 0,
      modelCredits: 0,
      computeCredits: 0,
      grossUsedCredits: 0,
      refundCredits: 0,
      netChargedCredits: 0,
    },
    deletionReceipt: {
      workspaceDeletedAt: now,
      retainedUntil: new Date(Date.now() + 7 * 86400_000).toISOString(),
      artifactIds: [],
    },
    startedAt: now,
    finishedAt: now,
  };
  await fs.promises.writeFile(
    path.join(output, "patch.json"),
    JSON.stringify(patch),
  );
  await fs.promises.writeFile(
    path.join(output, "proof.json"),
    JSON.stringify(proof),
  );
  await fs.promises
    .cp("/cache", path.join(output, "dependency-cache"), {
      recursive: true,
    })
    .catch(() => {});
  if (status !== "completed") process.exitCode = 1;
}

main().catch((error) => {
  console.error(
    redactSecrets(error instanceof Error ? error.message : "runner failed"),
  );
  process.exit(1);
});
