/**
 * Run inspector: reads what one real agent run left behind (the saved chat
 * session and the task journal) and lists every anomaly in it. A benchmark
 * score says only how the build ended; this says what went wrong on the way,
 * so one paid run answers many questions. No model is called.
 *
 *   npx tsx scripts/bench/inspect.ts --session <session.json> [--journal <agent-tasks dir>]
 *   npx tsx scripts/bench/inspect.ts --sessions <dir> [--journal <dir>] [--last 10]
 */
import fs from "node:fs";
import path from "node:path";

type Severity = "bug" | "warn" | "info";
interface Finding {
  id: string;
  severity: Severity;
  count: number;
  detail: string[];
}

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};

const EDIT_TOOLS = new Set([
  "edit_existing_file",
  "single_find_and_replace",
  "multi_edit",
  "create_new_file",
]);
const CHECK =
  /\b(test|tests|pytest|jest|vitest|tsc|typecheck|lint|eslint|build)\b/i;
/** Text a runner prints when something failed, whatever the exit code says. */
const FAILED_TEXT =
  /(^|\n)# fail [1-9]|\b[1-9]\d* (failed|failing)\b|(^|\n)not ok \d|(^|\n)\s*FAIL\b|npm error|Tests:\s+[1-9]\d* failed/i;

const text = (content: unknown): string =>
  typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content.map((p: any) => p?.text ?? "").join("")
      : "";
const short = (s: string, n = 140) => s.replace(/\s+/g, " ").trim().slice(0, n);
const argsOf = (call: any) => ({
  ...(call.parsedArgs ?? {}),
  ...(call.processedArgs ?? {}),
});
const outputOf = (call: any): string =>
  (call.output ?? []).map((o: any) => o?.content ?? "").join("\n");
const statusLine = (call: any): string =>
  (call.output ?? []).map((o: any) => o?.status ?? "").join(" ");
const marker = (content: string) => content.match(/^\[[a-z-]+\]/)?.[0];

function top(items: string[], n = 4): string[] {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(item, (counts.get(item) ?? 0) + 1);
  return [...counts]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([item, count]) => (count > 1 ? `${count}x ${item}` : item));
}

