import { v4 as uuidv4 } from "uuid";

import { Session } from "..";
import { NEW_SESSION_TITLE } from "./constants";
import * as fs from "fs";
import * as path from "path";
import historyManager, { accountFolderName } from "./history";
import { getSessionFilePath, getSessionsFolderPath } from "./paths";

const sessionId = uuidv4();
const testSession: Session = {
  history: [],
  title: `${sessionId} title`,
  workspaceDirectory: "workspaceDir",
  sessionId: sessionId,
};

describe("No sessions have been created", () => {
  const testSessionId = "invalid";
  const testSessionPath = getSessionFilePath(testSessionId);

  test("Listing all sessions returns empty list", () => {
    const sessions = historyManager.list({});
    expect(sessions).toEqual([]);
  });

  test("Deleting a missing session is a no-op (stale entries stay deletable)", () => {
    expect(() => historyManager.delete(testSessionId)).not.toThrow();
  });

  test("Loading session returns default session", () => {
    const session = historyManager.load(testSessionId);
    expect(session).toEqual({
      history: [],
      title: NEW_SESSION_TITLE,
      workspaceDirectory: "",
      sessionId: testSessionId,
    });
  });
});

describe("Full session lifecycle", () => {
  test("Creating and listing a session", () => {
    // save and list
    historyManager.save(testSession);
    const sessions = historyManager.list({});
    const sessionExists = sessions.some(
      (session) => session?.sessionId === testSession.sessionId,
    );
    expect(sessionExists).toBe(true);
  });

  test("Loading session by ID returns correct object", () => {
    const retrievedSession = historyManager.load(testSession.sessionId);
    expect(retrievedSession).toEqual(testSession);
  });

  test("Saving session with new title updates session", () => {
    const modifiedSession = { ...testSession };
    modifiedSession.title = `Edited: ${testSession.title}`;
    historyManager.save(modifiedSession);
    const session = historyManager.load(testSession.sessionId);

    expect(session.title).toBe(modifiedSession.title);
  });

  test("Deleting session", () => {
    historyManager.delete(testSession.sessionId);
    const sessions = historyManager.list({});
    const sessionWasDeleted = sessions.every(
      (session) => session?.sessionId !== testSession.sessionId,
    );
    expect(sessionWasDeleted).toEqual(true);
  });
});

describe("Workspace directory filtering", () => {
  beforeAll(() => {
    historyManager.clearAll();
    historyManager.save({
      history: [],
      title: "Project A session 1",
      workspaceDirectory: "/home/user/project-a",
      sessionId: "ws-a-1",
    });
    historyManager.save({
      history: [],
      title: "Project B session 1",
      workspaceDirectory: "/home/user/project-b",
      sessionId: "ws-b-1",
    });
    historyManager.save({
      history: [],
      title: "Project A session 2",
      workspaceDirectory: "/home/user/project-a",
      sessionId: "ws-a-2",
    });
    historyManager.save({
      history: [],
      title: "No workspace",
      workspaceDirectory: "",
      sessionId: "ws-none",
    });
  });

  afterAll(() => {
    historyManager.clearAll();
  });

  test("Filter sessions by workspace directory", () => {
    const sessions = historyManager.list({
      workspaceDirectory: "/home/user/project-a",
    });
    expect(sessions.length).toBe(2);
    expect(
      sessions.every((s) => s.workspaceDirectory === "/home/user/project-a"),
    ).toBe(true);
  });

  test("Omitting workspace returns all sessions", () => {
    const sessions = historyManager.list({});
    expect(sessions.length).toBe(4);
  });

  test("Workspace filter is case-insensitive", () => {
    const sessions = historyManager.list({
      workspaceDirectory: "/HOME/USER/PROJECT-A",
    });
    expect(sessions.length).toBe(2);
  });

  test("Non-matching workspace returns empty list", () => {
    const sessions = historyManager.list({
      workspaceDirectory: "/home/user/nonexistent",
    });
    expect(sessions.length).toBe(0);
  });

  test("Workspace filter works with limit", () => {
    const sessions = historyManager.list({
      workspaceDirectory: "/home/user/project-a",
      limit: 1,
    });
    expect(sessions.length).toBe(1);
  });

  test("Workspace filter works with limit and offset", () => {
    const sessions = historyManager.list({
      workspaceDirectory: "/home/user/project-a",
      limit: 1,
      offset: 1,
    });
    expect(sessions.length).toBe(1);
    expect(sessions[0].sessionId).toBe("ws-a-1");
  });
});

