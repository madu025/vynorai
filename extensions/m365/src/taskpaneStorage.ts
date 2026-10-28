import {
  describeAccessToken,
  stableStorageFingerprint,
} from "./diagnostics.js";

export type TaskpaneStorageKeyDeps = {
  getAccessToken: () => string | undefined;
  getWorkbookUrl: () => string | undefined;
};

const CONVERSATION_KEY_PREFIX = "vynorai.m365.excel.conversation.v1";
const CHATS_KEY_PREFIX = "vynorai.m365.excel.chats.v1";
const RESULTS_KEY_PREFIX = "vynorai.m365.excel.results.v1";
const SCHEDULED_REFRESH_KEY_PREFIX = "vynorai.m365.excel.schedule.v1";

/**
 * Workbook-scoped persistence keys for the task pane.
 *
 * The raw workbook URL never becomes part of a key. The access-token claims
 * and the one-way workbook fingerprint are resolved only when a key is
 * requested, so sign-in, workbook changes and reloads cannot leave stale
 * identity state captured in a controller instance.
 */
export function createTaskpaneStorageKeys(deps: TaskpaneStorageKeyDeps) {
  const claims = () => {
    const accessToken: string | undefined = deps.getAccessToken();
    if (!accessToken) return undefined;
    return describeAccessToken(accessToken);
  };
  const workbook = () => {
    const url = String(deps.getWorkbookUrl() ?? "");
    return url ? stableStorageFingerprint(url) : undefined;
  };

  function conversation(): string | undefined {
    const current = claims();
    if (!current?.tenantId || !current.objectId) return undefined;
    return `${CONVERSATION_KEY_PREFIX}.${current.tenantId}.${current.objectId}`;
  }

  function chats(): string | undefined {
    const current = claims();
    if (!current?.tenantId || !current.objectId) return undefined;
    return `${CHATS_KEY_PREFIX}.${current.tenantId}.${current.objectId}`;
  }

  function results(): string | undefined {
    const current = claims();
    const currentWorkbook = workbook();
    if (!current?.tenantId || !current.objectId || !currentWorkbook) {
      return undefined;
    }
    return `${RESULTS_KEY_PREFIX}.${current.tenantId}.${current.objectId}.${currentWorkbook}`;
  }

  function scheduledRefresh(): string | undefined {
    const current = claims();
    const currentWorkbook = workbook();
    if (!current?.tenantId || !current.objectId || !currentWorkbook) {
      return undefined;
    }
    return `${SCHEDULED_REFRESH_KEY_PREFIX}.${current.tenantId}.${current.objectId}.${currentWorkbook}`;
  }

  return { conversation, chats, results, scheduledRefresh, workbook };
}
