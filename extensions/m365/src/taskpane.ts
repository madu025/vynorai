import { createM365ApiClient, M365ApiError } from "./api.js";
import { createExcelPreviewPlan } from "./excel.js";
import {
  beginM365OAuth,
  completeM365OAuth,
  createOfficeAuthDialogUrl,
  type M365OAuthConfig,
} from "./oauth.js";
import {
  applyApprovedExcelPlan,
  inspectSelectedExcelRange,
} from "./officeExcel.js";

declare global {
  interface Window {
    __VYNORAI_M365_CONFIG__?: M365OAuthConfig & { apiBaseUrl: string };
  }
}

const config = window.__VYNORAI_M365_CONFIG__;
const status = document.querySelector<HTMLElement>("#status");
const preview = document.querySelector<HTMLElement>("#preview");
const signIn = document.querySelector<HTMLButtonElement>("#sign-in");
const signOut = document.querySelector<HTMLButtonElement>("#sign-out");
const inspect = document.querySelector<HTMLButtonElement>("#inspect");
const apply = document.querySelector<HTMLButtonElement>("#apply");
const diagnostics = document.querySelector<HTMLElement>("#diagnostics");
let accessToken = "";
let currentPlan: any;
const LEGACY_SESSION_KEY = "vynorai.m365.excel.session";
const SESSION_KEY = "vynorai.m365.excel.session.v2";

interface StoredSession {
  accessToken: string;
  expiresAt: number;
}

function setStatus(message: string) {
  if (status) status.textContent = message;
}
function addDiagnostic(message: string) {
  if (!diagnostics) return;
  const existing =
    diagnostics.textContent === "No sign-in diagnostics yet."
      ? ""
      : `${diagnostics.textContent}\n`;
  diagnostics.textContent = `${existing}${new Date().toISOString()} ${message}`;
}
function officeRuntime(): any {
  return (globalThis as any).Excel;
}

function updateAuthenticationUi(signedIn: boolean) {
  if (signIn) signIn.disabled = signedIn;
  if (signOut) signOut.disabled = !signedIn;
  if (inspect) inspect.disabled = !signedIn;
}

function saveSession(tokens: { accessToken: string; expiresIn: number }) {
  const expiresAt = Date.now() + Math.max(0, tokens.expiresIn - 60) * 1000;
  localStorage.setItem(
    SESSION_KEY,
    JSON.stringify({ accessToken: tokens.accessToken, expiresAt }),
  );
}

function restoreSession(): boolean {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return false;
    const saved = JSON.parse(raw) as StoredSession;
    if (
      !saved.accessToken ||
      !Number.isFinite(saved.expiresAt) ||
      saved.expiresAt <= Date.now()
    ) {
      localStorage.removeItem(SESSION_KEY);
      return false;
    }
    accessToken = saved.accessToken;
    return true;
  } catch {
    localStorage.removeItem(SESSION_KEY);
    return false;
  }
}

function signOutOfMicrosoft() {
  accessToken = "";
  currentPlan = undefined;
  localStorage.removeItem(SESSION_KEY);
  localStorage.removeItem(LEGACY_SESSION_KEY);
  if (apply) apply.disabled = true;
  if (preview) preview.textContent = "No preview yet.";
  updateAuthenticationUi(false);
  setStatus("Signed out. Sign in to inspect selected Excel data.");
}

function handleApiError(error: unknown) {
  if (!(error instanceof M365ApiError)) {
    setStatus((error as Error).message);
    return;
  }
  if (
    [
      "invalid_entra_identity",
      "invalid_entra_token",
      "invalid_entra_token_version",
      "invalid_entra_issuer",
      "jwt expired",
    ].includes(error.code)
  ) {
    signOutOfMicrosoft();
    setStatus(
      "Microsoft session changed or expired. Sign in again to continue.",
    );
    return;
  }
  const messages: Record<string, string> = {
    tenant_disabled:
      "Your Microsoft 365 organization is not enabled in VynorAI yet.",
    M365_IDENTITY_NOT_LINKED:
      "Your Microsoft account must be linked to a VynorAI account by an administrator.",
    insufficient_scope:
      "Microsoft consent is missing a required Excel permission.",
    CREDITS_EXHAUSTED: "The linked VynorAI account has no credits available.",
  };
  setStatus(messages[error.code] || `VynorAI request failed (${error.code}).`);
}

