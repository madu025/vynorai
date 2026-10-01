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

// Default to deployed cloud URL; fallback to local dev server
const VYNORAI_API_BASE =
  process.env.VYNORAI_API_BASE ||
  "https://vynor.lk/v1/";

class VynorAI extends OpenAI {
  static providerName = "vynorai";
  protected supportsReasoningField       = true;
  protected supportsReasoningDetailsField = true;

  static defaultOptions: Partial<LLMOptions> = {
    apiBase: VYNORAI_API_BASE,
    // Best default: DeepSeek V3 via OpenRouter — cheapest with great code quality
    model: "deepseek/deepseek-chat-v3-0324:free",
    useLegacyCompletionsEndpoint: false,
    promptTemplates: {
      edit: osModelsEditPrompt,
    },
  };

  constructor(options: LLMOptions) {

    super({
      ...options,
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
   * Override _streamChat to intercept VynorAI quota limits and show actionable upgrade messages.
   */
  protected async *_streamChat(
    messages: ChatMessage[],
    signal: AbortSignal,
    options: CompletionOptions,
  ): AsyncGenerator<ChatMessage> {
    const body = this._convertArgs(options, messages);

    const response = await this.fetch(this._getEndpoint("chat/completions"), {
      method: "POST",
      headers: this._getHeaders(),
      body: JSON.stringify({
        ...body,
        ...this.extraBodyProperties(),
      }),
      signal,
    });

    if (response.status === 403 || response.status === 429) {
      try {
        const errorJson = await response.json();
        const errObj = errorJson?.error;
        if (errObj?.code === "monthly_limit_reached" || errObj?.type === "quota_exceeded") {
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

        if (errObj?.code === "model_locked" || errObj?.type === "plan_restriction") {
          yield {
            role: "assistant",
            content: `🔒 **Model Locked (Upgrade Required)**\n\n${errObj.message || "This model requires an upgraded plan."}\n\n👉 [Click here to Upgrade Your Plan](${errObj.upgradeUrl || "https://vynor.lk/#pricing"}) to unlock this Thinking/Premium model.`,
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

    for await (const value of streamSse(response)) {
      const chunk = fromChatCompletionChunk(value);
      if (chunk) {
        yield chunk;
      }
    }
  }
}

export default VynorAI;
