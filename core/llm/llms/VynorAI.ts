/**
 * VynorAI LLM Provider for the Continue extension.
 *
 * Architecture:
 *  User installs VynorAI extension
 *  → sets their vynor_live_... API key once
 *  → Extension sends ALL requests to VynorAI Cloud proxy
 *  → Proxy buys from OpenRouter at wholesale price
 *  → VynorAI makes margin + adds caching/agentic layer
 *
 * The extension user never needs an OpenRouter key.
 * They only use their VynorAI subscription key.
 */

import OpenAI from "./OpenAI.js";
import { ChatMessage, CompletionOptions, LLMOptions } from "../../index.js";
import { osModelsEditPrompt } from "../templates/edit.js";
import { fromChatCompletionChunk } from "../openaiTypeConverters.js";
import { streamSse } from "@continuedev/fetch";
import { retryAsync } from "../utils/retry.js";

// Default to deployed cloud URL; fallback to local dev server
const VYNORAI_API_BASE = process.env.VYNORAI_API_BASE || "https://vynor.lk/v1/";

class VynorAI extends OpenAI {
  static providerName = "vynorai";
  protected supportsReasoningField = true;
  protected supportsReasoningDetailsField = true;
  // DeepSeek thinking mode with tools rejects history without reasoning_content.
  protected supportsReasoningContentField = true;

  static defaultOptions: Partial<LLMOptions> = {
    apiBase: VYNORAI_API_BASE,
    // Best default: DeepSeek V3 via OpenRouter — cheapest with great code quality
    model: "deepseek/deepseek-chat-v3-0324:free",
    useLegacyCompletionsEndpoint: false,
    template: "none" as any,
    promptTemplates: {
      edit: osModelsEditPrompt,
    },
  };

  constructor(options: LLMOptions) {
    super({
      ...options,
      template: "none" as any,
      // Ensure the proxy URL always ends with /
      apiBase: (options.apiBase || VYNORAI_API_BASE).replace(/\/?$/, "/"),
      requestOptions: {
        ...options.requestOptions,
        headers: {
          // VynorAI subscription key passed as Bearer token
          ...(options.apiKey
            ? { Authorization: `Bearer ${options.apiKey}` }
            : {}),
          "X-VynorAI-Client": "vscode-extension",
          "X-VynorAI-Version": "2.0.0",
          ...options.requestOptions?.headers,
        },
      },
    });
  }

