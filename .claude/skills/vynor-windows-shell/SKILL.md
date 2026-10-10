---
name: vynor-windows-shell
description: Avoid the recurring Windows/Git-Bash tool pitfalls in this repo (escape sequences in heredocs, paths with spaces, ELECTRON_RUN_AS_NODE, hung background runs). Use before writing a shell or Python snippet that edits files, and when a command mangles quotes or backslashes.
---

# Windows shell pitfalls

## Writing text that contains backslashes or `\n`

The Bash tool turns `\n` inside a quoted heredoc or a Python string into a real newline. A TypeScript string
such as `"a\nb"` then becomes two physical lines and fails with "Unterminated string literal".

- For source files, use the Write or Edit tool with the literal text. Do not generate code with
  `python - <<EOF` when the code contains `\n`, `\s`, `\d` or `\\`.
- If a Python patch is needed, keep the replacement free of backslashes, or read the replacement from a
  file written with the Write tool.
- After any scripted edit that touched strings, run `npx tsc --noEmit` in that package.

## Paths and quoting

- The repo path contains a space: always quote (`"/d/My Project/VynorAI"`). In PowerShell use `"D:\My Project\VynorAI"`.
- Bash `/tmp` and the Windows temp dir are different folders; share files through the scratchpad directory.
- Prefer PowerShell for installing into the E2E profile (`code.cmd`, `Get-Process`) and Bash for pipelines.

## Processes

- `ELECTRON_RUN_AS_NODE` must be unset before launching Code.exe, or it starts as plain Node and exits.
- Kill stale `Code.exe` and `chromedriver.exe` between E2E files; one test file per VS Code session.
- Anything that can run longer than a few minutes (build, full test suite, E2E) goes to the background with
  output redirected to a file; read the file when notified. Do not poll.

## Secrets

- Never write a key to a file or echo it. It reaches scripts only through an environment variable that the
  user sets (`setx NAME value`, then restart the editor). A key pasted into the chat is blocked by the
  permission classifier and must be rotated.
