import { createAsyncThunk } from "@reduxjs/toolkit";
import { JSONContent } from "@tiptap/core";
import { PanelCommand } from "../../util/panelCommands";
import { setCompactionLoading, setMode } from "../slices/sessionSlice";
import {
  DEFAULT_PERMISSION_MODE,
  PermissionMode,
  setDialogMessage,
  setPermissionMode,
  setPendingRoute,
  setShowDialog,
} from "../slices/uiSlice";
import { ThunkApiType } from "../store";
import { rewindToUserMessage } from "./rewind";
import { reloadOpenSession, saveCurrentSession } from "./session";
import { updateSelectedModelByRole } from "./updateSelectedModelByRole";
import { streamResponseThunk } from "./streamResponse";

function Info(props: { title: string; lines: string[] }) {
  return (
    <div className="flex flex-col gap-1 p-2 text-sm">
      <div className="font-semibold">{props.title}</div>
      {props.lines.map((line, index) => (
        <div key={index}>{line}</div>
      ))}
    </div>
  );
}

function textDocument(text: string): JSONContent {
  return {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  };
}

function showInfo(dispatch: any, title: string, lines: string[]) {
  dispatch(setDialogMessage(<Info title={title} lines={lines} />));
  dispatch(setShowDialog(true));
}

/**
 * Runs `/clear`, `/compact [focus]` and `/plan [task]` in the panel. Nothing is
 * sent to the model except the optional task after `/plan`.
 */
export const runPanelCommand = createAsyncThunk<
  void,
  {
    command: PanelCommand;
    modifiers: Parameters<typeof streamResponseThunk>[0]["modifiers"];
  },
  ThunkApiType
>(
  "chat/runPanelCommand",
  async ({ command, modifiers }, { dispatch, extra, getState }) => {
    switch (command.name) {
      case "clear": {
        // Same as the New Session button: the old chat stays in History.
        await dispatch(
          saveCurrentSession({ openNewSession: true, generateTitle: true }),
        );
        return;
      }
      case "plan": {
        dispatch(setMode("plan"));
        if (command.arg) {
          await dispatch(
            streamResponseThunk({
              editorState: textDocument(command.arg),
              modifiers,
            }),
          );
        }
        return;
      }
      case "resume": {
        dispatch(setPendingRoute("/history"));
        return;
      }
      case "rewind": {
        // /rewind [n] [chat|code]: the n-th most recent prompt (1 = the last),
        // undoing files and chat, or only one of them.
        const words = command.arg.toLowerCase().split(/\s+/).filter(Boolean);
        const mode = words.includes("chat")
          ? "chat"
          : words.includes("code")
            ? "code"
            : "both";
        const nth = Math.max(
          1,
          Number(words.find((word) => /^\d+$/.test(word)) ?? 1),
        );
        const { history } = getState().session;
        const prompts = history
          .map((item, i) => ({ item, i }))
          .filter(({ item }) => item.message.role === "user");
        const target = prompts[prompts.length - nth];
        const result = target
          ? (await dispatch(rewindToUserMessage({ index: target.i, mode })))
              .payload
          : {
              rewound: false,
              reason:
                prompts.length === 0
                  ? "There is no prompt to rewind."
                  : `There are only ${prompts.length} prompt(s) in this chat.`,
            };
        if (!(result as any)?.rewound) {
          showInfo(dispatch, "Rewind", [
            (result as any)?.reason ?? "Could not rewind.",
          ]);
        }
        return;
      }
      case "model": {
        const state = getState();
        const models = state.config.config.modelsByRole.chat ?? [];
        const current = state.config.config.selectedModelByRole.chat?.title;
        const wanted = command.arg.toLowerCase();
        if (!wanted) {
          showInfo(dispatch, "Chat models", [
            ...models.map(
              (model) =>
                `${model.title === current ? "> " : "  "}${model.title}`,
            ),
            "Use /model <name> to switch.",
          ]);
          return;
        }
        const titles = models.map((model) => model.title);
        const exact = titles.find((title) => title.toLowerCase() === wanted);
        const partial = titles.filter((title) =>
          title.toLowerCase().includes(wanted),
        );
        const pick = exact ?? (partial.length === 1 ? partial[0] : undefined);
        if (!pick) {
          showInfo(dispatch, "Model not switched", [
            partial.length > 1
              ? `More than one model matches "${command.arg}": ${partial.join(", ")}`
              : `No chat model matches "${command.arg}".`,
          ]);
          return;
        }
        await dispatch(
          updateSelectedModelByRole({
            role: "chat",
            modelTitle: pick,
            selectedProfile: null,
          }),
        );
        return;
      }
      case "permissions": {
        const descriptions: Record<PermissionMode, string> = {
          ask: "Ask before every edit and command",
          edits: "Accept edits (ask before commands)",
          auto: "Auto (ask only for risky actions)",
          full: "Full auto (never ask)",
        };
        const wanted = command.arg.toLowerCase() as PermissionMode;
        if (command.arg) {
          if (!Object.hasOwn(descriptions, wanted)) {
            showInfo(dispatch, "Permission mode not changed", [
              `"${command.arg}" is not a mode. Use: ${Object.keys(descriptions).join(", ")}.`,
            ]);
            return;
          }
          dispatch(setPermissionMode(wanted));
        }
        const current = getState().ui.permissionMode ?? DEFAULT_PERMISSION_MODE;
        showInfo(dispatch, "Permissions", [
          `Mode: ${current} (${descriptions[current]})`,
          "Switch with /permissions ask | edits | auto | full.",
          "Allow, ask and deny rules for your project go in .vynorai/permissions.json (deny always wins).",
        ]);
        return;
      }
      case "cost": {
        const { creditsByMessage, turnCredits } = getState().session;
        const chatTotal = Object.values(creditsByMessage ?? {}).reduce(
          (sum, credits) => sum + credits,
          0,
        );
        const lines = [`This chat: ${chatTotal.toLocaleString()} credits`];
        if (turnCredits) {
          lines.push(
            `Current prompt: ${turnCredits.used.toLocaleString()} credits`,
          );
        }
        try {
          const usage = await extra.ideMessenger.request(
            "vynor/usage",
            undefined,
          );
          if (usage.status === "success" && usage.content) {
            lines.push(
              `This month: ${usage.content.used.toLocaleString()} of ${usage.content.limit.toLocaleString()} credits (${usage.content.plan})`,
            );
          }
        } catch {
          // the chat figures above still apply
        }
        showInfo(dispatch, "Credits", lines);
        return;
      }
      case "compact": {
        const { session } = getState();
        const index = session.history.length - 1;
        if (!session.id || index < 0) return;
        try {
          dispatch(setCompactionLoading({ index, loading: true }));
          // Core compacts the saved copy, so make sure it is current.
          await dispatch(
            saveCurrentSession({ openNewSession: false, generateTitle: false }),
          );
          await extra.ideMessenger.request("conversation/compact", {
            index,
            sessionId: session.id,
            instructions: command.arg || undefined,
          });
          await dispatch(reloadOpenSession());
        } finally {
          dispatch(setCompactionLoading({ index, loading: false }));
        }
        return;
      }
    }
  },
);
