import { renderHook } from "@testing-library/react";
import { createElement, ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { IdeMessengerContext } from "../context/IdeMessenger";
import { useWebviewListener } from "./useWebviewListener";

function setup(listeners: number) {
  const respond = vi.fn();
  const handled = vi.fn(async () => undefined);
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(
      IdeMessengerContext.Provider,
      { value: { respond } as never },
      children,
    );
  for (let i = 0; i < listeners; i++) {
    renderHook(() => useWebviewListener("newSession", handled, []), {
      wrapper,
    });
  }
  const post = (data: unknown, messageId: string) =>
    window.dispatchEvent(
      new MessageEvent("message", {
        data: { messageType: "newSession", messageId, data },
      }),
    );
  const settle = () => new Promise((r) => setTimeout(r, 20));
  return { respond, handled, post, settle };
}

describe("useWebviewListener", () => {
  it("answers a request once even when three components listen for it", async () => {
    const { respond, handled, post, settle } = setup(3);
    post(undefined, "req-1");
    await settle();
    expect(handled).toHaveBeenCalledTimes(3); // every listener does its work
    expect(respond).toHaveBeenCalledTimes(1); // the extension hears one answer
  });

  it("does not treat an error reply under the request's type as a request", async () => {
    const { respond, handled, post, settle } = setup(3);
    post({ done: true, status: "error", error: "Unsupported" }, "req-2");
    await settle();
    expect(handled).not.toHaveBeenCalled();
    expect(respond).not.toHaveBeenCalled();
  });

  it("still handles a new request with a new id", async () => {
    const { respond, post, settle } = setup(2);
    post(undefined, "req-3");
    post(undefined, "req-4");
    await settle();
    expect(respond).toHaveBeenCalledTimes(2);
  });
});
