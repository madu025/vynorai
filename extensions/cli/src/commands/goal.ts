/**
 * VynorAI Goal Command: `cn goal <prompt>` / `vynor goal <prompt>`
 * ───────────────────────────────────────────────────────────────
 * Executes autonomous agent goals directly from the terminal shell without VS Code:
 *  - Decomposes goals into AST symbols and action tasks
 *  - Spawns isolated Git worktree sandbox (optional --worktree)
 *  - Executes surgical modifications with pre-flight AST syntax verification
 *  - Evaluates test gates (--test-cmd) with automatic terminal self-healing (--heal)
 *  - Outputs rich formatted briefing report or structured JSON
 */

import chalk from "chalk";
import {
  HeadlessGoalRunner,
  GoalStep,
  GoalReport,
} from "../headless/goalRunner.js";
import { logger } from "../util/logger.js";
import { gracefulExit } from "../util/exit.js";

export interface GoalCommandOptions {
  prompt?: string;
  worktree?: boolean;
  testCmd?: string;
  heal?: boolean;
  maxSteps?: string | number;
  dryRun?: boolean;
  format?: "pretty" | "json";
  verbose?: boolean;
}

export async function goalCommand(
  promptArg: string | undefined,
  options: GoalCommandOptions,
): Promise<void> {
  const prompt = promptArg || options.prompt;

  if (!prompt || !prompt.trim()) {
    console.error(chalk.red("Error: A goal prompt is required."));
    console.error(
      chalk.yellow(
        '\nUsage: cn goal "Refactor auth middleware and ensure tests pass" [options]',
      ),
    );
    console.error(
      chalk.gray("  -w, --worktree    Run in an isolated Git worktree sandbox"),
    );
    console.error(
      chalk.gray(
        '  -t, --test-cmd    Verification test gate command (e.g. "npm test")',
      ),
    );
    console.error(
      chalk.gray(
        "  --heal            Enable autonomous terminal self-healing on failure (default: true)",
      ),
    );
    console.error(chalk.gray("  --format json     Output as JSON"));
    await gracefulExit(1);
    return;
  }

  const isJson = options.format === "json";

  if (!isJson) {
    console.log(
      chalk.bold.cyan("\n🚀 VynorAI Autonomous Headless Goal Runner"),
    );
    console.log(chalk.gray(`Goal: "${prompt}"`));
    if (options.worktree) {
      console.log(
        chalk.magenta(
          "🛡️  Sandbox: Isolated Git Worktree enabled (zero dirty branch disruption)",
        ),
      );
    }
    if (options.testCmd) {
      console.log(
        chalk.blue(
          `🧪 Test Gate: "${options.testCmd}" (Auto-heal: ${options.heal !== false ? "ON" : "OFF"})`,
        ),
      );
    }
    console.log(
      chalk.gray(
        "─────────────────────────────────────────────────────────────────",
      ),
    );
  }

  const maxSteps =
    typeof options.maxSteps === "string"
      ? parseInt(options.maxSteps, 10)
      : options.maxSteps || 15;

  const runner = new HeadlessGoalRunner({
    prompt,
    worktree: options.worktree,
    testCmd: options.testCmd,
    heal: options.heal !== false,
    maxSteps,
    dryRun: options.dryRun,
    format: options.format,
    verbose: options.verbose,
    onStep: (step: GoalStep) => {
      if (!isJson) {
        const icon =
          step.status === "passed"
            ? chalk.green("✔")
            : step.status === "failed"
              ? chalk.red("✖")
              : chalk.yellow("⏳");

        const duration = step.durationMs
          ? chalk.gray(`(${step.durationMs}ms)`)
          : "";
        console.log(
          ` ${icon} [Phase ${step.stepIndex}: ${step.phase.toUpperCase()}] ${step.title} ${duration}`,
        );
        if (step.details) {
          console.log(`    ${chalk.dim(step.details)}`);
        }
      }
    },
  });

  try {
    const report: GoalReport = await runner.run();

    if (isJson) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(
        chalk.gray(
          "─────────────────────────────────────────────────────────────────",
        ),
      );
      if (report.success) {
        console.log(
          chalk.bold.green(
            `\n🎉 Goal Achieved Successfully! [${report.totalDurationMs}ms]`,
          ),
        );
      } else {
        console.log(
          chalk.bold.red(
            `\n⚠️  Goal Completed with Diagnostics. [${report.totalDurationMs}ms]`,
          ),
        );
      }

      console.log(chalk.white(`Summary: ${report.summary}`));

      if (report.relevantSymbols.length > 0) {
        console.log(chalk.cyan("\nIdentified Architectural Hubs:"));
        for (const s of report.relevantSymbols) {
          console.log(` • ${s}`);
        }
      }

      if (report.filesModified.length > 0) {
        console.log(chalk.magenta("\nFiles Modified:"));
        for (const f of report.filesModified) {
          console.log(` • ${f}`);
        }
      }

      if (report.selfHealingTriggered && report.healingResult) {
        console.log(
          chalk.yellow(
            `\nSelf-Healing Engine: ${report.healingResult.attempts} iterations executed.`,
          ),
        );
      }
      console.log("");
    }

    await gracefulExit(report.success ? 0 : 1);
  } catch (err: any) {
    if (isJson) {
      console.log(JSON.stringify({ success: false, error: err.message }));
    } else {
      console.error(chalk.red(`\nFatal Goal Execution Error: ${err.message}`));
    }
    await gracefulExit(1);
  }
}
