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
});
