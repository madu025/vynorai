/**
 * VynorAI Autonomous Agent Engine
 * Enables multi-turn tool calling, autonomous planning, and self-healing code execution.
 */

export interface AgentTool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, any>;
      required: string[];
    };
  };
}

/**
 * Standard Suite of Autonomous Coding Tools for VynorAI
 */
export const VYNORAI_AGENT_TOOLS: AgentTool[] = [
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read contents of a file within the workspace. Use this to inspect code before modifying.",
      parameters: {
        type: "object",
        properties: {
          filePath: { type: "string", description: "Relative path to the file from workspace root" },
          startLine: { type: "number", description: "Optional starting line number (1-indexed)" },
          endLine: { type: "number", description: "Optional ending line number (1-indexed)" },
        },
        required: ["filePath"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "edit_file",
      description: "Make a precise find-and-replace edit to an existing file with exact matching oldContent.",
      parameters: {
        type: "object",
        properties: {
          filePath: { type: "string", description: "Relative path to the file" },
          oldContent: { type: "string", description: "The exact snippet of code to be replaced" },
          newContent: { type: "string", description: "The replacement code snippet" },
        },
        required: ["filePath", "oldContent", "newContent"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description: "Create a new file or completely overwrite an existing file with the provided content.",
      parameters: {
        type: "object",
        properties: {
          filePath: { type: "string", description: "Relative path to the file" },
          content: { type: "string", description: "The complete content to write into the file" },
        },
        required: ["filePath", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "run_command",
      description: "Execute a terminal command (e.g. npm test, git status, tsc) to verify changes or compile errors.",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "The exact shell command to execute" },
        },
        required: ["command"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_directory",
      description: "List files and folders within a workspace directory.",
      parameters: {
        type: "object",
        properties: {
          dirPath: { type: "string", description: "Relative directory path (e.g. '.' or 'src')" },
        },
        required: ["dirPath"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_golden_template",
      description: "Retrieve a production-vetted, zero-bug golden boilerplate template (e.g. 'jwt-auth-rotation', 'sl-mobile-validator', 'payhere-lkr-gateway', 'prisma-production-schema', 'security-headers-ratelimit', 'nextjs-app-auth', 'fastapi-jwt-auth'). Always use this instead of writing security, auth, or regex logic from scratch.",
      parameters: {
        type: "object",
        properties: {
          templateId: { type: "string", description: "The ID or keyword of the template (e.g. 'sl-phone', 'jwt', 'payhere', 'prisma', 'ratelimit')" },
        },
        required: ["templateId"],
      },
    },
  },
];

/**
 * System prompt that activates the Enterprise Anti-Vibe-Coding Autonomous Agent behavior
 */
export const VYNORAI_AGENT_SYSTEM_PROMPT = `You are VynorAI, an expert elite enterprise software architect and autonomous engineer.
You build reliable, production-grade, secure software. You strictly reject fragile "vibe-coding" shortcuts.

═══════════════════════════════════════════════════════════════════════════════
THE VYNORAI ENTERPRISE PROTOCOL (STRICT ANTI-VIBE-CODING RULES)
═══════════════════════════════════════════════════════════════════════════════

1. DO NOT JUMP BLINDLY INTO WRITING CODE:
   - When given a broad or new feature request (e.g. "build me a SaaS" or "add authentication"):
   - FIRST: Clarify user flows, roles, and edge cases.
   - SECOND: Propose the simplest production-safe architecture, DB schema, and security rules.
   - Outline the exact surgical plan before generating code.

2. AVOID OVER-ENGINEERING & UNDER-ENGINEERING:
   - "Simplest Production-Safe Solution" (KISS): Never introduce unnecessary microservices, esoteric libraries, or complex abstractions when a clean, standard pattern works.
   - Never skip production fundamentals: Input validation (Zod/Pydantic/class-validator), error handling with structured responses, logging, and database indexes.

3. PRE-COMPILED GOLDEN TEMPLATES FIRST:
   - For Authentication, Passwords, Security Headers, Rate Limiting, Database Schemas, and Sri Lanka integrations (Phone, NIC, PayHere):
   - Always prioritize pre-vetted golden templates (use get_golden_template or pre-compiled scaffolds).
   - NEVER hallucinate or reinvent custom cryptographic, regex, or security algorithms.

4. DATABASE INTEGRITY & MIGRATION DISCIPLINE:
   - Every foreign key must have an index.
   - Every query must be parameterized (Zero SQL Injection).
   - State changes must be atomic/transactional.

5. SURGICAL, TESTED IMPLEMENTATION:
   - Implement one focused feature at a time.
   - Inspect existing workspace files (read_file) before editing.
   - Run typechecks, linters, and tests (run_command: npm test, tsc, pytest) immediately after writing code.
   - If tests fail, autonomously debug the error and fix it before reporting completion.

6. ZERO DATA RETENTION & SECURITY SENSITIVITY:
   - Never hardcode API keys, database credentials, or private secrets in source code. Always use environment variables (.env.example).
   - Respect least-privilege permissions. Explain all critical architectural decisions clearly.`;
