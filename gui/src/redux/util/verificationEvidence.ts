import { ContextItem } from "core";
import type { VerificationResult } from "core/agent/types";

type VerificationKind = VerificationResult["kind"];

type CheckKind = Extract<
  VerificationKind,
  "test" | "typecheck" | "lint" | "build"
>;

/** When one command line runs several checks, the first of these names it. */
const KIND_ORDER: CheckKind[] = ["test", "typecheck", "lint", "build"];

/** Programs that are a check whatever their arguments. */
const BY_PROGRAM: Record<string, CheckKind> = {
  vitest: "test",
  jest: "test",
  mocha: "test",
  ava: "test",
  tap: "test",
  jasmine: "test",
  pytest: "test",
  "py.test": "test",
  unittest: "test",
  nose2: "test",
  tox: "test",
  nox: "test",
  phpunit: "test",
  pest: "test",
  rspec: "test",
  ctest: "test",
  tsc: "typecheck",
  "vue-tsc": "typecheck",
  "svelte-check": "typecheck",
  mypy: "typecheck",
  pyright: "typecheck",
  eslint: "lint",
  biome: "lint",
  ruff: "lint",
  pylint: "lint",
  flake8: "lint",
  "golangci-lint": "lint",
  stylelint: "lint",
  oxlint: "lint",
  rubocop: "lint",
  webpack: "build",
  rollup: "build",
  tsup: "build",
  esbuild: "build",
  compileall: "build",
  py_compile: "build",
};

/** Programs that are a check only with one of these subcommands. */
const BY_SUBCOMMAND: Record<string, Record<string, CheckKind>> = {
  cargo: {
    test: "test",
    nextest: "test",
    build: "build",
    check: "typecheck",
    clippy: "lint",
  },
  go: { test: "test", build: "build", vet: "lint" },
  dotnet: { test: "test", build: "build" },
  deno: { test: "test", check: "typecheck", lint: "lint" },
  swift: { test: "test", build: "build" },
  flutter: { test: "test", analyze: "lint", build: "build" },
  dart: { test: "test", analyze: "lint", compile: "build" },
  playwright: { test: "test" },
  cypress: { run: "test" },
  rails: { test: "test" },
  ng: { test: "test", lint: "lint", build: "build" },
  vite: { build: "build" },
  next: { build: "build", lint: "lint" },
  nuxt: { build: "build" },
  astro: { build: "build", check: "typecheck" },
};

const PACKAGE_MANAGERS = new Set(["npm", "pnpm", "yarn", "bun"]);
/** Package manager commands that change the install, never a check. */
const INSTALL_COMMANDS = new Set([
  "install",
  "add",
  "i",
  "ci",
  "remove",
  "uninstall",
  "update",
  "upgrade",
  "init",
  "create",
  "link",
]);
/** Package manager flags that take the next word as their value. */
const VALUE_FLAGS = new Set([
  "--prefix",
  "--dir",
  "--cwd",
  "--filter",
  "--workspace",
  "-C",
  "-F",
  "-w",
  "-p",
  "--package",
]);
/** Programs that run a named target or script: the name says what it is. */
const TARGET_RUNNERS = new Set([
  "make",
  "gmake",
  "nmake",
  "just",
  "task",
  "rake",
  "composer",
  "turbo",
  "nx",
  "lerna",
  "mix",
]);
/** Words in front of the program that is really run. */
const RUNNER_PREFIXES = new Set([
  "sudo",
  "time",
  "call",
  "env",
  "cross-env",
  "dotenv",
  "npx",
  "pnpx",
  "bunx",
]);
const RUN_SUBCOMMANDS: Record<string, string[]> = {
  npm: ["exec", "x"],
  pnpm: ["exec", "dlx"],
  yarn: ["exec", "dlx"],
  bun: ["x"],
  uv: ["run"],
  poetry: ["run"],
  pipenv: ["run"],
  bundle: ["exec"],
};

const SHELL_WRAPPER =
  /^(?:\S*[\\/])?(?:cmd|powershell|pwsh|bash|sh|zsh)(?:\.exe)?\s+(?:.*?\s)?(?:\/c|\/k|-c|-lc|-command)\s+(.+)$/i;

/**
 * The commands of one command line: split at `&&`, `||`, `;`, `|` and line
 * ends, outside quotes. PowerShell separates with `;` (5.1 rejects `&&`).
 */
