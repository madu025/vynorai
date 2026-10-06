import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  ToolCallStatusMessage,
  toolOutputSummary,
} from "./ToolCallStatusMessage";

const readTool: any = {
  displayTitle: "Read File",
  function: { name: "read_file" },
  wouldLikeTo: "read {{{ filepath }}}",
  isCurrently: "reading {{{ filepath }}}",
  hasAlready: "read {{{ filepath }}}",
};

function state(
  status: string,
  output?: any[],
  toolName = "read_file",
  parsedArgs: Record<string, unknown> = { filepath: "src/auth.ts" },
): any {
  return {
    toolCallId: "t1",
    status,
    parsedArgs,
    toolCall: {
      id: "t1",
      type: "function",
      function: { name: toolName, arguments: "{}" },
    },
    output,
  };
}

function title(status: string, output?: any[]) {
  render(
    <ToolCallStatusMessage
      tool={readTool}
      toolCallState={state(status, output)}
    />,
  );
  return screen.getByTestId("tool-call-title").textContent;
}

describe("ToolCallStatusMessage", () => {
  it("renders a compact title with the real output size", () => {
    const output = [{ name: "auth.ts", description: "", content: "a\nb\nc\n" }];
    expect(title("done", output)).toBe("Read src/auth.ts · 3 lines");
  });

  it("follows the call status", () => {
    expect(title("calling")).toBe("Reading src/auth.ts");
  });

  it("marks approval, cancel and failure without brand text", () => {
    expect(title("generated")).toBe("Read src/auth.ts · needs approval");
  });

  it("never shows the upstream product name", () => {
    expect(title("canceled")).not.toMatch(/Continue/);
  });
});

describe("toolOutputSummary", () => {
  it("counts the content written by create_new_file instead of its status message", () => {
    const success = [
      { name: "", description: "", content: "File created successfully" },
    ];
    expect(
      toolOutputSummary(
        state("done", success, "create_new_file", {
          filepath: "src/new.ts",
          contents: "one\ntwo\nthree\nfour\n",
        }),
      ),
    ).toBe("4 lines");
    expect(
      toolOutputSummary(
        state("done", success, "create_new_file", {
          filepath: "src/new.ts",
          contents: "one\r\ntwo\r\n",
        }),
      ),
    ).toBe("2 lines");
  });

  it("summarizes multiple results and empty output", () => {
    const many = [1, 2, 3].map((n) => ({
      name: `${n}`,
      description: "",
      content: "x",
    }));
    expect(toolOutputSummary(state("done", many))).toBe("3 results");
    expect(
      toolOutputSummary(
        state("done", [{ name: "", description: "", content: "  " }]),
      ),
    ).toBe("no output");
    expect(toolOutputSummary(state("calling", many))).toBeNull();
    expect(toolOutputSummary(state("done", {} as any))).toBeNull();
  });
});
