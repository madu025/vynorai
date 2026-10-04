import { ConfigYaml } from "@continuedev/config-yaml";

/**
 * VynorAI Default Configuration — Full Agentic Setup
 *
 * How this works:
 *  1. User installs VynorAI extension, enters their vynor_live_... key
 *  2. Extension gathers local code context (open files, grep results, repo map)
 *  3. VynorAI XML system prompt is injected automatically
 *  4. Request goes to VynorAI backend → OpenRouter → AI model
 *  5. AI responds in Search/Replace format
 *  6. Continue.dev auto-applies edits using built-in edit_file tool
 *
 * Slash commands available: /fix /explain /test /refactor /docs /review /security /optimize /scaffold
 */

const VYNORAI_API_BASE = process.env.VYNORAI_API_BASE || "https://vynor.lk/v1";
// Production: https://vynor.lk/v1 | Local dev: http://localhost:3333/v1

export const defaultConfig: ConfigYaml = {
  name: "VynorAI Coding Agent",
  version: "2.0.0",
  schema: "v1",

  models: [
    // ── ✨ Default: backend routes light / normal / heavy per request ─────
    {
      name: "VynorAI Auto",
      provider: "vynorai",
      model: "vynor-auto",
      apiBase: VYNORAI_API_BASE,
      roles: ["chat", "edit", "apply", "subagent"],
      // The backend tier policy caps output; leave room for heavy turns.
      defaultCompletionOptions: { contextLength: 64000, maxTokens: 16384 },
      capabilities: ["tool_use", "image_input"],
    },
    // ── Advanced: fixed models ───────────────────────────────────────────
    {
      name: "VynorAI ⚡ DeepSeek V4.1 Flash",
      provider: "vynorai",
      model: "deepseek/deepseek-flash",
      apiBase: VYNORAI_API_BASE,
      roles: ["chat", "edit", "apply", "subagent"],
      defaultCompletionOptions: { contextLength: 64000, maxTokens: 8192 },
      capabilities: ["tool_use", "image_input"],
    },
    // ── 🧠 Premium model (Pro & Ultra, 4x credits) ────────────────────────
    {
      name: "VynorAI 🧠 DeepSeek V4 Pro",
      provider: "vynorai",
      model: "deepseek/deepseek-v4-pro",
      apiBase: VYNORAI_API_BASE,
      roles: ["chat", "edit"],
      defaultCompletionOptions: { contextLength: 64000, maxTokens: 16384 },
      capabilities: ["tool_use"],
    },
    // ── 🎯 High Performance Open Coder (Starter, Pro, Ultra) ─────────────
    {
      name: "VynorAI 🎯 Qwen 2.5 Coder 32B",
      provider: "vynorai",
      model: "qwen/qwen-2.5-coder-32b-instruct",
      apiBase: VYNORAI_API_BASE,
      roles: ["chat", "edit"],
      defaultCompletionOptions: { contextLength: 32000, maxTokens: 8192 },
      capabilities: ["tool_use"],
    },
    // ── 🏆 Large Powerhouse Model (Ultra) ─────────────────────────────────
    {
      name: "VynorAI 🏆 Llama 3.3 70B Instruct",
      provider: "vynorai",
      model: "meta-llama/llama-3.3-70b-instruct",
      apiBase: VYNORAI_API_BASE,
      roles: ["chat", "edit"],
      defaultCompletionOptions: { contextLength: 128000, maxTokens: 8192 },
      capabilities: ["tool_use"],
    },
    // ── ⌨️  Code Autocomplete Engine (All Plans) ─────────────────────────
    {
      name: "VynorAI Autocomplete (FIM)",
      provider: "vynorai",
      model: "deepseek/deepseek-flash",
      apiBase: VYNORAI_API_BASE,
      roles: ["autocomplete"],
      defaultCompletionOptions: {
        contextLength: 16000,
        maxTokens: 256,
        temperature: 0,
      },
    },
  ],
};