function commandSegments(command: string): string[] {
  const segments: string[] = [];
  let current = "";
  let quote = "";
  for (const char of command) {
    if (quote) {
      if (char === quote) quote = "";
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (";|&\n".includes(char)) {
      segments.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  segments.push(current);
  return segments.map((segment) => segment.trim()).filter(Boolean);
}

function words(segment: string): string[] {
  return (segment.match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map((word) =>
    word.replace(/^(["'])([\s\S]*)\1$/, "$2"),
  );
}

/** `./node_modules/.bin/jest.cmd` and `C:\tools\jest.exe` are `jest`. */
function programName(word: string): string {
  return word
    .replace(/^.*[\\/]/, "")
    .replace(/\.(?:exe|cmd|bat|ps1)$/i, "")
    .toLowerCase()
    .replace(/^python[\d.]*$/, "python");
}

/** What a script, target or task is, read from its name (`test:unit`, `lint`). */
function kindOfName(name: string): CheckKind | undefined {
  const lower = name.toLowerCase();
  if (/(?:^|[^a-z])(?:unit)?(?:tests?|specs?|e2e)(?:[^a-z]|$)/.test(lower))
    return "test";
  if (lower.includes("lint")) return "lint";
  if (
    /typecheck|type-check|(?:^|[^a-z])(?:tsc|types|check)(?:[^a-z]|$)/.test(
      lower,
    )
  )
    return "typecheck";
  if (/(?:^|[^a-z])(?:build|compile)(?:[^a-z]|$)/.test(lower)) return "build";
  return undefined;
}

/** Maven phases and Gradle tasks (`verify`, `integrationTest`, `assemble`). */
function kindOfJavaTask(name: string): CheckKind | undefined {
  const lower = name.toLowerCase();
  if (/test|verify|check/.test(lower)) return "test";
  if (lower.includes("lint")) return "lint";
  if (/build|assemble|compile|package|install/.test(lower)) return "build";
  return undefined;
}

function strongest(kinds: Array<CheckKind | undefined>): CheckKind | undefined {
  return KIND_ORDER.find((kind) => kinds.includes(kind));
}

function isTestFile(word: string): boolean {
  return (
    /(?:^|[\\/._-])(?:tests?|spec)\.[cm]?[jt]sx?$/i.test(word) ||
    /(?:^|[\\/])(?:test_[^\\/]*|[^\\/]*_test)\.py$/i.test(word)
  );
}

/** One program with its arguments, after wrappers and prefixes are gone. */
function classifyProgram(
  program: string,
  rest: string[],
): CheckKind | undefined {
  const args: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    if (VALUE_FLAGS.has(rest[i])) i++;
    else if (!rest[i].startsWith("-")) args.push(rest[i]);
  }
  const sub = (args[0] ?? "").toLowerCase();

  if (PACKAGE_MANAGERS.has(program)) {
    if (!sub || INSTALL_COMMANDS.has(sub)) return undefined;
    // `npm test`, `npm t`, `npm run lint`, `pnpm build`, `yarn jest`.
    const script = sub === "run" || sub === "run-script" ? args[1] : args[0];
    if (!script) return undefined;
    if (script === "t" || script === "tst") return "test";
    return (
      classifyProgram(
        programName(script),
        rest.slice(rest.indexOf(script) + 1),
      ) ?? kindOfName(script)
    );
  }
  if (BY_PROGRAM[program]) return BY_PROGRAM[program];
  if (BY_SUBCOMMAND[program]) return BY_SUBCOMMAND[program][sub];
  if (TARGET_RUNNERS.has(program)) {
    // A bare `make` builds the default target.
    if (args.length === 0)
      return program.endsWith("make") ? "build" : undefined;
    return strongest(args.map(kindOfName));
  }
  switch (program) {
    case "node":
    case "nodejs":
    case "tsx":
    case "ts-node":
      // The built-in runner (`node --test`) or a test file run directly.
      return rest.includes("--test") || args.some(isTestFile)
        ? "test"
        : undefined;
    case "python":
    case "py": {
      const module = rest[rest.indexOf("-m") + 1];
      if (rest.includes("-m") && module)
        return classifyProgram(
          programName(module),
          rest.slice(rest.indexOf("-m") + 2),
        );
      if (/(?:^|[\\/])manage\.py$/.test(args[0] ?? "") && args[1] === "test")
        return "test";
      return args.some(isTestFile) ? "test" : undefined;
    }
    case "php":
      if (/(?:^|[\\/])artisan$/.test(args[0] ?? ""))
        return args[1] === "test" ? "test" : undefined;
      return args[0]
        ? classifyProgram(programName(args[0]), args.slice(1))
        : undefined;
    case "mvn":
    case "mvnw":
    case "gradle":
    case "gradlew":
      return strongest(args.map(kindOfJavaTask));
    case "xcodebuild":
      return args.includes("test") ? "test" : "build";
    default:
      return undefined;
  }
}

function classifySegment(
  segment: string,
  depth: number,
): CheckKind | undefined {
  // `cmd /c "cd app && npm test"`, `bash -lc '...'`: classify what is inside.
  const wrapped = segment.match(SHELL_WRAPPER);
  if (wrapped) {
    return depth < 3
      ? classifyCommandLine(
          wrapped[1].trim().replace(/^(["'])([\s\S]*)\1$/, "$2"),
          depth + 1,
        )
      : undefined;
  }

  const all = words(segment);
  let i = 0;
  while (i < all.length) {
    const program = programName(all[i]);
    if (/^[A-Za-z_]\w*=/.test(all[i])) {
      i++;
    } else if (RUNNER_PREFIXES.has(program)) {
      i++;
      while (i < all.length && all[i].startsWith("-"))
        i += VALUE_FLAGS.has(all[i]) ? 2 : 1;
    } else if (RUN_SUBCOMMANDS[program]?.includes(all[i + 1] ?? "")) {
      i += 2;
      while (i < all.length && all[i].startsWith("-")) i++;
    } else {
      break;
    }
  }
  return i < all.length
    ? classifyProgram(programName(all[i]), all.slice(i + 1))
    : undefined;
}

function classifyCommandLine(
  command: string,
  depth: number,
): CheckKind | undefined {
  return strongest(
    commandSegments(command).map((segment) => classifySegment(segment, depth)),
  );
}

/**
 * What kind of check a terminal command is, if it is one. This is the one
 * definition of "a check": the verification gate, the repair gate, the
 * progress pause and the task evidence all use it.
 *
 * Read from the program each command of the line runs, never from a word
 * somewhere in it: `npm install --save-dev jest`, `cat eslint.config.js`,
 * `ls tests` and `mkdir build` are not checks, and `node --test`,
 * `python -m unittest` and `make test` are.
 */
export function classifyVerificationCommand(
  command: string,
): VerificationKind | undefined {
  return classifyCommandLine(command, 0);
}

/**
 * The `command` of a tool call: the model's arguments with what preprocessing
 * added, so preprocessing can never blank it.
 */
export function commandOf(call: {
  parsedArgs?: unknown;
  processedArgs?: unknown;
}): string | undefined {
  const command = {
    ...((call.parsedArgs as object | undefined) ?? {}),
    ...((call.processedArgs as object | undefined) ?? {}),
  } as { command?: unknown };
  return typeof command.command === "string" ? command.command : undefined;
}

/**
 * Whether a command result is a failure, read from the status line the
 * terminal tool sets ("Command failed with exit code 1", "Command timed
 * out"). The output text is never read: "5 passed, 0 failed" and a passing
 * test named "rejects the order when payment failed" are passes.
 */
export function commandFailed(output: ContextItem[] | undefined): boolean {
  return Boolean(
    output?.some((item) =>
      /^command (?:failed|timed out)/i.test(
        (item.status || item.description || "").trim(),
      ),
    ),
  );
}

export function verificationFromToolResult(args: {
  toolName: string;
  command?: string;
  output?: ContextItem[];
  failed: boolean;
}): Omit<VerificationResult, "id" | "createdAt"> | undefined {
  const normalizedTool = args.toolName.toLowerCase();
  let kind: VerificationKind | undefined;
  if (
    normalizedTool.includes("view_diff") ||
    normalizedTool.includes("browser_qa") ||
    normalizedTool === "browser"
  )
    kind = "review";
  else if (args.command) kind = classifyVerificationCommand(args.command);
  if (!kind) return undefined;

  const status =
    args.failed || commandFailed(args.output) ? "failed" : "passed";
  return {
    kind,
    status,
    summary: `${kind} evidence from ${args.toolName}: ${status}`,
  };
}
