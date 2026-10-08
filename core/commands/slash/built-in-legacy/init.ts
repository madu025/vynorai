import { FileType, SlashCommand } from "../../../index.js";
import { renderChatMessage } from "../../../util/messageContent.js";
import { getUriPathBasename, joinPathsToUri } from "../../../util/uri.js";
import { resolveActiveWorkspaceDir } from "../../../workspace/activeRoot.js";

const MANIFEST_CANDIDATES = [
  "package.json",
  "Cargo.toml",
  "go.mod",
  "pyproject.toml",
  "requirements.txt",
  "pom.xml",
  "build.gradle",
  "composer.json",
  "Makefile",
  "tsconfig.json",
  "docker-compose.yml",
  "docker-compose.vps.yml",
  ".env.example",
];

const IGNORED_DIRS = new Set([
  ".git",
  "node_modules",
  ".next",
  "dist",
  "build",
  "out",
  ".continue",
  ".vscode",
  ".idea",
  "vendor",
  "target",
  ".turbo",
  ".cache",
]);

export const InitCommand: SlashCommand = {
  name: "init",
  description:
    "Initialize AGENTS.md project memory and architecture guidelines",
  run: async function* ({ ide, llm, abortController, activeWorkspaceDir }) {
    // Act on the root the user is working in (pinned root, then the root of the
    // open file, then the only root), not blindly on the first folder.
    const workspaceDir = await resolveActiveWorkspaceDir(
      ide,
      activeWorkspaceDir,
    );
    if (!workspaceDir) {
      yield "⚠️ No active workspace directory found. Open a workspace folder first.";
      return;
    }

    const rootName = getUriPathBasename(workspaceDir) || "workspace";
    yield `📁 Project root: **${rootName}**\n`;
    yield "🔍 Analyzing workspace architecture, manifests, and build commands...\n\n";

    // 1. Gather top-level structure
    let dirEntries: [string, FileType][] = [];
    try {
      dirEntries = await ide.listDir(workspaceDir);
    } catch {
      // Fallback if listDir fails or is unsupported
    }

    const folders: string[] = [];
    const files: string[] = [];
    for (const [uri, type] of dirEntries) {
      const parts = uri.replace(/\\/g, "/").split("/");
      const name = parts[parts.length - 1] || parts[parts.length - 2];
      if (!name || IGNORED_DIRS.has(name) || name.startsWith(".")) continue;
      if (type === (2 as FileType.Directory)) {
        folders.push(name);
      } else {
        files.push(name);
      }
    }

    // 2. Read manifests
    const manifestSnippets: string[] = [];
    for (const filename of MANIFEST_CANDIDATES) {
      const fileUri = joinPathsToUri(workspaceDir, filename);
      try {
        if (await ide.fileExists(fileUri)) {
          const raw = await ide.readFile(fileUri);
          const snippet =
            raw.length > 2500 ? raw.slice(0, 2500) + "\n...[truncated]" : raw;
          manifestSnippets.push(`### ${filename}\n\`\`\`\n${snippet}\n\`\`\``);
        }
      } catch {
        // Ignore read errors on individual files
      }
    }

    // 3. Check for existing AGENTS.md or CLAUDE.md. An existing file is
    // updated in place under its own name; a new one is written as AGENTS.md.
    const agentsUri = joinPathsToUri(workspaceDir, "AGENTS.md");
    const claudeUri = joinPathsToUri(workspaceDir, "CLAUDE.md");
    let existingMemory = "";
    let targetUri = agentsUri;
    let targetName = "AGENTS.md";
    try {
      if (await ide.fileExists(agentsUri)) {
        existingMemory = await ide.readFile(agentsUri);
      } else if (await ide.fileExists(claudeUri)) {
        existingMemory = await ide.readFile(claudeUri);
        targetUri = claudeUri;
        targetName = "CLAUDE.md";
      }
    } catch {
      // Ignore read errors
    }

    // 4. Construct prompt
    const prompt = `<vynorai_task type="init_project_memory">
<instruction>
You are an expert Principal Systems Architect. Your job is to create a comprehensive, highly dense, strictly formatted ${targetName} project memory guide for this codebase.
This file will be read by VynorAI, Claude Code, OpenAI Codex, and Cursor as the single source of truth for repository conventions, architecture, build commands, and rules.

STRICT CONSTRAINTS:
1. The output MUST be strictly under 150 lines.
2. Must name real commands extracted from manifests (e.g. npm scripts, cargo, pytest, make).
3. Do not include fluffy introductions or marketing copy.
4. Format in clean, readable Markdown.
</instruction>

<workspace_context>
Top-Level Directories:
${folders.length > 0 ? folders.map((f) => `- ${f}/`).join("\n") : "Standard structure"}

Top-Level Key Files:
${files.length > 0 ? files.map((f) => `- ${f}`).join("\n") : "Standard files"}

Manifests & Config Details:
${manifestSnippets.length > 0 ? manifestSnippets.join("\n\n") : "No standard manifests detected."}

${
  existingMemory
    ? `<existing_memory_file>\n${existingMemory.slice(0, 2000)}\n</existing_memory_file>\n(Preserve and refine any valuable custom conventions already present)`
    : ""
}
</workspace_context>

<required_structure>
# Project Memory & Agent Guidelines

## 1. Overview & Architecture
- Brief 2-3 sentence overview of project purpose, core stack, and architectural pattern.
- Key Directories: Map the principal directories to their specific responsibility.

## 2. Essential Commands
- **Dev / Start**: Exact command to run locally
- **Build / Bundle**: Exact command to build production or extension bundle
- **Test**: Exact command to run tests (unit, e2e, integration)
- **Lint / Typecheck**: Exact command to check types or lint

## 3. Code Style & Conventions
- Naming conventions, component/function patterns, import ordering.
- TypeScript / language idiomatic standards, error handling patterns.

## 4. Verification & Testing Rules
- MANDATORY: Edits must be verified with tests, typecheck, or build before concluding any task.
- Never ignore linter/compiler errors.

## 5. Critical Constraints & Gotchas
- Sensitive files, environment variables, or platform-specific rules (Windows/Linux/Docker).
</required_structure>

Output ONLY the complete Markdown content for ${targetName}.
</vynorai_task>`;

    let fullGeneratedText = "";
    for await (const chunk of llm.streamChat(
      [{ role: "user", content: prompt }],
      abortController.signal,
    )) {
      const rendered = renderChatMessage(chunk);
      fullGeneratedText += rendered;
      yield rendered;
    }

    // Clean generated text (strip markdown code fence if wrapped in ```markdown ... ```)
    let cleaned = fullGeneratedText.trim();
    if (cleaned.startsWith("```markdown")) {
      cleaned = cleaned
        .replace(/^```markdown\s*/i, "")
        .replace(/\s*```$/i, "")
        .trim();
    } else if (cleaned.startsWith("```")) {
      cleaned = cleaned
        .replace(/^```\s*/, "")
        .replace(/\s*```$/, "")
        .trim();
    }

    // Save at the root of the active project
    try {
      await ide.writeFile(targetUri, cleaned + "\n");
      yield `\n\n---\n✅ **${targetName}** successfully created and saved to the root of **${rootName}**!\nAll VynorAI, Claude Code, and Codex sessions will now automatically load and follow these project guidelines.`;
    } catch (err: any) {
      yield `\n\n---\n⚠️ Could not automatically write to ${targetName}: ${err?.message || err}. You can copy the content above into ${targetName} manually.`;
    }
  },
};

export default InitCommand;
