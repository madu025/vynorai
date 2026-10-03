import { createHash } from "crypto";
import * as fs from "fs";
import * as path from "path";

import { BaseSessionMetadata, Session } from "../index.js";
import { ListHistoryOptions } from "../protocol/core.js";

import { NEW_SESSION_TITLE } from "./constants.js";
import { getSessionsFolderPath } from "./paths.js";

/**
 * Whose chat history is visible.
 * - `global`: the original shared ~/.continue/sessions (JetBrains, CLI, tests).
 * - `account`: one folder per signed-in VynorAI account.
 * - `signedOut`: nothing is listed and nothing is written.
 * - `pending`: like signedOut, while the IDE is still checking the stored login.
 */
export type HistoryScope =
  | { kind: "global" }
  | { kind: "account"; accountId: string }
  | { kind: "signedOut" }
  | { kind: "pending" };

const SESSION_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const MIGRATED_MARKER = ".migrated-to-account";

function safeParseArray<T>(value: string): T[] | undefined {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as T[]) : undefined;
  } catch {
    return undefined;
  }
}

/** Write via a temp file + rename so a crash or a parallel save never leaves half a file. */
function writeFileAtomic(filepath: string, content: string): void {
  const tmp = `${filepath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, filepath);
}

/** Stable, non-reversible folder name for an account (email or user id). */
export function accountFolderName(accountId: string): string {
  return createHash("sha256")
    .update(accountId.trim().toLowerCase())
    .digest("hex")
    .slice(0, 24);
}

export class HistoryManager {
  private scope: HistoryScope = { kind: "global" };

  setScope(scope: HistoryScope): void {
    this.scope = scope;
    if (scope.kind === "account") this.migrateGlobalSessionsOnce();
  }

  getScope(): HistoryScope {
    return this.scope;
  }

  /**
   * Opaque id of whose history is shown, for the GUI to notice account
   * switches: folder hash, "global", null when signed out, "pending" while
   * the login is still being checked.
   */
  accountKey(): string | null {
    switch (this.scope.kind) {
      case "account":
        return accountFolderName(this.scope.accountId);
      case "global":
        return "global";
      case "pending":
        return "pending";
      default:
        return null;
    }
  }

  /** Folder for the current scope, or null when signed out. */
  private folder(): string | null {
    if (this.scope.kind === "signedOut" || this.scope.kind === "pending")
      return null;
    const root = getSessionsFolderPath();
    if (this.scope.kind === "global") return root;
    const dir = path.join(
      root,
      "accounts",
      accountFolderName(this.scope.accountId),
    );
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  private sessionFile(dir: string, sessionId: string): string {
    if (!SESSION_ID_RE.test(sessionId))
      throw new Error(`Invalid session id: ${sessionId}`);
    return path.join(dir, `${sessionId}.json`);
  }

  /**
   * Reads sessions.json. If it is missing or corrupt (for example an older,
   * non-atomic write was interrupted), rebuild it from the session files
   * instead of showing an empty history.
   */
  private readIndex(dir: string): BaseSessionMetadata[] {
    const indexPath = path.join(dir, "sessions.json");
    if (fs.existsSync(indexPath)) {
      const parsed = safeParseArray<BaseSessionMetadata>(
        fs.readFileSync(indexPath, "utf8"),
      );
      if (parsed)
        return parsed.filter((s: any) => typeof s.session_id !== "string");
      console.warn(
        `[History] ${indexPath} is corrupt; rebuilding it from session files.`,
      );
    }
    const rebuilt: BaseSessionMetadata[] = [];
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith(".json") || file === "sessions.json") continue;
      try {
        const full = path.join(dir, file);
        const session: Session = JSON.parse(fs.readFileSync(full, "utf8"));
        rebuilt.push({
          sessionId: path.basename(file, ".json"),
          title: session.title || NEW_SESSION_TITLE,
          dateCreated: String(Math.floor(fs.statSync(full).mtimeMs)),
          workspaceDirectory: session.workspaceDirectory || "",
          messageCount: (session.history || []).filter(
            (h) => h.message?.role === "assistant",
          ).length,
        });
      } catch {
        // Skip unreadable session files.
      }
    }
    rebuilt.sort((a, b) => Number(a.dateCreated) - Number(b.dateCreated));
    this.writeIndex(dir, rebuilt);
    return rebuilt;
  }

  private writeIndex(dir: string, sessions: BaseSessionMetadata[]): void {
    writeFileAtomic(
      path.join(dir, "sessions.json"),
      JSON.stringify(sessions, undefined, 2),
    );
  }

  /**
   * Chats saved before history was per account belong to whoever used this
   * machine; the first account that signs in keeps them (moved, not copied).
   */
  private migrateGlobalSessionsOnce(): void {
    if (this.scope.kind !== "account") return;
    const root = getSessionsFolderPath();
    const marker = path.join(root, MIGRATED_MARKER);
    if (fs.existsSync(marker)) return;
    const legacyIndex = path.join(root, "sessions.json");
    const target = this.folder()!;
    try {
      if (fs.existsSync(legacyIndex)) {
        const legacy = this.readIndex(root);
        const current = this.readIndex(target);
        const known = new Set(current.map((s) => s.sessionId));
        for (const meta of legacy) {
          const from = path.join(root, `${meta.sessionId}.json`);
          if (!SESSION_ID_RE.test(meta.sessionId) || !fs.existsSync(from))
            continue;
          fs.renameSync(from, path.join(target, `${meta.sessionId}.json`));
          if (!known.has(meta.sessionId)) current.push(meta);
        }
        this.writeIndex(target, current);
        fs.rmSync(legacyIndex, { force: true });
      }
      fs.writeFileSync(marker, accountFolderName(this.scope.accountId));
    } catch (err) {
      console.warn(
        "[History] Could not move existing chats to the signed-in account:",
        err,
      );
    }
  }

  list(options: ListHistoryOptions): BaseSessionMetadata[] {
    const dir = this.folder();
    if (!dir) return [];
    // Newest first; sessions.json is chronological by creation.
    let sessions = this.readIndex(dir).reverse();

    if (options.workspaceDirectory) {
      const target = options.workspaceDirectory.toLowerCase();
      sessions = sessions.filter(
        (session) =>
          typeof session.workspaceDirectory === "string" &&
          session.workspaceDirectory.toLowerCase() === target,
      );
    }

    if (options.limit) {
      const offset = options.offset || 0;
      sessions = sessions.slice(offset, offset + options.limit);
    }
    return sessions;
  }

  /** Removes a session. Missing files are fine, so stale list entries can always be deleted. */
  delete(sessionId: string) {
    const dir = this.folder();
    if (!dir) return;
    fs.rmSync(this.sessionFile(dir, sessionId), { force: true });
    this.writeIndex(
      dir,
      this.readIndex(dir).filter((session) => session.sessionId !== sessionId),
    );
  }

  /** Clears the current scope's history only. */
  clearAll() {
    const dir = this.folder();
    if (!dir) return;
    for (const file of fs.readdirSync(dir)) {
      if (file.endsWith(".json"))
        fs.rmSync(path.join(dir, file), { force: true });
    }
  }

  load(sessionId: string): Session {
    const empty: Session = {
      history: [],
      title: NEW_SESSION_TITLE,
      workspaceDirectory: "",
      sessionId,
    };
    const dir = this.folder();
    if (!dir) return empty;
    try {
      const sessionFile = this.sessionFile(dir, sessionId);
      if (!fs.existsSync(sessionFile)) return empty;
      const session: Session = JSON.parse(fs.readFileSync(sessionFile, "utf8"));
      session.sessionId = sessionId;
      return session;
    } catch (e) {
      console.log(`Error loading session: ${e}`);
      return empty;
    }
  }

  save(session: Session) {
    const dir = this.folder();
    if (!dir) return; // signed out: never write chats into a shared place

    // Explicit key order in the file: id, title, workspace, history…
    const orderedSession: Session = {
      sessionId: session.sessionId,
      title: session.title,
      workspaceDirectory: session.workspaceDirectory,
      history: session.history,
    };
    if (session.mode) orderedSession.mode = session.mode;
    if (session.chatModelTitle !== undefined)
      orderedSession.chatModelTitle = session.chatModelTitle;
    if (session.usage !== undefined) orderedSession.usage = session.usage;

    writeFileAtomic(
      this.sessionFile(dir, session.sessionId),
      JSON.stringify(orderedSession, undefined, 2),
    );

    const sessionsList = this.readIndex(dir);
    const messageCount = session.history.filter(
      (item) => item.message.role === "assistant",
    ).length;
    const existing = sessionsList.find(
      (m) => m.sessionId === session.sessionId,
    );
    if (existing) {
      existing.title = session.title;
      existing.workspaceDirectory = session.workspaceDirectory;
      existing.messageCount = messageCount;
    } else {
      sessionsList.push({
        sessionId: session.sessionId,
        title: session.title,
        dateCreated: String(Date.now()),
        workspaceDirectory: session.workspaceDirectory,
        messageCount,
      });
    }
    this.writeIndex(dir, sessionsList);
  }
}

const historyManager = new HistoryManager();

export default historyManager;
