import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("vscode", () => ({}));
vi.mock("./util/errorHandling", () => ({
  handleLLMError: vi.fn().mockResolvedValue(false),
}));

import { VsCodeWebviewProtocol } from "./webviewProtocol";
import { handleLLMError } from "./util/errorHandling";

describe("VsCodeWebviewProtocol startup queue", () => {
  let receive: (message: unknown) => Promise<void>;
  let postMessage: ReturnType<typeof vi.fn>;
  let protocol: VsCodeWebviewProtocol;

  beforeEach(() => {
    postMessage = vi.fn();
    protocol = new VsCodeWebviewProtocol();
    protocol.webview = {
      onDidReceiveMessage: vi.fn((handler) => {
        receive = handler;
        return { dispose: vi.fn() };
      }),
      postMessage,
    } as never;
  });

  it("replays a workspace request received before Core registers its handler", async () => {
    const message = {
      messageId: "startup-request",
      messageType: "workspace/getSnapshot",
      data: undefined,
    };

    await receive(message);
    expect(postMessage).not.toHaveBeenCalled();

    protocol.on("workspace/getSnapshot", async () => ({
      id: "workspace-id",
      revision: 1,
      roots: [],
      manifests: [],
      instructions: [],
      index: [],
      trusted: true,
      capabilities: ["workspace-context"],
      createdAt: 1,
    }));

    await vi.waitFor(() => {
      expect(postMessage).toHaveBeenCalledWith({
        messageType: "workspace/getSnapshot",
        messageId: "startup-request",
        data: expect.objectContaining({
          done: true,
          status: "success",
          content: expect.objectContaining({ id: "workspace-id" }),
        }),
      });
    });
  });

  it("ignores malformed webview messages without crashing the extension host", async () => {
    await expect(receive(null)).resolves.toBeUndefined();
    expect(postMessage).not.toHaveBeenCalled();
  });

  it("sends one safe response when a model error is handled by VS Code", async () => {
    vi.mocked(handleLLMError).mockResolvedValueOnce(true);
    protocol.on("workspace/getSnapshot", async () => {
      throw new Error("Ollama may not be running");
    });

    await receive({
      messageId: "handled-model-error",
      messageType: "workspace/getSnapshot",
      data: undefined,
    });

    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(postMessage).toHaveBeenCalledWith({
      messageType: "workspace/getSnapshot",
      messageId: "handled-model-error",
      data: { done: true, status: "error" },
    });
  });

  it("routes an outbound response to its pending request instead of the startup queue", async () => {
    const responsePromise = protocol.request(
      "setTheme",
      { theme: {} as never },
      false,
    );
    const outbound = postMessage.mock.calls.at(-1)?.[0];

    await receive({
      messageId: outbound.messageId,
      messageType: "setTheme",
      data: { done: true, status: "success", content: undefined },
    });

    await expect(responsePromise).resolves.toEqual({
      done: true,
      status: "success",
      content: undefined,
    });
    expect((protocol as any).pendingMessages).toHaveLength(0);
    expect((protocol as any).pendingRequests.size).toBe(0);
  });

  it("rejects unsupported messages immediately after startup is sealed", async () => {
    protocol.sealStartupQueue();

    await receive({
      messageId: "unknown-request",
      messageType: "future/unknown",
      data: undefined,
    });

    expect(postMessage).toHaveBeenCalledWith({
      messageId: "unknown-request",
      messageType: "future/unknown",
      data: {
        done: true,
        status: "error",
        error: "Unsupported webview protocol message: future/unknown",
      },
    });
    expect((protocol as any).pendingMessages).toHaveLength(0);
  });

  it("keeps earlier startup requests when the bounded queue is full", async () => {
    await receive({
      messageId: "oldest-request",
      messageType: "workspace/getSnapshot",
      data: undefined,
    });
    for (let index = 1; index < 100; index++) {
      await receive({
        messageId: `queued-${index}`,
        messageType: `startup/${index}`,
        data: undefined,
      });
    }

    await receive({
      messageId: "overflow-request",
      messageType: "startup/overflow",
      data: undefined,
    });
    protocol.on("workspace/getSnapshot", async () => ({
      id: "preserved-workspace",
      revision: 1,
      roots: [],
      manifests: [],
      instructions: [],
      index: [],
      trusted: true,
      capabilities: ["workspace-context"],
      createdAt: 1,
    }));

    await vi.waitFor(() => {
      expect(postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          messageId: "overflow-request",
          data: expect.objectContaining({ status: "error" }),
        }),
      );
      expect(postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          messageId: "oldest-request",
          data: expect.objectContaining({
            status: "success",
            content: expect.objectContaining({ id: "preserved-workspace" }),
          }),
        }),
      );
    });
  });
});
