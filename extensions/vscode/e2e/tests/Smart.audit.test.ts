import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { By, WebView } from "vscode-extension-tester";
import {
  creditsUsed,
  lastReply,
  openPanel,
  openWorkspace,
  pageText,
  retry,
  selectMode,
  send,
  signIn,
  waitForTurnEnd,
} from "../smart/gui";
import { CheckFailed, smartScenario } from "../smart/runner";

/**
 * Smart E2E for the scenario that started it all: ask the agent to audit this
 * very repository from its own docs, with the real extension, the real backend
 * (vynor.lk) and the real DeepSeek model. Needs VYNORAI_E2E_API_KEY. Runs in
 * Plan mode (read-only tools), so the repository cannot be modified.
 *
 * The checks are deterministic and cost no judge call: every claim about a file
 * is compared with what is really on disk.
 */
const REPO = path.resolve(__dirname, "..", "..", "..", "..", "..");
const TURN = 5 * 60_000;
const CREDIT_CEILING = 1_500_000;

// The prompt from the original bug report (Singlish, project-wide, no @codebase).
const AUDIT_PROMPT =
  "Vynor AI tool eke Thawath Update wenna one thana thiyenawada Codemap walin hari hoyala balanna. docs/VYNORAI_NEXT_ARCHITECTURE_SLICE.md eke plan eka ekka code eka compare karanna.";

/** Files that exist in this repo. The agent must never call them missing. */
const EXISTING = [
  "TaskRuntime.ts",
  "TaskJournal.ts",
  "VerificationDiscovery.ts",
  "SubagentToolPolicy.ts",
  "WorkspaceSessionService.ts",
  "toolRisk.ts",
  "redactSecrets.ts",
];

/**
 * Opening the whole monorepo (80k+ files, node_modules, indexing) freezes the
 * test VS Code renderer, so the audit runs on a faithful subset: the plan, the
 * docs and the directories the plan talks about. Ground truth is whatever is
 * really in this folder.
 */
const FIXTURE_DIRS = [
  "docs",
  "core/agent",
  "core/workspace",
  "core/protocol",
  "gui/src/components/WorkspaceStatus",
  "gui/src/redux/slices",
];

function makeFixture(): string {
  const dir = path.join(os.tmpdir(), "vynor-audit-fixture");
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  for (const rel of FIXTURE_DIRS) {
    const from = path.join(REPO, rel);
    if (!fs.existsSync(from)) continue;
    fs.cpSync(from, path.join(dir, rel), {
      recursive: true,
      filter: (src) => !/node_modules|[\\/]dist[\\/]|\.vitest\./.test(src),
    });
  }
  for (const file of ["CODEMAP.md", "README.md"]) {
    if (fs.existsSync(path.join(REPO, file)))
      fs.copyFileSync(path.join(REPO, file), path.join(dir, file));
  }
  return dir;
}

function listFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else out.push(path.relative(root, full).split(path.sep).join("/"));
    }
  };
  walk(root);
  return out;
}

/** Words that mean "this file is missing" in English or Singlish, near a file name. */
function claimsMissing(answer: string, file: string): boolean {
  const escaped = file.replace(/\./g, "\\.");
  const claim = new RegExp(
    `${escaped}[^\\n]{0,90}?(nathi|nae\\b|missing|not found|does not exist|doesn't exist|absent|not implemented)|(nathi|missing|not found|does not exist|absent)[^\\n]{0,60}?${escaped}`,
    "i",
  );
  return claim.test(answer);
}

/**
 * After "Set API Key" the config reloads in the background. Sending a prompt
 * while the panel still says "Sign in to activate" or the model is "Loading"
 * submits nothing, so wait for the signed-in state.
 */
async function waitSignedIn(view: WebView) {
  await retry(async () => {
    const model = await view.findWebElement(
      By.css("[data-testid='model-select-button']"),
    );
    const modelText = (await model.getText()).trim();
    const text = await pageText(view);
    // The quota banner's "Sign in" prompt reflects /api/auth/me, which an
    // API-key-only login may not satisfy while chat works, so it is not checked.
    if (modelText !== "VynorAI Auto") {
      throw new Error(`model not ready: ${modelText}`);
    }
    if (/Detecting workspace/.test(text)) throw new Error("workspace loading");
  }, 120_000);
}

