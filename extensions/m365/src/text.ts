import { createM365ApiClient, M365ApiError } from "./api.js";
import { askInPane } from "./confirmDialog.js";
import { initWordPanels } from "./wordPanels.js";
import {
  beginM365OAuth,
  completeM365OAuth,
  createOfficeAuthDialogUrl,
  type M365OAuthConfig,
} from "./oauth.js";
import {
  TASKS_BY_HOST,
  TextConsentError,
  TextTooLongError,
  buildAssistRequest,
  validateAssistResult,
  type TextHost,
  type TextTask,
  type TextTone,
} from "./textAssist.js";

declare global {
  interface Window {
    __VYNORAI_M365_CONFIG__?: M365OAuthConfig & { apiBaseUrl: string };
  }
}

const SESSION_KEY = "vynorai.m365.text.session.v1";
const rawConfig = window.__VYNORAI_M365_CONFIG__;
// The text add-in asks for its own scopes; the Excel ones are never requested here.
const config = rawConfig && {
  ...rawConfig,
  scopes: rawConfig.scopes.map((scope) =>
    scope.replace("m365.excel.", "m365.text."),
  ),
};
const $ = <T extends HTMLElement>(selector: string) =>
  document.querySelector<T>(selector);
const statusLine = $("#status");
const signIn = $<HTMLButtonElement>("#sign-in");
const signOut = $<HTMLButtonElement>("#sign-out");
const taskSelect = $<HTMLSelectElement>("#task");
const toneSelect = $<HTMLSelectElement>("#tone");
const readButton = $<HTMLButtonElement>("#read");
const sourceBox = $<HTMLTextAreaElement>("#source");
const sizeNote = $("#size");
const consent = $<HTMLInputElement>("#consent");
const run = $<HTMLButtonElement>("#run");
const output = $<HTMLTextAreaElement>("#output");
const notes = $("#notes");
const insert = $<HTMLButtonElement>("#insert");
const copy = $<HTMLButtonElement>("#copy");
let accessToken = "";

const office = () => (globalThis as any).Office;
const setStatus = (message: string) => {
  if (statusLine) statusLine.textContent = message;
};

function currentHost(): TextHost | undefined {
  const host = String(office()?.context?.host ?? "").toLowerCase();
  if (host.includes("word")) return "word";
  if (host.includes("powerpoint")) return "powerpoint";
  if (host.includes("outlook")) return "outlook";
  return undefined;
}

function updateUi() {
  const signedIn = Boolean(accessToken);
  if (signIn) signIn.hidden = signedIn;
  if (signOut) signOut.hidden = !signedIn;
  for (const element of [readButton, run] as Array<HTMLButtonElement | null>)
    if (element) element.disabled = !signedIn;
  document.body.dataset.auth = signedIn ? "in" : "out";
}

function restoreSession() {
  try {
    const saved = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
    if (saved?.accessToken && saved.expiresAt > Date.now())
      accessToken = saved.accessToken;
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    accessToken = "";
  }
}

function signInWithDialog(authorizeUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const host = office();
    if (!host?.context?.ui?.displayDialogAsync)
      return reject(new Error("Office sign-in dialog is unavailable."));
    host.context.ui.displayDialogAsync(
      createOfficeAuthDialogUrl(authorizeUrl),
      { height: 75, width: 50 },
      (result: any) => {
        if (result.status !== host.AsyncResultStatus.Succeeded)
          return reject(
            new Error("Unable to open the Microsoft sign-in dialog."),
          );
        const dialog = result.value;
        dialog.addEventHandler(
          host.EventType.DialogMessageReceived,
          (message: any) => {
            try {
              const payload = JSON.parse(message.message) as {
                callbackUrl?: string;
              };
              dialog.close();
              if (!payload.callbackUrl) throw new Error("no callback");
              resolve(payload.callbackUrl);
            } catch {
              reject(
                new Error("Microsoft sign-in returned an invalid callback."),
              );
            }
          },
        );
        dialog.addEventHandler(host.EventType.DialogEventReceived, () => {
          dialog.close();
          reject(new Error("Microsoft sign-in was closed."));
        });
      },
    );
  });
}

signIn?.addEventListener("click", async () => {
  if (!config) return setStatus("M365 OAuth configuration is missing.");
  try {
    setStatus("Opening Microsoft sign-in...");
    const callbackUrl = await signInWithDialog(await beginM365OAuth(config));
    const tokens = await completeM365OAuth(callbackUrl, config);
    accessToken = tokens.accessToken;
    try {
      localStorage.setItem(
        SESSION_KEY,
        JSON.stringify({
          accessToken,
          expiresAt: Date.now() + Math.max(0, tokens.expiresIn - 60) * 1000,
        }),
      );
    } catch {
      // The session simply will not survive closing the pane.
    }
    updateUi();
    setStatus("Signed in. Select text and click Read selection.");
  } catch (error) {
    setStatus((error as Error).message);
  }
});

signOut?.addEventListener("click", () => {
  accessToken = "";
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    // Nothing stored.
  }
  if (output) output.value = "";
  updateUi();
  setStatus("Signed out.");
});