describe("Many sessions created", () => {
  test("Create 100 sessions and list all", () => {
    for (let i = 0; i < 100; i++) {
      historyManager.save({
        history: [],
        title: `${i}`,
        workspaceDirectory: "workspaceDir",
        sessionId: `${i}`,
      });
    }
    const sessions = historyManager.list({});
    expect(sessions.length).toBe(100);
  });

  test("List 10 sessions, offest by 10", () => {
    const limit = 10;
    const offset = 10;

    const sessions = historyManager.list({ offset: offset, limit: limit });
    // Sessions are now reversed, so newest (99) comes first
    const sessionIds = Array.from({ length: limit }, (_, i) =>
      (99 - offset - i).toString(),
    );
    const isSessionIdInList = (sessionId: string) =>
      sessions.some((session) => session.sessionId === sessionId);
    expect(sessionIds.every(isSessionIdInList)).toBe(true);
  });

  test("List 25 sessions, with no offset", () => {
    const limit = 25;

    const sessions = historyManager.list({ limit: limit });
    // Sessions are now reversed, so newest (99) comes first
    const sessionIds = Array.from({ length: limit }, (_, i) =>
      (99 - i).toString(),
    );

    const isSessionIdInList = (sessionId: string) =>
      sessions.some((session) => session.sessionId === sessionId);
    expect(sessionIds.every(isSessionIdInList)).toBe(true);
  });

  test("List sessions offset by 75", () => {
    const offset = 75;

    const sessions = historyManager.list({ offset: offset });
    const sessionIds = Array.from(
      { length: sessions.length - offset },
      (_, i) => (i + offset).toString(),
    );

    const isSessionIdInList = (sessionId: string) =>
      sessions.some((session) => session.sessionId === sessionId);
    expect(sessionIds.every(isSessionIdInList)).toBe(true);
  });

  test("Delete all sessions", () => {
    let sessions = historyManager.list({});

    for (let session of sessions) {
      historyManager.delete(session.sessionId);
    }
    sessions = historyManager.list({});
    expect(sessions.length).toBe(0);
  });
});

describe("Account-scoped history", () => {
  const session = (id: string, title: string): Session => ({
    sessionId: id,
    title,
    workspaceDirectory: "",
    history: [],
  });

  afterAll(() => historyManager.setScope({ kind: "global" }));

  test("signed out lists nothing and writes nothing", () => {
    historyManager.setScope({ kind: "global" });
    historyManager.save(session(uuidv4(), "before login"));
    historyManager.setScope({ kind: "signedOut" });
    expect(historyManager.list({})).toEqual([]);
    historyManager.save(session(uuidv4(), "should not be stored"));
    expect(historyManager.list({})).toEqual([]);
  });

  test("the first account keeps the old shared chats; other accounts start empty", () => {
    historyManager.setScope({
      kind: "account",
      accountId: "first@example.com",
    });
    const titles = historyManager.list({}).map((s) => s.title);
    expect(titles).toContain("before login");

    historyManager.setScope({
      kind: "account",
      accountId: "second@example.com",
    });
    expect(historyManager.list({})).toEqual([]);
    historyManager.save(session(uuidv4(), "second's chat"));

    historyManager.setScope({
      kind: "account",
      accountId: "first@example.com",
    });
    expect(historyManager.list({}).map((s) => s.title)).not.toContain(
      "second's chat",
    );
  });

  test("a corrupt index is rebuilt from session files instead of showing an empty history", () => {
    historyManager.setScope({
      kind: "account",
      accountId: "corrupt@example.com",
    });
    const id = uuidv4();
    historyManager.save(session(id, "survives corruption"));
    const dir = path.join(
      getSessionsFolderPath(),
      "accounts",
      accountFolderName("corrupt@example.com"),
    );
    fs.writeFileSync(path.join(dir, "sessions.json"), '[{"sessionId": "trunc');
    expect(historyManager.list({}).map((s) => s.sessionId)).toEqual([id]);
  });

  test("path traversal in a session id is rejected", () => {
    expect(() => historyManager.save(session("../../escape", "x"))).toThrow(
      /Invalid session id/,
    );
  });
});
