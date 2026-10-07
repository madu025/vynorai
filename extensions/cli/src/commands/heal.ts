/**
 * VynorAI Terminal Self-Healing Command: `cn heal <command>` / `vynor heal <command>`
 * ──────────────────────────────────────────────────────────────────────────────────
 * Executes terminal shell commands, catches compiler/runtime/assertion failures,
 * extracts diagnostics, generates surgical fixes with pre-flight AST validation,
 * and loops until exit code 0 without opening VS Code.
 */

import chalk from "chalk";
import {
  runTerminalSelfHealing,
  HealingIteration,
  SelfHealingResult,
} from "../headless/terminalSelfHealer.js";
import { gracefulExit } from "../util/exit.js";

export interface HealCommandOptions {
  maxAttempts?: string | number;
  timeout?: string | number;
  virtual?: boolean;
  json?: boolean;
}

export async function healCommand(
  cmdArg: string,
  options: HealCommandOptions,
): Promise<void> {
  if (!cmdArg || !cmdArg.trim()) {
    console.error(
      chalk.red("Error: A command to execute and heal is required."),
    );
    console.error(chalk.yellow('\nUsage: cn heal "npm test" [options]'));
    console.error(
      chalk.gray(
        "  -a, --max-attempts <n>  Maximum self-healing attempts (default: 3)",
      ),
    );
    console.error(
      chalk.gray(
        "  --timeout <ms>          Execution timeout per run (default: 60000)",
      ),
    );
    console.error(
      chalk.gray(
        "  --virtual               Dry-run in virtual memory without modifying disk",
      ),
    );
    console.error(
      chalk.gray("  --json                  Output structured JSON"),
    );
    await gracefulExit(1);
    return;
  }

  const isJson = !!options.json;
  const maxAttempts =
    typeof options.maxAttempts === "string"
      ? parseInt(options.maxAttempts, 10)
      : options.maxAttempts || 3;

  const timeoutMs =
    typeof options.timeout === "string"
      ? parseInt(options.timeout, 10)
      : options.timeout || 60000;

  if (!isJson) {
    console.log(
      chalk.bold.cyan("\n🩹 VynorAI Autonomous Terminal Self-Healing Engine"),
    );
    console.log(chalk.gray(`Command: "${cmdArg}"`));
    console.log(
      chalk.gray(
        `Max Attempts: ${maxAttempts} | Timeout: ${timeoutMs}ms | Virtual: ${options.virtual ? "YES" : "NO"}`,
      ),
    );
    console.log(
      chalk.gray(
        "─────────────────────────────────────────────────────────────────",
      ),
    );
  }

  const result: SelfHealingResult = await runTerminalSelfHealing({
    command: cmdArg,
    maxAttempts,
    timeoutMs,
    virtual: options.virtual,
    onIteration: (iter: HealingIteration) => {
      if (!isJson) {
        if (iter.exitCode === 0) {
          console.log(
            chalk.green(
              `\n✔ [Attempt ${iter.attempt}] Exit Code 0 - Command Executed Successfully! (${iter.durationMs}ms)`,
            ),
          );
        } else {
          console.log(
            chalk.yellow(
              `\n⚠ [Attempt ${iter.attempt}] Exit Code ${iter.exitCode} (${iter.durationMs}ms)`,
            ),
          );
          if (iter.diagnostics.length > 0) {
            console.log(
              chalk.red(
                `   Captured ${iter.diagnostics.length} diagnostic error(s):`,
              ),
            );
            iter.diagnostics.slice(0, 3).forEach((d) => {
              const loc = d.filePath ? ` [${d.filePath}:${d.line || 1}]` : "";
              console.log(
                `    • ${chalk.bold.red(d.errorCode || d.category)}:${loc} ${d.errorMessage}`,
              );
            });
          }
          if (iter.patchApplied) {
            console.log(
              chalk.cyan(
                `   🩹 Surgical Fix: ${iter.patchApplied} in ${iter.targetFile}`,
              ),
            );
            console.log(
              chalk.green(`   ✔ Pre-flight AST Syntax Check: Passed`),
            );
          }
        }
      }
    },
  });

  if (isJson) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(
      chalk.gray(
        "─────────────────────────────────────────────────────────────────",
      ),
    );
    if (result.success) {
      console.log(
        chalk.bold.green(
          `\n🎉 Self-Healing Complete: Success in ${result.attempts} attempt(s) [${result.totalDurationMs}ms]!`,
        ),
      );
      if (result.modifiedFiles.length > 0) {
        console.log(chalk.magenta("Modified & Repaired Files:"));
        result.modifiedFiles.forEach((f) => console.log(` • ${f}`));
      }
    } else {
      console.log(
        chalk.bold.red(
          `\n✖ Self-Healing Loop Finished: Exit code ${result.finalExitCode} [${result.totalDurationMs}ms].`,
        ),
      );
      if (result.error) {
        console.log(chalk.red(`Error: ${result.error}`));
      }
    }
    console.log("");
  }

  await gracefulExit(result.success ? 0 : 1);
}
