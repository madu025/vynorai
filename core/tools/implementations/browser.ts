import { ToolImpl } from ".";
import { browserSession } from "../browser/session";

function str(args: any, key: string): string | undefined {
  const v = args?.[key];
  return typeof v === "string" && v.trim() ? v : undefined;
}

function need(args: any, key: string): string {
  const v = str(args, key);
  if (!v)
    throw new Error(`The browser "${args?.action}" action needs "${key}".`);
  return v;
}

export const browserImpl: ToolImpl = async (args) => {
  const action = String(args?.action ?? "");
  let note = "";

  switch (action) {
    case "open": {
      const status = await browserSession.navigate(need(args, "url"));
      note = `Opened (HTTP ${status ?? "?"}).`;
      break;
    }
    case "snapshot":
      break;
    case "click":
      await browserSession.click(need(args, "target"));
      note = `Clicked ${args.target}.`;
      break;
    case "type":
      await browserSession.type(
        need(args, "target"),
        String(args.text ?? ""),
        args.submit === true,
      );
      // Typed values are not echoed back (they may be secrets).
      note = `Typed ${String(args.text ?? "").length} characters into ${args.target}${args.submit ? " and pressed Enter" : ""}.`;
      break;
    case "press":
      await browserSession.press(need(args, "key"));
      note = `Pressed ${args.key}.`;
      break;
    case "scroll":
      await browserSession.scroll(typeof args.dy === "number" ? args.dy : 600);
      break;
    case "back":
      await browserSession.back();
      break;
    case "reload":
      await browserSession.reload();
      break;
    case "wait":
      await browserSession.waitFor({
        text: str(args, "text"),
        ms: typeof args.ms === "number" ? args.ms : undefined,
      });
      note = args.text ? `"${args.text}" appeared.` : "Waited.";
      break;
    case "logs": {
      const kind = ["console", "error", "network"].includes(args?.kind)
        ? args.kind
        : undefined;
      const logs = browserSession.getLogs(kind, 60);
      const text = logs.length
        ? logs.map((l) => `[${l.kind}/${l.level}] ${l.text}`).join("\n")
        : "No console, page or network errors recorded.";
      return [
        {
          name: "Browser logs",
          description: `${logs.length} entries`,
          content: text,
        },
      ];
    }
    case "evaluate": {
      const value = await browserSession.evaluate(need(args, "expression"));
      return [
        {
          name: "Browser evaluate",
          description: "Expression result",
          content: value,
        },
      ];
    }
    case "screenshot": {
      const file = await browserSession.screenshot();
      note = `Screenshot saved: ${file}`;
      break;
    }
    case "close":
      await browserSession.close();
      return [
        { name: "Browser", description: "Closed", content: "Browser closed." },
      ];
    default:
      throw new Error(`Unknown browser action "${action}".`);
  }

  const snapshot = await browserSession.snapshot();
  return [
    {
      name: "Browser",
      description: note || `Browser ${action}`,
      content: (note ? `${note}\n\n` : "") + snapshot,
    },
  ];
};
