import {
  VYNORAI_XML_SYSTEM_PROMPT,
  VYNORAI_CHAT_SYSTEM_PROMPT,
  VYNORAI_PLAN_SYSTEM_PROMPT,
} from "./vynorai-system-prompt.js";

export const DEFAULT_SYSTEM_MESSAGES_URL =
  "https://vynorai.com/docs/agent";

export const CODEBLOCK_FORMATTING_INSTRUCTIONS = `\
  Always include the language and file name in the info string when you write code blocks.
  If you are editing "src/main.py" for example, your code block should start with '\`\`\`python src/main.py'
`;

export const EDIT_CODE_INSTRUCTIONS = `\
  When addressing code modification requests, present a concise code snippet that
  emphasizes only the necessary changes and uses abbreviated placeholders for
  unmodified sections. For example:

  \`\`\`language /path/to/file
  // ... existing code ...

  {{ modified code here }}

  // ... existing code ...

  {{ another modification }}

  // ... rest of code ...
  \`\`\`

  In existing files, you should always restate the function or class that the snippet belongs to:

  \`\`\`language /path/to/file
  // ... existing code ...

  function exampleFunction() {
    // ... existing code ...

    {{ modified code here }}

    // ... rest of function ...
  }

  // ... rest of code ...
  \`\`\`

  Since users have access to their complete file, they prefer reading only the
  relevant modifications. It's perfectly acceptable to omit unmodified portions
  at the beginning, middle, or end of files using these "lazy" comments. Only
  provide the complete file when explicitly requested. Include a concise explanation
  of changes unless the user specifically asks for code only.
`;

const BRIEF_LAZY_INSTRUCTIONS = `For larger codeblocks (>20 lines), use brief language-appropriate placeholders for unmodified sections, e.g. '// ... existing code ...'`;

// ─── VynorAI Agent Mode (FULL AUTONOMOUS) ────────────────────────────────────
export const DEFAULT_AGENT_SYSTEM_MESSAGE = `\
${VYNORAI_XML_SYSTEM_PROMPT}

<formatting>
${CODEBLOCK_FORMATTING_INSTRUCTIONS}
${BRIEF_LAZY_INSTRUCTIONS}
Only output codeblocks for suggestion and demonstration purposes.
For implementing changes, ALWAYS use the edit tools (edit_file, multi_edit, create_new_file).
</formatting>`;

// ─── VynorAI Chat Mode ────────────────────────────────────────────────────────
export const DEFAULT_CHAT_SYSTEM_MESSAGE = `\
${VYNORAI_CHAT_SYSTEM_PROMPT}

<formatting>
${CODEBLOCK_FORMATTING_INSTRUCTIONS}
${EDIT_CODE_INSTRUCTIONS}
</formatting>`;

// ─── VynorAI Plan Mode ────────────────────────────────────────────────────────
export const DEFAULT_PLAN_SYSTEM_MESSAGE = `\
${VYNORAI_PLAN_SYSTEM_PROMPT}

<formatting>
${CODEBLOCK_FORMATTING_INSTRUCTIONS}
${BRIEF_LAZY_INSTRUCTIONS}
When ready to implement changes, request to switch to Agent mode.
In plan mode, only write code when directly suggesting changes.
Prioritize understanding and developing a plan.
</formatting>`;
