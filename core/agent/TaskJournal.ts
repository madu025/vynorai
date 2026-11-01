import * as fs from "fs";
import * as path from "path";

import { redactEventData } from "./redactSecrets";
import type { AgentTask, AgentTaskEvent } from "./types";

const TASK_ID_PATTERN = /^[0-9a-f-]{36}$/i;

function setPrivatePermissions(filePath: string): void {
  if (process.platform === "win32") return;
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // The containing sandbox may enforce permissions at the mount layer.
  }
}

function endsWithNewline(filePath: string): boolean {
  let descriptor: number;
  try {
    descriptor = fs.openSync(filePath, "r");
  } catch {
    return true; // A missing file needs no separator.
  }
  try {
    const { size } = fs.fstatSync(descriptor);
    if (size === 0) return true;
    const last = new Uint8Array(1);
    fs.readSync(descriptor, last, 0, 1, size - 1);
    return last[0] === 0x0a;
  } finally {
    fs.closeSync(descriptor);
  }
}

export class TaskJournal {
  constructor(private readonly directory: string) {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  }

  save(task: AgentTask): void {
    this.assertTaskId(task.id);
    const target = path.join(this.directory, `${task.id}.json`);
    const temporary = `${target}.${process.pid}.tmp`;
    const safeTask = redactEventData(task) as AgentTask;
    fs.writeFileSync(temporary, JSON.stringify(safeTask, undefined, 2), {
      encoding: "utf8",
      mode: 0o600,
    });
    fs.renameSync(temporary, target);
    setPrivatePermissions(target);
  }

  load(taskId: string): AgentTask | undefined {
    this.assertTaskId(taskId);
    const target = path.join(this.directory, `${taskId}.json`);
    if (!fs.existsSync(target)) return undefined;
    return JSON.parse(fs.readFileSync(target, "utf8")) as AgentTask;
  }

  /** Remove local task content and its event log for explicit user deletion. */
  delete(taskId: string): void {
    this.assertTaskId(taskId);
    for (const suffix of [".json", ".events.jsonl"]) {
      const target = path.join(this.directory, `${taskId}${suffix}`);
      if (fs.existsSync(target)) fs.unlinkSync(target);
    }
    // Quarantined corrupt snapshots hold task content too.
    for (const name of fs.readdirSync(this.directory)) {
      if (name.startsWith(`${taskId}.json.`) && name.endsWith(".corrupt"))
        fs.unlinkSync(path.join(this.directory, name));
    }
  }

  list(): AgentTask[] {
    return fs
      .readdirSync(this.directory, { withFileTypes: true })
      .filter(
        (entry) =>
          entry.isFile() &&
          entry.name.endsWith(".json") &&
          !entry.name.endsWith(".events.json"),
      )
      .map((entry) => entry.name.slice(0, -".json".length))
      .filter((taskId) => TASK_ID_PATTERN.test(taskId))
      .map((taskId) => {
        try {
          return this.load(taskId);
        } catch (error) {
          if (error instanceof SyntaxError) this.quarantineSnapshot(taskId);
          else
            console.warn(`TaskJournal: cannot read task ${taskId}: ${error}`);
          return undefined;
        }
      })
      .filter((task): task is AgentTask => task !== undefined);
  }

  append(event: AgentTaskEvent): void {
    this.assertTaskId(event.taskId);
    const target = path.join(this.directory, `${event.taskId}.events.jsonl`);
    const safeEvent = redactEventData(event) as AgentTaskEvent;
    // After a crash the last line may be torn (no trailing newline). Start the
    // new entry on its own line so it is not glued to the broken one.
    const separator = endsWithNewline(target) ? "" : "\n";
    fs.appendFileSync(target, `${separator}${JSON.stringify(safeEvent)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    setPrivatePermissions(target);
  }

  maxEventSequence(): number {
    let maximum = 0;
    for (const entry of fs.readdirSync(this.directory, {
      withFileTypes: true,
    })) {
      if (!entry.isFile() || !entry.name.endsWith(".events.jsonl")) continue;
      let content: string;
      try {
        content = fs.readFileSync(
          path.join(this.directory, entry.name),
          "utf8",
        );
      } catch (error) {
        console.warn(`TaskJournal: cannot read ${entry.name}: ${error}`);
        continue;
      }
      // Parse line by line: a torn or malformed line (for example after a
      // crash) is skipped on its own, so later valid events still count and
      // new sequence numbers stay above every decodable one.
      let malformed = 0;
      for (const line of content.split(/\r?\n/)) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line) as Partial<AgentTaskEvent>;
          if (
            typeof event.sequence === "number" &&
            Number.isSafeInteger(event.sequence)
          )
            maximum = Math.max(maximum, event.sequence);
        } catch {
          malformed++;
        }
      }
      if (malformed > 0)
        console.warn(
          `TaskJournal: skipped ${malformed} malformed event line(s) in ${entry.name}`,
        );
    }
    return maximum;
  }

  /** Move an undecodable task snapshot aside so it is kept for inspection
   * and reported once, instead of being silently skipped on every list. */
  private quarantineSnapshot(taskId: string): void {
    const source = path.join(this.directory, `${taskId}.json`);
    let target = `${source}.corrupt`;
    if (fs.existsSync(target)) target = `${source}.${Date.now()}.corrupt`;
    try {
      fs.renameSync(source, target);
      console.warn(
        `TaskJournal: corrupt task snapshot ${taskId}.json moved to ${path.basename(target)}`,
      );
    } catch (error) {
      console.warn(
        `TaskJournal: corrupt task snapshot ${taskId}.json could not be moved aside: ${error}`,
      );
    }
  }

  private assertTaskId(taskId: string): void {
    if (!TASK_ID_PATTERN.test(taskId)) throw new Error("Invalid task id");
  }
}