function signInWithOfficeDialog(authorizeUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const office = (globalThis as any).Office;
    if (!office?.context?.ui?.displayDialogAsync)
      return reject(new Error("Office sign-in dialog is unavailable."));
    addDiagnostic("Opening Office Dialog API sign-in window.");
    office.context.ui.displayDialogAsync(
      createOfficeAuthDialogUrl(authorizeUrl),
      { height: 75, width: 50 },
      (result: any) => {
        if (result.status !== office.AsyncResultStatus.Succeeded) {
          addDiagnostic(
            `Dialog open failed: ${result.error?.code || "unknown"} ${result.error?.message || ""}`,
          );
          return reject(
            new Error(
              `Unable to open the Microsoft sign-in dialog (${result.error?.code || "unknown"}).`,
            ),
          );
        }
        const dialog = result.value;
        addDiagnostic("Dialog opened successfully.");
        const closeWithError = (message: string) => {
          dialog.close();
          reject(new Error(message));
        };
        dialog.addEventHandler(
          office.EventType.DialogMessageReceived,
          (message: any) => {
            try {
              addDiagnostic("OAuth callback received from the Office dialog.");
              const payload = JSON.parse(message.message) as {
                callbackUrl?: string;
              };
              if (!payload.callbackUrl)
                return closeWithError(
                  "Microsoft sign-in did not return a callback.",
                );
              setStatus("Completing Microsoft sign-in...");
              dialog.close();
              resolve(payload.callbackUrl);
            } catch {
              closeWithError("Microsoft sign-in returned an invalid callback.");
            }
          },
        );
        dialog.addEventHandler(
          office.EventType.DialogEventReceived,
          (event: any) => {
            addDiagnostic(
              `Dialog event: ${event.error || "unknown"} ${event.message || "closed"}`,
            );
            closeWithError(
              `Microsoft sign-in dialog event ${event.error || "unknown"}: ${event.message || "closed"}`,
            );
          },
        );
      },
    );
  });
}

signIn?.addEventListener("click", async () => {
  if (!config) return setStatus("M365 OAuth configuration is missing.");
  try {
    setStatus("Opening Microsoft sign-in...");
    const callbackUrl = await signInWithOfficeDialog(
      await beginM365OAuth(config),
    );
    addDiagnostic("Exchanging the one-time authorization code.");
    const tokens = await completeM365OAuth(callbackUrl, config);
    accessToken = tokens.accessToken;
    saveSession(tokens);
    updateAuthenticationUi(true);
    addDiagnostic("Microsoft sign-in completed successfully.");
    setStatus("Signed in. Select data and inspect it.");
  } catch (error) {
    addDiagnostic((error as Error).message);
    setStatus((error as Error).message);
  }
});

signOut?.addEventListener("click", signOutOfMicrosoft);

inspect?.addEventListener("click", async () => {
  if (!config || !accessToken)
    return setStatus("Sign in before inspecting Excel data.");
  try {
    setStatus("Inspecting the selected range...");
    const input = await inspectSelectedExcelRange(
      officeRuntime(),
      crypto.randomUUID(),
    );
    currentPlan = await createM365ApiClient(
      config.apiBaseUrl,
      accessToken,
    ).planExcel({
      ...input,
      actions: ["table", "chart", "new-sheet", "pivot-table"],
    });
    const localPreview = createExcelPreviewPlan(
      input,
      currentPlan.actions.map((action: any) => action.kind),
    );
    if (preview)
      preview.textContent = JSON.stringify(
        {
          profile: currentPlan.profile,
          actions: localPreview.actions,
          warnings: currentPlan.warnings,
        },
        null,
        2,
      );
    if (apply) apply.disabled = false;
    setStatus("Preview ready. Review it before applying.");
  } catch (error) {
    handleApiError(error);
  }
});

apply?.addEventListener("click", async () => {
  if (!config || !accessToken || !currentPlan)
    return setStatus("Create a preview before applying.");
  if (
    !window.confirm(
      "Apply the approved Excel changes? Original source data will be preserved.",
    )
  )
    return;
  try {
    setStatus("Requesting approval...");
    const client = createM365ApiClient(config.apiBaseUrl, accessToken);
    await client.approveExcel({
      planId: currentPlan.planId,
      sourceFingerprint: currentPlan.sourceFingerprint,
      approvalToken: currentPlan.approvalToken,
    });
    await applyApprovedExcelPlan(
      officeRuntime(),
      currentPlan,
      true,
      currentPlan.approvalToken,
    );
    setStatus("Excel changes applied to the approved result.");
  } catch (error) {
    handleApiError(error);
  }
});

async function initialize() {
  localStorage.removeItem(LEGACY_SESSION_KEY);
  if (!config) {
    addDiagnostic("M365 OAuth runtime configuration was not loaded.");
    return setStatus("M365 OAuth configuration is missing.");
  }
  if (restoreSession()) {
    updateAuthenticationUi(true);
    addDiagnostic("Restored the unexpired Microsoft sign-in session.");
    return setStatus("Signed in. Select data and inspect it.");
  }
  updateAuthenticationUi(false);
  setStatus("Sign in to inspect selected Excel data.");
}

void initialize();
