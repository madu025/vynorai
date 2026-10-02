import * as fs from "fs";
import * as path from "path";

import { setConfigFilePermissions } from "../util/paths";
import { redactEventData } from "./redactSecrets";
import type { AgentTask, AgentTaskEvent } from "./types";

const TASK_ID_PATTERN = /^[0-9a-f-]{36}$/i;

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
    setConfigFilePermissions(target);
  }

  load(taskId: string): AgentTask | undefined {
    this.assertTaskId(taskId);
    const target = path.join(this.directory, `${taskId}.json`);
    if (!fs.existsSync(target)) return undefined;
    return JSON.parse(fs.readFileSync(target, "utf8")) as AgentTask;
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
        } catch {
          return undefined;
        }
      })
      .filter((task): task is AgentTask => task !== undefined);
  }

  append(event: AgentTaskEvent): void {
    this.assertTaskId(event.taskId);
    const target = path.join(this.directory, `${event.taskId}.events.jsonl`);
    const safeEvent = redactEventData(event) as AgentTaskEvent;
    fs.appendFileSync(target, `${JSON.stringify(safeEvent)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    setConfigFilePermissions(target);
  }

  maxEventSequence(): number {
    let maximum = 0;
    for (const entry of fs.readdirSync(this.directory, {
      withFileTypes: true,
    })) {
      if (!entry.isFile() || !entry.name.endsWith(".events.jsonl")) continue;
      try {
        const lines = fs
          .readFileSync(path.join(this.directory, entry.name), "utf8")
          .trim()
          .split(/\r?\n/)
          .filter(Boolean);
        for (const line of lines) {
          const event = JSON.parse(line) as Partial<AgentTaskEvent>;
          if (
            typeof event.sequence === "number" &&
            Number.isSafeInteger(event.sequence)
          )
            maximum = Math.max(maximum, event.sequence);
        }
      } catch {
        // A malformed historical event must not prevent task recovery. New
        // events continue after the highest sequence that could be decoded.
      }
    }
    return maximum;
  }

  private assertTaskId(taskId: string): void {
    if (!TASK_ID_PATTERN.test(taskId)) throw new Error("Invalid task id");
  }
}
