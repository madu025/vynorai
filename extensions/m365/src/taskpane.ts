import { createM365ApiClient } from "./api.js";
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
const inspect = document.querySelector<HTMLButtonElement>("#inspect");
const apply = document.querySelector<HTMLButtonElement>("#apply");
let accessToken = "";
let currentPlan: any;

function setStatus(message: string) {
  if (status) status.textContent = message;
}
function officeRuntime(): any {
  return (globalThis as any).Excel;
}

function signInWithOfficeDialog(authorizeUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const office = (globalThis as any).Office;
    if (!office?.context?.ui?.displayDialogAsync)
      return reject(new Error("Office sign-in dialog is unavailable."));
    office.context.ui.displayDialogAsync(
      createOfficeAuthDialogUrl(authorizeUrl),
      { height: 75, width: 50 },
      (result: any) => {
        if (result.status !== office.AsyncResultStatus.Succeeded)
          return reject(
            new Error("Unable to open the Microsoft sign-in dialog."),
          );
        const dialog = result.value;
        const closeWithError = (message: string) => {
          dialog.close();
          reject(new Error(message));
        };
        dialog.addEventHandler(
          office.EventType.DialogMessageReceived,
          (message: any) => {
            try {
              const payload = JSON.parse(message.message) as {
                callbackUrl?: string;
              };
              if (!payload.callbackUrl)
                return closeWithError(
                  "Microsoft sign-in did not return a callback.",
                );
              dialog.close();
              resolve(payload.callbackUrl);
            } catch {
              closeWithError("Microsoft sign-in returned an invalid callback.");
            }
          },
        );
        dialog.addEventHandler(office.EventType.DialogEventReceived, () =>
          closeWithError("Microsoft sign-in was closed or failed."),
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
    accessToken = (await completeM365OAuth(callbackUrl, config)).accessToken;
    setStatus("Signed in. Select data and inspect it.");
  } catch (error) {
    setStatus((error as Error).message);
  }
});

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
    setStatus((error as Error).message);
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
    setStatus((error as Error).message);
  }
});

async function initialize() {
  if (!config) return setStatus("M365 OAuth configuration is missing.");
  setStatus("Sign in to inspect selected Excel data.");
}

void initialize();
