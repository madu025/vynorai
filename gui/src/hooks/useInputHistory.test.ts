import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useInputHistory } from "./useInputHistory";

const doc = (text: string) => ({
  type: "doc",
  content: [
    { type: "paragraph", content: text ? [{ type: "text", text }] : [] },
  ],
});

describe("useInputHistory draft recovery", () => {
  it("brings back a cleared draft once with ArrowUp on the empty input", () => {
    const { result } = renderHook(() => useInputHistory("draft-test"));
    act(() => {
      result.current.noteContentRef.current(doc("refactor the billing"), false);
      result.current.noteContentRef.current(doc(""), true); // cleared, not sent
    });
    expect(result.current.prevRef.current(doc(""), true)).toEqual(
      doc("refactor the billing"),
    );
    // Only once: the next ArrowUp goes back to normal history (empty here).
    expect(result.current.prevRef.current(doc(""), true)).toBeUndefined();
  });

  it("does not treat a sent message as a discarded draft", () => {
    const { result } = renderHook(() => useInputHistory("draft-test-2"));
    act(() => {
      result.current.noteContentRef.current(doc("fix login"), false);
      result.current.addRef.current(doc("fix login"));
      result.current.noteContentRef.current(doc(""), true);
    });
    // ArrowUp shows history (the sent message), not a "recovered draft" copy.
    expect(result.current.prevRef.current(doc(""), true)).toEqual(
      doc("fix login"),
    );
  });
});
