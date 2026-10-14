/**
 * Bridges one deterministic evidence fixture to the real VS Code benchmark
 * driver. It prepares an isolated workspace, then scores the state left by
 * extensions/vscode/e2e/tests/LargeTask.test.ts without retaining reply text.
 *
 * Usage:
 *   node scripts/bench/evidence-live.mjs prepare ev-simple-boundary <run-dir>
 *   node scripts/bench/evidence-live.mjs score <run-dir>
 */
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup, evaluate, makeFixture } from "./lib.mjs";
import { EVIDENCE_TASKS } from "./evidence-tasks.mjs";

const [, , command, idOrDir, maybeDir] = process.argv;
const digest = (text) =>
  crypto
    .createHash("sha256")
    .update(text ?? "")
    .digest("hex");
const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const canonicalVsix = path.join(
  repoRoot,
  "extensions",
  "vscode",
  "build",
  "vynorai-1.2.66.vsix",
);

function commandText(command) {
  try {
    return execFileSync(command[0], command.slice(1), {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

function fileDigest(file) {
  try {
    return digest(fs.readFileSync(file));
  } catch {
    return null;
  }
}

function walkJson(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkJson(file));
    else if (
      entry.isFile() &&
      entry.name.endsWith(".json") &&
      entry.name !== "sessions.json"
    )
      out.push(file);
  }
  return out;
}

function responseProvenance(saved, driver) {
  const profileDir = path.resolve(
    driver?.globalDir ??
      process.env.CONTINUE_GLOBAL_DIR ??
      path.join(repoRoot, "extensions", "vscode", "e2e", "live-continue"),
  );
  const sessions = path.join(profileDir, "sessions", "accounts");
  const matches = [];
  for (const file of walkJson(sessions)) {
    try {
      const session = JSON.parse(fs.readFileSync(file, "utf8"));
      let workspace = "";
      try {
        workspace = session.workspaceDirectory
          ? path.resolve(fileURLToPath(session.workspaceDirectory))
          : "";
      } catch {
        workspace = "";
      }
      if (workspace.toLowerCase() !== path.resolve(saved.dir).toLowerCase())
        continue;
      const history = Array.isArray(session.history) ? session.history : [];
      const served = history.flatMap((item) => {
        const value = item?.message?.metadata?.vynorServed;
        return value?.model
          ? [{ model: value.model, tier: value.tier ?? null }]
          : [];
      });
      if (served.length)
        matches.push({ file, mtime: fs.statSync(file).mtimeMs, served });
    } catch {
      // A partially-written session is not provenance evidence.
    }
  }
  const latest = matches.sort((a, b) => b.mtime - a.mtime)[0];
  const models = [...new Set((latest?.served ?? []).map((item) => item.model))];
  const tiers = [
    ...new Set((latest?.served ?? []).map((item) => item.tier).filter(Boolean)),
  ];
  return {
    // Keep local profile paths out of committed evidence and reports.
    source: latest ? "session-metadata" : null,
    responseModels: models,
    responseTiers: tiers,
    valid: models.length > 0,
  };
}

function reproducibilityManifest(saved, driver) {
  const response = responseProvenance(saved, driver);
  const installed = path.join(
    repoRoot,
    "extensions",
    "vscode",
    "e2e",
    ".test-extensions",
    "vynorai.vynorai-1.2.66",
    "package.json",
  );
  return {
    schemaVersion: 1,
    suite: "vynorai-evidence-live-v1",
    repoCommit: commandText(["git", "rev-parse", "HEAD"]),
    dirtyStateDigest: digest(
      commandText(["git", "status", "--porcelain=v1"]) ?? "unavailable",
    ),
    vsix: {
      version: "1.2.66",
      sha256: fileDigest(canonicalVsix),
      installedBundleSha256: fileDigest(installed),
    },
    backend: { endpoint: "production-proxy", release: "unreported" },
    featureFlags: [],
    providerModel: response,
    node: process.version,
    platform: `${process.platform}-${process.arch}`,
    fixtureDigest: digest(
      JSON.stringify({ id: saved.id, root: saved.root, dir: saved.dir }),
    ),
    taskDigest: saved.taskDigest,
    runOrder: "sequential",
    concurrency: 1,
    startedAt: saved.preparedAt,
    finishedAt: new Date().toISOString(),
    cacheCondition: "provider-managed",
    invalidReason: null,
    driver: {
      end: driver?.end ?? null,
      approvals: driver?.approvals ?? null,
      continues: driver?.continues ?? null,
    },
  };
}

function usage() {
  console.error(
    "Usage: evidence-live.mjs prepare <task-id> <run-dir> | score <run-dir>",
  );
  process.exit(2);
}

function readRun(dir) {
  return JSON.parse(fs.readFileSync(path.join(dir, "task.json"), "utf8"));
}

function contractQuality(task, driver) {
  const receipt = driver?.taskReceipt;
  const criteria = Array.isArray(receipt?.criteria) ? receipt.criteria : [];
  const required = criteria.filter((criterion) => criterion.required);
  const passed = required.filter((criterion) => criterion.status === "passed");
  const evidence = Array.isArray(receipt?.evidence) ? receipt.evidence : [];
  const freshPassedIds = new Set(
    evidence
      .filter((item) => item.status === "passed")
      .map((item) => item.criterionId),
  );
  const policyFloors = criteria.every((criterion) => {
    const policies = new Set(criterion.policy);
    if (task.scope === "simple")
      return (
        !policies.has("relevant_checks") && !policies.has("independent_review")
      );
    if (task.scope === "medium") return policies.has("focused_check");
    return policies.has("independent_review");
  });
  const scopeMatch = receipt?.scope === task.scope;
  const evidenceCoverage = required.length
    ? passed.filter((criterion) => freshPassedIds.has(criterion.id)).length /
      required.length
    : 0;
  return {
    present: Boolean(receipt),
    scope: receipt?.scope ?? null,
    scopeMatch,
    criterionCount: criteria.length,
    requiredCount: required.length,
    passedCount: passed.length,
    evidenceCoverage,
    policyFloors,
    state: receipt?.state ?? null,
    ok:
      Boolean(receipt) &&
      scopeMatch &&
      required.length > 0 &&
      passed.length === required.length &&
      evidenceCoverage === 1 &&
      policyFloors,
  };
}

if (command === "prepare") {
  if (!idOrDir || !maybeDir) usage();
  const task = EVIDENCE_TASKS.find((item) => item.id === idOrDir);
  if (!task) throw new Error(`Unknown evidence task: ${idOrDir}`);
  const runDir = path.resolve(maybeDir);
  if (fs.existsSync(runDir) && fs.readdirSync(runDir).length > 0)
    throw new Error(`Run directory is not empty: ${runDir}`);
  fs.mkdirSync(runDir, { recursive: true });
  const fx = makeFixture(task);
  const run = {
    schemaVersion: 1,
    kind: "vynor-live-evidence",
    id: task.id,
    scope: task.scope,
    lang: task.lang,
    prompt: task.prompt,
    root: fx.root,
    dir: fx.dir,
    taskDigest: digest(JSON.stringify(task)),
    preparedAt: new Date().toISOString(),
  };
  fs.writeFileSync(
    path.join(runDir, "task.json"),
    JSON.stringify(run, null, 2),
  );
  console.log(
    JSON.stringify({
      id: task.id,
      dir: fx.dir,
      runDir,
      taskDigest: run.taskDigest,
    }),
  );
} else if (command === "score") {
  if (!idOrDir || maybeDir) usage();
  const runDir = path.resolve(idOrDir);
  const saved = readRun(runDir);
  const task = EVIDENCE_TASKS.find((item) => item.id === saved.id);
  if (!task) throw new Error(`Unknown evidence task in run: ${saved.id}`);
  const expectedTaskDigest = digest(JSON.stringify(task));
  const taskDrift = saved.taskDigest !== expectedTaskDigest;
  const driverFile = path.join(runDir, "run.json");
  const driver = fs.existsSync(driverFile)
    ? JSON.parse(fs.readFileSync(driverFile, "utf8"))
    : undefined;
  const manifest = reproducibilityManifest(saved, driver);
  const contract = contractQuality(task, driver);
  const invalid =
    taskDrift ||
    !driver ||
    !fs.existsSync(saved.dir) ||
    String(driver.end).startsWith("error:") ||
    !manifest.providerModel.valid ||
    !manifest.vsix.sha256 ||
    !manifest.vsix.installedBundleSha256;
  const timedOut = driver?.end === "time limit";
  const finished = driver?.end === "finished";
  const result = !finished
    ? {
        ok: false,
        why: invalid
          ? driver
            ? `invalid run: ${driver.end}`
            : "invalid run: driver result missing"
          : `turn did not finish: ${driver?.end}`,
      }
    : evaluate(
        task,
        { root: saved.root, dir: saved.dir },
        { answer: driver.reply ?? "", log: { tools: [], commands: [] } },
      );
  const summary = {
    schemaVersion: 1,
    id: task.id,
    scope: task.scope,
    lang: task.lang,
    taskDigest: saved.taskDigest,
    driver: driver
      ? {
          end: driver.end,
          seconds: driver.seconds,
          approvals: driver.approvals,
          continues: driver.continues,
          credits: driver.tokens,
        }
      : undefined,
    classification: invalid
      ? "invalid_run"
      : timedOut
        ? "budget_or_timeout"
        : result.ok && contract.ok
          ? "pass"
          : "valid_product_failure",
    ok: !invalid && finished && result.ok && contract.ok,
    why: taskDrift
      ? "task definition digest drift"
      : !manifest.providerModel.valid
        ? "actual response provider/model provenance missing"
        : !contract.ok
          ? "completion contract or fresh criterion evidence did not pass"
          : result.why,
    contract,
    answerDigest: digest(driver?.reply ?? ""),
    scoredAt: new Date().toISOString(),
  };
  manifest.invalidReason = taskDrift
    ? "task definition digest drift"
    : !manifest.providerModel.valid
      ? "actual response provider/model provenance missing"
      : null;
  fs.writeFileSync(
    path.join(runDir, "evidence-manifest.json"),
    JSON.stringify(manifest, null, 2),
  );
  fs.writeFileSync(
    path.join(runDir, "evidence-result.json"),
    JSON.stringify(summary, null, 2),
  );
  console.log(JSON.stringify(summary));
  if (process.env.VYNOR_EVIDENCE_CLEANUP === "1") cleanup({ root: saved.root });
  process.exit(summary.ok ? 0 : 1);
} else {
  usage();
}
