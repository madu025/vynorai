import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TaskJournal } from "./TaskJournal";
import type { AgentTask, AgentTaskEvent } from "./types";

const TASK_ID = "11111111-2222-4333-8444-555555555555";
const OTHER_TASK_ID = "66666666-7777-4888-9999-aaaaaaaaaaaa";

const temporaryDirectories: string[] = [];

function createJournal(): { journal: TaskJournal; directory: string } {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "vynor-journal-test-"),
  );
  temporaryDirectories.push(directory);
  return { journal: new TaskJournal(directory), directory };
}

function event(sequence: number, taskId = TASK_ID): AgentTaskEvent {
  return {
    taskId,
    sequence,
    type: "transition",
    createdAt: 1_793_491_200_000,
    data: { to: "executing" },
  };
}

function eventsFile(directory: string, taskId = TASK_ID): string {
  return path.join(directory, `${taskId}.events.jsonl`);
}

function readSequences(directory: string, taskId = TASK_ID): number[] {
  const sequences: number[] = [];
  for (const line of fs
    .readFileSync(eventsFile(directory, taskId), "utf8")
    .split("\n")) {
    try {
      sequences.push((JSON.parse(line) as AgentTaskEvent).sequence);
    } catch {
      // Torn lines are expected in these fixtures.
    }
  }
  return sequences;
}

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("TaskJournal torn writes", () => {
  it("skips only a malformed event line and keeps later sequence numbers", () => {
    const { journal, directory } = createJournal();
    fs.writeFileSync(
      eventsFile(directory),
      [
        JSON.stringify(event(1)),
        '{"taskId":"torn","sequ',
        JSON.stringify(event(7)),
        JSON.stringify(event(5)),
        "",
      ].join("\n"),
    );
    fs.writeFileSync(
      eventsFile(directory, OTHER_TASK_ID),
      `${JSON.stringify(event(3, OTHER_TASK_ID))}\n`,
    );

    expect(journal.maxEventSequence()).toBe(7);
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("1 malformed event line"),
    );
  });

  it("starts an append on a new line after a torn last line", () => {
    const { journal, directory } = createJournal();
    fs.writeFileSync(
      eventsFile(directory),
      `${JSON.stringify(event(1))}\n{"taskId":"${TASK_ID}","seq`,
    );

    journal.append(event(2));
    journal.append(event(3));

    expect(readSequences(directory)).toEqual([1, 2, 3]);
    expect(journal.maxEventSequence()).toBe(3);
  });

  it("does not add a blank line when the log already ends with a newline", () => {
    const { journal, directory } = createJournal();
    journal.append(event(1));
    journal.append(event(2));

    expect(fs.readFileSync(eventsFile(directory), "utf8")).toBe(
      `${JSON.stringify(event(1))}\n${JSON.stringify(event(2))}\n`,
    );
  });

  it("moves a corrupt task snapshot aside instead of silently dropping it", () => {
    const { journal, directory } = createJournal();
    const valid = {
      id: OTHER_TASK_ID,
      sessionId: "session-1",
      workspaceId: "workspace-1",
      state: "executing",
    } as unknown as AgentTask;
    journal.save(valid);
    const corruptPath = path.join(directory, `${TASK_ID}.json`);
    fs.writeFileSync(corruptPath, '{"id":"torn');

    expect(journal.list().map((task) => task.id)).toEqual([OTHER_TASK_ID]);
    expect(fs.existsSync(corruptPath)).toBe(false);
    expect(fs.readFileSync(`${corruptPath}.corrupt`, "utf8")).toBe(
      '{"id":"torn',
    );
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining(`${TASK_ID}.json`),
    );

    // A second corrupt copy must not overwrite the first quarantined file.
    fs.writeFileSync(corruptPath, '{"id":"torn-again');
    expect(journal.list().map((task) => task.id)).toEqual([OTHER_TASK_ID]);
    expect(fs.readFileSync(`${corruptPath}.corrupt`, "utf8")).toBe(
      '{"id":"torn',
    );
    expect(
      fs
        .readdirSync(directory)
        .filter((name) => name.startsWith(`${TASK_ID}.json.`)),
    ).toHaveLength(2);

    journal.delete(TASK_ID);
    expect(
      fs.readdirSync(directory).filter((name) => name.startsWith(TASK_ID)),
    ).toEqual([]);
  });
});