describe("VynorAI smart E2E: repository audit (real model)", function () {
  this.timeout(TURN * 3);
  let view: WebView;
  let FIXTURE = "";

  before(async function () {
    this.timeout(3 * 60_000);
    FIXTURE = makeFixture();
    console.log("STEP fixture", FIXTURE, listFiles(FIXTURE).length, "files");
    await openWorkspace(FIXTURE);
    console.log("STEP signing in");
    await signIn();
    console.log("STEP signed in");
  });

  it("audit: grounded in real files, no false 'missing' claims, no invented paths", async () => {
    await smartScenario(
      "audit-grounding",
      "An audit answer that cites real paths, does not call existing files missing, and does not invent file paths.",
      async () => {
        console.log("STEP opening panel");
        ({ view } = await openPanel());
        await waitSignedIn(view);
        console.log("STEP signed in and loaded");
        console.log("STEP selecting Plan mode");
        await selectMode(view, "Plan");
        console.log("STEP sending audit prompt");
        const before = await creditsUsed();
        await send(view, AUDIT_PROMPT);
        await waitForTurnEnd(view, { timeoutMs: TURN });
        const answer = await lastReply(view);
        console.log("AUDIT ANSWER:", JSON.stringify(answer.slice(0, 2500)));
        if (!answer.trim()) {
          // Show what the panel really displays (an error bubble, sign-in, ...).
          const text = await pageText(view).catch(
            () => "(page text unavailable)",
          );
          console.log("PANEL TEXT:", JSON.stringify(text.slice(0, 2000)));
        }
        const used = (await creditsUsed()) - before;

        if (answer.trim().length < 400)
          throw new CheckFailed("answer is too short to be an audit", answer);
        if (/no workspace|workspace (is )?not (open|available)/i.test(answer))
          throw new CheckFailed("claims there is no workspace", answer);

        // 1. No existing file may be reported as missing.
        const tracked = listFiles(FIXTURE);
        const falseMissing = EXISTING.filter(
          (name) =>
            tracked.some((f) => f.endsWith(`/${name}`)) &&
            claimsMissing(answer, name),
        );
        if (falseMissing.length)
          throw new CheckFailed(
            `reported existing files as missing: ${falseMissing.join(", ")}`,
            answer,
          );

        // 2. Paths in the answer must exist (suffix match against git ls-files).
        const mentioned = [
          ...new Set(
            (
              answer.match(
                /[\w@.-]+(?:\/[\w@.-]+)+\.(?:ts|tsx|md|json|js|yaml|yml)/g,
              ) ?? []
            ).map((p) => p.replace(/^\.\//, "")),
          ),
        ];
        const invented = mentioned.filter(
          (p) => !tracked.some((f) => f === p || f.endsWith(`/${p}`)),
        );
        // Files the plan asks for but the repo lacks may be named as "missing";
        // allow those, and a small slack for new files the agent proposes.
        const PLANNED = [
          "ContextPlanner.ts",
          "ToolBroker.ts",
          "TaskEventJournal.ts",
        ];
        const trulyInvented = invented.filter(
          (p) => !PLANNED.some((n) => p.endsWith(n)),
        );
        if (mentioned.length < 3)
          throw new CheckFailed(
            `cites only ${mentioned.length} file paths; expected a grounded audit`,
            answer,
          );
        if (
          trulyInvented.length > Math.max(1, Math.floor(mentioned.length * 0.2))
        )
          throw new CheckFailed(
            `invented paths (${trulyInvented.length}/${mentioned.length}): ${trulyInvented.slice(0, 6).join(", ")}`,
            answer,
          );

        if (used > CREDIT_CEILING)
          throw new CheckFailed(
            `used ${used} credits (ceiling ${CREDIT_CEILING})`,
          );
        return { creditsUsed: used };
      },
    );
  });
});