function inspectSession(file: string, journalDir?: string) {
  const session = JSON.parse(fs.readFileSync(file, "utf8"));
  const history: any[] = session.history ?? [];
  const findings: Finding[] = [];
  const add = (
    id: string,
    severity: Severity,
    detail: string[],
    count?: number,
  ) => {
    if (detail.length || count) {
      findings.push({ id, severity, count: count ?? detail.length, detail });
    }
  };

  const calls = history.flatMap((item) => item.toolCallStates ?? []);
  const errored = calls.filter((c) => c.status === "errored");
  const name = (c: any) => c.toolCall?.function?.name ?? "?";
  const rootName = path.basename(
    String(session.workspaceDirectory ?? "").replace(/[\\/]+$/, ""),
  );

  // ── Tool calls that failed, by cause ───────────────────────────────────────
  const errText = (c: any) => outputOf(c);
  add(
    "tool_not_found",
    "bug",
    top(
      errored
        .filter((c) => /Tool .{1,40} not found/i.test(errText(c)))
        .map((c) => name(c)),
    ),
  );
  add(
    "guard_refusal",
    "warn",
    top(
      errored
        .filter((c) =>
          /safety guard|Task is terminal|action limit|already run 3 times|Not run: this task is paused/i.test(
            errText(c),
          ),
        )
        .map((c) => `${name(c)}: ${short(errText(c), 90)}`),
    ),
  );
  add(
    "edit_failed",
    "warn",
    top(
      errored
        .filter((c) => EDIT_TOOLS.has(name(c)))
        .map((c) => `${name(c)}: ${short(errText(c), 110)}`),
    ),
    errored.filter((c) => EDIT_TOOLS.has(name(c))).length,
  );
  add(
    "other_tool_errors",
    "warn",
    top(
      errored
        .filter(
          (c) =>
            !EDIT_TOOLS.has(name(c)) &&
            !/not found|safety guard|Task is terminal|action limit|already run 3 times|task is paused/i.test(
              errText(c),
            ),
        )
        .map((c) => `${name(c)}: ${short(errText(c), 110)}`),
      6,
    ),
  );

  // ── Files written to the wrong place ───────────────────────────────────────
  const writes = calls.filter(
    (c) => EDIT_TOOLS.has(name(c)) && c.status === "done",
  );
  const paths = writes.map((c) => String(argsOf(c).filepath ?? ""));
  add(
    "nested_root_path",
    "bug",
    top(
      paths.filter(
        (p) => rootName && p.replace(/^\.\//, "").startsWith(`${rootName}/`),
      ),
    ),
  );
  add(
    "path_outside_workspace",
    "warn",
    top(paths.filter((p) => /^([a-z]:[\\/]|\/|\.\.[\\/])/i.test(p))),
  );
  add(
    "privacy_placeholder_written",
    "bug",
    top(
      writes
        .filter((c) =>
          /__PII_[A-Z]+_\d+__/.test(JSON.stringify(c.parsedArgs ?? {})),
        )
        .map((c) => String(argsOf(c).filepath)),
    ),
  );

  // ── Terminal commands ─────────────────────────────────────────────────────
  const commands = calls.filter(
    (c) =>
      name(c) === "run_terminal_command" &&
      typeof argsOf(c).command === "string",
  );
  const masked = commands.filter(
    (c) =>
      c.status === "done" &&
      CHECK.test(argsOf(c).command) &&
      !/failed|timed out/i.test(statusLine(c)) &&
      FAILED_TEXT.test(outputOf(c)),
  );
  add(
    "check_failed_but_read_as_passed",
    "bug",
    masked.map(
      (c) =>
        `${short(argsOf(c).command, 70)} => "${short(outputOf(c).match(FAILED_TEXT)?.[0] ?? "", 40)}" with status "${short(statusLine(c), 30)}"`,
    ),
  );
  add(
    "shell_rejected_command",
    "warn",
    top(
      commands
        .filter((c) =>
          /not a valid statement separator|#< CLIXML|is not recognized as/i.test(
            outputOf(c),
          ),
        )
        .map((c) => short(argsOf(c).command, 80)),
    ),
  );
  add(
    "command_with_no_output",
    "info",
    top(
      commands
        .filter((c) => c.status === "done" && outputOf(c).trim() === "")
        .map((c) => short(argsOf(c).command, 80)),
      3,
    ),
    commands.filter((c) => c.status === "done" && outputOf(c).trim() === "")
      .length,
  );

  // ── Loops ─────────────────────────────────────────────────────────────────
  const signatures = new Map<string, number>();
  for (const c of calls) {
    const key = `${name(c)} ${short(JSON.stringify(c.parsedArgs ?? {}), 120)}`;
    signatures.set(key, (signatures.get(key) ?? 0) + 1);
  }
  add(
    "same_call_repeated",
    "warn",
    [...signatures]
      .filter(([, n]) => n >= 3)
      .map(([key, n]) => `${n}x ${key}`)
      .slice(0, 5),
  );

  // ── What the harness did to the turn ──────────────────────────────────────
  const autoPrompts = history
    .filter((item) => item.message?.role === "user" && item.isAutoPrompt)
    .map((item) => text(item.message.content));
  add(
    "paused",
    "warn",
    autoPrompts
      .filter((p) => p.startsWith("[paused]"))
      .map((p) => short(p, 110)),
  );
  add(
    "sent_back_by_harness",
    "info",
    top(
      autoPrompts
        .filter((p) => !p.startsWith("[paused]"))
        .map((p) => marker(p) ?? short(p, 30)),
      8,
    ),
    autoPrompts.filter((p) => !p.startsWith("[paused]")).length,
  );
  add(
    "continue_pressed",
    "warn",
    history
      .filter(
        (item) =>
          item.message?.role === "user" &&
          !item.isAutoPrompt &&
          text(item.message.content).startsWith(
            "Continue the task from where you stopped",
          ),
      )
      .map(() => "Continue"),
  );

  // ── Prompt prefix: what each round re-sent ────────────────────────────────
  // History is append-only, so the prompt of one round should start with the
  // prompt of the round before. Where it does not, that round paid full price
  // for everything after the first changed character.
  const prompts: string[] = history.flatMap((item) =>
    (item.promptLogs ?? []).map((log: any) => String(log.prompt ?? "")),
  );
  const breaks: string[] = [];
  for (let i = 1; i < prompts.length; i++) {
    const a = prompts[i - 1];
    const b = prompts[i];
    let same = 0;
    const max = Math.min(a.length, b.length);
    while (same < max && a.charCodeAt(same) === b.charCodeAt(same)) same++;
    // The last lines of a prompt (the open assistant turn) are not history.
    if (same < a.length - 400) {
      breaks.push(
        `round ${i + 1}: same for ${same} of ${a.length} chars; was "${short(a.slice(same, same + 60), 60)}" now "${short(b.slice(same, same + 60), 60)}"`,
      );
    }
  }
  add("prompt_prefix_changed", "bug", breaks.slice(0, 6), breaks.length);

  // ── How it ended ──────────────────────────────────────────────────────────
  add(
    "cut_with_call_pending",
    "bug",
    calls
      .filter((c) => ["generating", "generated", "calling"].includes(c.status))
      .map(
        (c) =>
          `${name(c)} left in "${c.status}": ${short(JSON.stringify(c.parsedArgs ?? {}), 80)}`,
      ),
  );
  const last = [...history].reverse().find((item) => {
    const m = item.message;
    return (
      m?.role === "assistant" && (text(m.content).trim() || m.toolCalls?.length)
    );
  });
  if (last && !text(last.message.content).trim()) {
    add("no_final_report", "warn", [
      "the last answer is a tool call, not text",
    ]);
  }
  const todoCall = [...calls]
    .reverse()
    .find((c) => name(c) === "update_todo_list" && c.status === "done");
  const todos: any[] = todoCall?.parsedArgs?.todos ?? [];
  const open = todos.filter((t) => t.status !== "completed");
  add(
    "todo_left_open",
    "warn",
    open.map((t) => `${t.status}: ${short(String(t.content), 70)}`).slice(0, 5),
    open.length,
  );
  if (
    !calls.some((c) => name(c) === "update_todo_list") &&
    writes.length >= 2
  ) {
    add("no_todo_list", "info", [`${writes.length} edits without a todo list`]);
  }

  // ── Task journal ──────────────────────────────────────────────────────────
  const taskIds = [
    ...new Set(history.map((item) => item.taskId).filter(Boolean) as string[]),
  ];
  let journal = "";
  if (journalDir && taskIds.length) {
    for (const id of taskIds) {
      const eventsFile = path.join(journalDir, `${id}.events.jsonl`);
      if (!fs.existsSync(eventsFile)) continue;
      const events = fs
        .readFileSync(eventsFile, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      const states = events
        .filter((e) => e.type === "task.transitioned")
        .map((e) => e.data?.state);
      const finalState = states.at(-1) ?? "none";
      const evidence = events.filter(
        (e) =>
          e.type === "verification.recorded" && e.data?.kind !== "response",
      );
      const passed = evidence.filter((e) => e.data?.status === "passed").length;
      const failed = evidence.filter((e) => e.data?.status === "failed").length;
      const seconds = Math.round(
        (events.at(-1).createdAt - events[0].createdAt) / 1000,
      );
      const budget = events
        .filter((e) => e.type === "budget.consumed")
        .at(-1)?.data;
      journal += ` task ${id.slice(0, 8)}: ${seconds}s, ${events.filter((e) => e.type === "execution.authorized").length} actions, checks ${passed} passed / ${failed} failed, final state ${finalState}${budget ? `, ${budget.inputTokens} in / ${budget.outputTokens} out tokens counted` : ""}\n`;
      if (finalState === "verifying" && passed > 0) {
        add("task_not_completed_after_passing_checks", "warn", [
          `task ${id.slice(0, 8)} ended in "verifying" with ${passed} passed check(s)`,
        ]);
      }
      if (
        events.some((e) => e.type === "task.cancel.requested") &&
        finalState !== "completed"
      ) {
        add("task_canceled", "warn", [
          `task ${id.slice(0, 8)}: ${events.find((e) => e.type === "task.cancel.requested")?.data?.reason}`,
        ]);
      }
      const gaps: string[] = [];
      for (let i = 1; i < events.length; i++) {
        const gap = Math.round(
          (events[i].createdAt - events[i - 1].createdAt) / 1000,
        );
        if (gap >= 120)
          gaps.push(
            `${gap}s between ${events[i - 1].type} and ${events[i].type}`,
          );
      }
      add("long_silence", "info", gaps.slice(0, 4), gaps.length);
    }
  }

  const byTool = top(calls.map(name), 12).join(", ");
  const summary =
    `${path.basename(file)}  mode ${session.mode}, ${prompts.length} model calls, ${calls.length} tool calls (${errored.length} errored), ${writes.length} edits\n` +
    ` tools: ${byTool}\n` +
    journal;
  return { file, summary, findings };
}

function print(result: ReturnType<typeof inspectSession>) {
  console.log(result.summary.trimEnd());
  const order: Severity[] = ["bug", "warn", "info"];
  const sorted = [...result.findings].sort(
    (a, b) => order.indexOf(a.severity) - order.indexOf(b.severity),
  );
  if (!sorted.length) console.log(" no findings");
  for (const f of sorted) {
    console.log(` [${f.severity}] ${f.id} (${f.count})`);
    for (const line of f.detail) console.log(`     ${line}`);
  }
  console.log("");
}

const one = arg("session");
const many = arg("sessions");
const journalDir = arg("journal");
if (one) {
  print(inspectSession(one, journalDir));
} else if (many) {
  const files = fs
    .readdirSync(many)
    .filter((f) => f.endsWith(".json") && f !== "sessions.json")
    .map((f) => ({
      f: path.join(many, f),
      t: fs.statSync(path.join(many, f)).mtimeMs,
    }))
    .sort((a, b) => b.t - a.t)
    .slice(0, Number(arg("last") ?? 10))
    .reverse();
  const results = files.map(({ f }) => inspectSession(f, journalDir));
  results.forEach(print);
  // The same fault in several runs is a product fault, not a bad run.
  const across = new Map<
    string,
    { severity: Severity; runs: number; total: number }
  >();
  for (const result of results) {
    for (const f of result.findings) {
      const entry = across.get(f.id) ?? {
        severity: f.severity,
        runs: 0,
        total: 0,
      };
      entry.runs++;
      entry.total += f.count;
      across.set(f.id, entry);
    }
  }
  console.log(`ACROSS ${results.length} RUNS`);
  for (const [id, e] of [...across].sort((a, b) => b[1].runs - a[1].runs)) {
    console.log(
      ` ${String(e.runs).padStart(2)} of ${results.length} runs  [${e.severity}] ${id} (${e.total} in all)`,
    );
  }
} else {
  console.error(
    "usage: inspect.ts --session <file> | --sessions <dir> [--journal <dir>] [--last N]",
  );
  process.exit(1);
}
