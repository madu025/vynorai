import { FromWebviewProtocol, ToWebviewProtocol } from "core/protocol";
import { Message } from "core/protocol/messenger";
import { v4 as uuidv4 } from "uuid";
import * as vscode from "vscode";

import { IMessenger } from "../../../core/protocol/messenger";

import { handleLLMError } from "./util/errorHandling";

export class VsCodeWebviewProtocol
  implements IMessenger<FromWebviewProtocol, ToWebviewProtocol>
{
  private static readonly MAX_PENDING_MESSAGES = 100;

  listeners = new Map<
    keyof FromWebviewProtocol,
    ((message: Message) => any)[]
  >();
  private pendingMessages: Message[] = [];
  private pendingRequests = new Map<
    string,
    (value: ToWebviewProtocol[keyof ToWebviewProtocol][1] | undefined) => void
  >();
  private startupComplete = false;
  private warnedUnsupportedTypes = new Set<string>();

  send(messageType: string, data: any, messageId?: string): string {
    const id = messageId ?? uuidv4();
    this.webview?.postMessage({
      messageType,
      data,
      messageId: id,
    });
    return id;
  }

  on<T extends keyof FromWebviewProtocol>(
    messageType: T,
    handler: (
      message: Message<FromWebviewProtocol[T][0]>,
    ) => Promise<FromWebviewProtocol[T][1]> | FromWebviewProtocol[T][1],
  ): void {
    if (!this.listeners.has(messageType)) {
      this.listeners.set(messageType, []);
    }
    this.listeners.get(messageType)?.push(handler);

    const pending = this.pendingMessages.filter(
      (message) => message.messageType === messageType,
    );
    if (pending.length > 0) {
      this.pendingMessages = this.pendingMessages.filter(
        (message) => message.messageType !== messageType,
      );
      for (const message of pending) {
        void this.handleMessage(message);
      }
    }
  }

  _webview?: vscode.Webview;
  _webviewListener?: vscode.Disposable;

  get webview(): vscode.Webview | undefined {
    return this._webview;
  }

  set webview(webView: vscode.Webview) {
    if (this._webview && this._webview !== webView) {
      // Responses registered on the old webview can never arrive. Resolve
      // them instead of leaking one listener and one promise per request.
      for (const resolve of this.pendingRequests.values()) resolve(undefined);
      this.pendingRequests.clear();
    }
    this._webview = webView;
    this._webviewListener?.dispose();

    this._webviewListener = this._webview.onDidReceiveMessage(
      this.handleMessage,
    );
  }

  private readonly handleMessage = async (msg: Message): Promise<void> => {
    if (
      !msg ||
      typeof msg !== "object" ||
      !("messageType" in msg) ||
      !("messageId" in msg)
    ) {
      console.warn("Ignoring invalid webview protocol message");
      return;
    }

    // A response to an extension -> webview request is delivered to the same
    // VS Code message event as a webview -> extension request. Previously the
    // permanent listener treated each response as a new request and queued it
    // as an unregistered startup message. Long agent sessions eventually
    // filled that queue and evicted real workspace requests.
    const pendingRequest = this.pendingRequests.get(msg.messageId);
    if (pendingRequest) {
      this.pendingRequests.delete(msg.messageId);
      pendingRequest(msg.data);
      return;
    }

    const respond = (message: any) =>
      this.send(msg.messageType, message, msg.messageId);

    const handlers =
      this.listeners.get(msg.messageType as keyof FromWebviewProtocol) || [];
    if (handlers.length === 0) {
      if (this.startupComplete) {
        if (!this.warnedUnsupportedTypes.has(msg.messageType)) {
          this.warnedUnsupportedTypes.add(msg.messageType);
          console.warn(
            `Ignoring unsupported webview protocol message: ${msg.messageType}`,
          );
        }
        respond({
          done: true,
          error: `Unsupported webview protocol message: ${msg.messageType}`,
          status: "error",
        });
        return;
      }
      if (
        this.pendingMessages.length >=
        VsCodeWebviewProtocol.MAX_PENDING_MESSAGES
      ) {
        // Preserve the earliest startup requests because their handlers may
        // still be registering. Reject the newest request instead of evicting
        // an older, valid workspace request.
        respond({
          done: true,
          error: "VynorAI core startup queue exceeded its safe limit.",
          status: "error",
        });
        return;
      }
      this.pendingMessages.push(msg);
      return;
    }

    for (const handler of handlers) {
      try {
        const response = await handler(msg);
        // For generator types e.g. llm/streamChat
        if (response && typeof response[Symbol.asyncIterator] === "function") {
          let next = await response.next();
          while (!next.done) {
            respond({
              done: false,
              content: next.value,
              status: "success",
            });
            next = await response.next();
          }
          respond({
            done: true,
            content: next.value,
            status: "success",
          });
        } else {
          respond({ done: true, content: response, status: "success" });
        }
      } catch (e: any) {
        if (await handleLLMError(e)) {
          // Respond without an error, so the UI doesn't show the error component
          respond({ done: true, status: "error" });
          return;
        }
        let message = e.message;
        respond({ done: true, error: message, status: "error" });

        const stringified = JSON.stringify({ msg }, null, 2);
        console.error(`Error handling webview message: ${stringified}\n\n${e}`);

        if (
          stringified.includes("llm/streamChat") ||
          stringified.includes("chatDescriber/describe")
        ) {
          return;
        }

        if (e.cause) {
          if (e.cause.name === "ConnectTimeoutError") {
            message = `Connection timed out. If you expect it to take a long time to connect, you can increase the timeout in your config by setting "requestOptions": { "timeout": 10000 }. You can find the full config reference here: https://docs.continue.dev/reference/config`;
          } else if (e.cause.code === "ECONNREFUSED") {
            message = `Connection was refused. This likely means that there is no server running at the specified URL. If you are running your own server you may need to set the "apiBase" parameter in config.json. For example, you can set up an OpenAI-compatible server like here: https://docs.continue.dev/reference/Model%20Providers/openai#openai-compatible-servers--apis`;
          } else {
            message = `The request failed with "${e.cause.name}": ${e.cause.message}. If you're having trouble setting up Continue, please see the troubleshooting guide for help.`;
          }
        }
      }
    }
  };

  constructor() {}

  /**
   * Core and extension protocol handlers register synchronously during
   * activation. After that point, an unhandled type is a version/protocol
   * mismatch, not a startup race, and must not remain queued forever.
   */
  sealStartupQueue(): void {
    this.startupComplete = true;
    const unsupported = this.pendingMessages;
    this.pendingMessages = [];
    for (const message of unsupported) {
      this.send(
        message.messageType,
        {
          done: true,
          error: `Unsupported webview protocol message: ${message.messageType}`,
          status: "error",
        },
        message.messageId,
      );
    }
  }

  invoke<T extends keyof FromWebviewProtocol>(
    messageType: T,
    data: FromWebviewProtocol[T][0],
    messageId?: string,
  ): FromWebviewProtocol[T][1] {
    throw new Error("Method not implemented.");
  }

  onError(handler: (message: Message, error: Error) => void): void {
    throw new Error("Method not implemented.");
  }

  public request<T extends keyof ToWebviewProtocol>(
    messageType: T,
    data: ToWebviewProtocol[T][0],
    retry: boolean = true,
  ): Promise<ToWebviewProtocol[T][1]> {
    const messageId = uuidv4();
    return new Promise(async (resolve) => {
      if (retry) {
        let i = 0;
        while (!this.webview) {
          if (i >= 10) {
            resolve(undefined);
            return;
          } else {
            await new Promise((res) => setTimeout(res, i >= 5 ? 1000 : 500));
            i++;
          }
        }
      }

      if (!this.webview) {
        resolve(undefined);
        return;
      }

      // Register before posting so even a synchronous test webview cannot
      // race the response ahead of its resolver.
      this.pendingRequests.set(messageId, resolve as never);
      this.send(messageType, data, messageId);
    });
  }
}
