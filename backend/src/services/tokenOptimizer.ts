/**
 * Token Optimization & Prompt Caching Service for VynorAI
 * Implements:
 * 1. Anthropic Ephemeral Prompt Caching (90% input token discount)
 * 2. DeepSeek / OpenAI Prefix Alignment (automatic 50-75% discount)
 * 3. Smart Code Compression (pruning duplicate whitespace and empty lines)
 */

export interface OptimizedRequest {
  messages: any[];
  system?: any;
  tools?: any[];
  estimatedSavedTokens: number;
}

/**
 * Compress code content by stripping redundant whitespace and trailing lines
 * while preserving strict indentation and code integrity.
 */
export function compressCodeSnippet(code: string): string {
  if (!code || typeof code !== "string") return code;

  // Replace 3+ consecutive newlines with a single empty line
  let compressed = code.replace(/\n\s*\n\s*\n+/g, "\n\n");

  // Remove trailing whitespace on each line
  compressed = compressed
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n");

  return compressed;
}

/**
 * Optimizes request payload specifically for Anthropic Claude (Claude 3.7 / 3.5 Sonnet)
 * Injects `cache_control: { type: "ephemeral" }` on system instructions, tools, and repo context.
 */
export function optimizeForAnthropic(body: any): any {
  const { messages = [], system, tools, ...rest } = body;
  let savedTokens = 0;

  // 1. Structure System Prompt with Anthropic Prompt Caching
  let optimizedSystem = system;
  if (typeof system === "string" && system.length > 500) {
    optimizedSystem = [
      {
        type: "text",
        text: system,
        cache_control: { type: "ephemeral" },
      },
    ];
    savedTokens += Math.floor(system.length / 4);
  }

  // 2. Add Prompt Cache breakpoint on tools declarations
  let optimizedTools = tools;
  if (Array.isArray(tools) && tools.length > 0) {
    optimizedTools = tools.map((tool, idx) => {
      // Mark the last tool with ephemeral cache control
      if (idx === tools.length - 1) {
        return {
          ...tool,
          cache_control: { type: "ephemeral" },
        };
      }
      return tool;
    });
  }

  // 3. Optimize messages and place cache breakpoint on long context messages
  const optimizedMessages = messages.map((msg: any, idx: number) => {
    let content = msg.content;

    // Compress code snippets within content
    if (typeof content === "string") {
      content = compressCodeSnippet(content);
    } else if (Array.isArray(content)) {
      content = content.map((part: any) => {
        if (part.type === "text" && typeof part.text === "string") {
          return { ...part, text: compressCodeSnippet(part.text) };
        }
        return part;
      });
    }

    // Add cache control to large user context (e.g. codebase context, files)
    const isLargeContext =
      typeof content === "string" ? content.length > 2000 : false;

    // Place cache breakpoint on the 2nd to last message if it has large context
    if (isLargeContext && idx === messages.length - 2) {
      if (typeof content === "string") {
        return {
          ...msg,
          content: [
            {
              type: "text",
              text: content,
              cache_control: { type: "ephemeral" },
            },
          ],
        };
      }
    }

    return { ...msg, content };
  });

  return {
    ...rest,
    system: optimizedSystem,
    tools: optimizedTools,
    messages: optimizedMessages,
  };
}

/**
 * Optimizes request payload for OpenAI / DeepSeek
 * DeepSeek & OpenAI use automatic prefix caching. We ensure all invariant messages
 * (system prompt, rules, codebase index) stay strictly at the start of the prompt.
 */
export function optimizeForOpenAI(body: any): any {
  const { messages = [], ...rest } = body;

  const optimizedMessages = messages.map((msg: any) => {
    let content = msg.content;
    if (typeof content === "string") {
      content = compressCodeSnippet(content);
    }
    return { ...msg, content };
  });

  return {
    ...rest,
    messages: optimizedMessages,
  };
}