  /**
   * Override _streamChat to intercept VynorAI quota limits, show actionable upgrade messages,
   * and auto-reconnect on transient network dropouts.
   */
  protected async *_streamChat(
    messages: ChatMessage[],
    signal: AbortSignal,
    options: CompletionOptions,
  ): AsyncGenerator<ChatMessage> {
    const body = this._convertArgs(options, messages);

    const response = await retryAsync(
      () =>
        this.fetch(this._getEndpoint("chat/completions"), {
          method: "POST",
          headers: this._getHeaders(),
          body: JSON.stringify({
            ...body,
            ...this.extraBodyProperties(),
          }),
          signal,
        }),
      {
        maxAttempts: 3,
        baseDelay: 500,
        maxDelay: 3000,
        shouldRetry: (error: any) => {
          if (signal?.aborted) return false;
          const status =
            error?.status || error?.statusCode || error?.response?.status;
          if (status === 401 || status === 403 || status === 400) return false;
          if (status === 429 || (status >= 500 && status < 600)) return true;
          const code = error?.code || error?.errno;
          if (
            code === "ECONNRESET" ||
            code === "ECONNREFUSED" ||
            code === "ETIMEDOUT" ||
            code === "ENOTFOUND" ||
            code === "EAI_AGAIN"
          ) {
            return true;
          }
          return Boolean(
            error instanceof TypeError &&
              error.message.includes("fetch failed"),
          );
        },
      },
    );

    if (response.status === 403 || response.status === 429) {
      try {
        const errorJson = await response.json();
        const errObj = errorJson?.error;
        if (
          errObj?.code === "monthly_limit_reached" ||
          errObj?.type === "quota_exceeded"
        ) {
          const upgradePlan = errObj.upgradePlan;
          const upgradeMsg = upgradePlan
            ? `\n\n⚡ **Upgrade to ${upgradePlan.displayName} Plan** (LKR ${upgradePlan.priceLKR.toLocaleString()}/mo) for **${(upgradePlan.monthlyTokens / 1_000_000).toFixed(0)}M tokens**: [👉 Click here to Upgrade](${errObj.upgradeUrl || "https://vynor.lk/#pricing"})`
            : `\n\n👉 Upgrade your plan at [vynor.lk/#pricing](${errObj.upgradeUrl || "https://vynor.lk/#pricing"})`;

          yield {
            role: "assistant",
            content: `⚠️ **VynorAI Monthly Quota Reached**\n\n${errObj.message || "You have reached your monthly token or request limit for this billing cycle."}${upgradeMsg}`,
          };
          return;
        }

        if (
          errObj?.code === "model_locked" ||
          errObj?.code === "model_not_allowed" ||
          errObj?.type === "plan_restriction" ||
          errObj?.type === "tier_restricted"
        ) {
          const upgradePlan = errObj.upgradePlan;
          const upgradeMsg = upgradePlan
            ? `\n\n⚡ **Upgrade to ${upgradePlan.displayName} Plan** (LKR ${upgradePlan.priceLKR.toLocaleString()}/mo): [👉 Click here to Upgrade](${errObj.upgradeUrl || "https://vynor.lk/#pricing"})`
            : `\n\n👉 [Click here to Upgrade Your Plan](${errObj.upgradeUrl || "https://vynor.lk/#pricing"}) to unlock this Thinking/Premium model.`;

          yield {
            role: "assistant",
            content: `🔒 **Model Locked (Upgrade Required)**\n\n${errObj.message || "This model requires an upgraded plan."}${upgradeMsg}`,
          };
          return;
        }
      } catch (e) {
        // Fallback to default error handling below
      }
    }

    // Handle non-streaming response
    if (body.stream === false) {
      if (response.status === 499) {
        return; // Aborted by user
      }
      const data = await response.json();
      yield data.choices[0].message;
      return;
    }

    // The proxy says which model its router actually used (Auto picks per
    // request). Pass it on as message metadata so the panel can show it.
    const servedModel = response.headers.get("x-vynorai-model");
    if (servedModel) {
      yield {
        role: "assistant",
        content: "",
        metadata: {
          vynorServed: {
            model: servedModel,
            tier: response.headers.get("x-vynorai-tier") ?? undefined,
          },
        },
      };
    }

    for await (const value of streamSse(response)) {
      const chunk = fromChatCompletionChunk(value);
      if (chunk) {
        yield chunk;
      }
    }
  }

  /**
   * Override _streamFim to route FIM completions to VynorAI proxy with resilient retry.
   */
  protected async *_streamFim(
    prefix: string,
    suffix: string,
    signal: AbortSignal,
    options: CompletionOptions,
  ): AsyncGenerator<string> {
    const endpoint = new URL("fim/completions", this.apiBase);
    const resp = await retryAsync(
      () =>
        this.fetch(endpoint, {
          method: "POST",
          body: JSON.stringify({
            model: options.model,
            prompt: prefix,
            prefix,
            suffix,
            max_tokens: options.maxTokens,
            temperature: options.temperature,
            top_p: options.topP,
            frequency_penalty: options.frequencyPenalty,
            presence_penalty: options.presencePenalty,
            stop: options.stop,
            stream: true,
            ...this.extraBodyProperties(),
          }),
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            "x-api-key": this.apiKey ?? "",
            Authorization: `Bearer ${this.apiKey}`,
          },
          signal,
        }),
      {
        maxAttempts: 3,
        baseDelay: 300,
        maxDelay: 2000,
        shouldRetry: (error: any) => {
          if (signal?.aborted) return false;
          const status =
            error?.status || error?.statusCode || error?.response?.status;
          if (status === 401 || status === 403 || status === 400) return false;
          if (status === 429 || (status >= 500 && status < 600)) return true;
          const code = error?.code || error?.errno;
          return (
            code === "ECONNRESET" ||
            code === "ECONNREFUSED" ||
            code === "ETIMEDOUT" ||
            code === "ENOTFOUND"
          );
        },
      },
    );

    for await (const chunk of streamSse(resp)) {
      if (chunk.choices?.[0]?.delta?.content) {
        yield chunk.choices[0].delta.content;
      } else if (chunk.choices?.[0]?.text) {
        yield chunk.choices[0].text;
      }
    }
  }
}

export default VynorAI;