function readSelection(host: TextHost): Promise<string> {
  const api = office();
  return new Promise((resolve, reject) => {
    const onData = (result: any) =>
      result.status === api.AsyncResultStatus.Succeeded
        ? resolve(String(result.value ?? ""))
        : reject(new Error("Could not read the selection."));
    if (host === "outlook") {
      const item = api.context.mailbox?.item;
      if (!item) return reject(new Error("Open a message first."));
      const readBody = () => item.body.getAsync(api.CoercionType.Text, onData);
      if (item.getSelectedDataAsync)
        return item.getSelectedDataAsync(
          api.CoercionType.Text,
          (result: any) => {
            const selected =
              result.status === api.AsyncResultStatus.Succeeded
                ? String(result.value?.data ?? "")
                : "";
            return selected.trim() ? resolve(selected) : readBody();
          },
        );
      return readBody();
    }
    api.context.document.getSelectedDataAsync(api.CoercionType.Text, onData);
  });
}

readButton?.addEventListener("click", async () => {
  const host = currentHost();
  if (!host)
    return setStatus("Open this add-in in Word, PowerPoint or Outlook.");
  try {
    const text = await readSelection(host);
    if (consent) consent.checked = false;
    if (sourceBox) sourceBox.value = text;
    if (sizeNote)
      sizeNote.textContent = `${text.length} characters will be sent.`;
    setStatus(
      text.trim()
        ? "Review the text below. It is only sent after you agree."
        : "Nothing is selected.",
    );
  } catch (error) {
    setStatus((error as Error).message);
  }
});

run?.addEventListener("click", async () => {
  const host = currentHost();
  if (!config || !accessToken || !host) return;
  try {
    const request = buildAssistRequest({
      host,
      task: (taskSelect?.value || "summarize") as TextTask,
      tone: (toneSelect?.value || undefined) as TextTone | undefined,
      text: sourceBox?.value || "",
      language: "auto",
      consent: consent?.checked === true,
    });
    run.disabled = true;
    setStatus("Working...");
    const response = await createM365ApiClient(
      config.apiBaseUrl,
      accessToken,
    ).assistText(request);
    const result = validateAssistResult(response?.result);
    // Consent covers exactly one send; the next text needs its own agreement.
    if (consent) consent.checked = false;
    if (output) output.value = result.text;
    if (notes) notes.textContent = (result.notes ?? []).join(" ");
    if (insert) insert.disabled = false;
    if (copy) copy.disabled = false;
    setStatus("Done. Nothing in your document has changed yet.");
  } catch (error) {
    if (error instanceof TextConsentError)
      setStatus("Tick the box to agree before the text is sent.");
    else if (error instanceof TextTooLongError)
      setStatus("Select less text (the limit is 8000 characters).");
    else if (error instanceof M365ApiError)
      setStatus(
        error.code === "AI_DISABLED_BY_ADMIN"
          ? "AI assistance is turned off for your organization."
          : `Request failed (${error.code}).`,
      );
    else setStatus((error as Error).message);
  } finally {
    updateUi();
  }
});

/** Insert is explicit, additive and available only where the host can do it without replacing text. */
insert?.addEventListener("click", async () => {
  const host = currentHost();
  const text = output?.value || "";
  if (!host || !text) return;
  if (
    !(await askInPane(
      "Insert this text into the document? Nothing is replaced.",
      "Insert",
    ))
  )
    return;
  try {
    if (host === "word") {
      await (globalThis as any).Word.run(async (context: any) => {
        context.document.getSelection().insertText(text, "After");
        await context.sync();
      });
      return setStatus("Inserted after the selection.");
    }
    if (host === "outlook") {
      const item = office().context.mailbox?.item;
      if (item?.body?.prependAsync) {
        item.body.prependAsync(
          text,
          { coercionType: office().CoercionType.Text },
          () => setStatus("Added at the top of the message. Nothing was sent."),
        );
        return;
      }
    }
    setStatus("Use Copy and paste where you want it.");
  } catch (error) {
    setStatus((error as Error).message);
  }
});

copy?.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(output?.value || "");
    setStatus("Copied.");
  } catch {
    output?.select();
    document.execCommand("copy");
    setStatus("Copied.");
  }
});

async function initialize() {
  try {
    await office()?.onReady?.();
  } catch {
    // Reported by the host status below.
  }
  const host = currentHost();
  if (taskSelect && host) {
    taskSelect.textContent = "";
    for (const task of TASKS_BY_HOST[host]) {
      const option = document.createElement("option");
      option.value = task;
      option.textContent = task.replace(/-/g, " ");
      taskSelect.appendChild(option);
    }
  }
  if (insert) insert.disabled = true;
  if (copy) copy.disabled = true;
  restoreSession();
  updateUi();
  if (host === "word" && config) {
    initWordPanels({
      client: () =>
        accessToken
          ? createM365ApiClient(config.apiBaseUrl, accessToken)
          : undefined,
      setStatus,
      readSelection: () => readSelection("word"),
    });
  }
  setStatus(
    accessToken
      ? "Signed in. Select text and click Read selection."
      : "Sign in to continue.",
  );
}

void initialize();
