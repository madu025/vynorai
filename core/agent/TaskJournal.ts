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
    fs.writeFileSync(temporary, JSON.stringify(task, undefined, 2), {
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

  private assertTaskId(taskId: string): void {
    if (!TASK_ID_PATTERN.test(taskId)) throw new Error("Invalid task id");
  }
}
