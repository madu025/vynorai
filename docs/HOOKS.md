# Hooks

Hooks run your own shell commands at fixed points of an agent turn: before and after every tool call, when a prompt is submitted, when a conversation starts, before the conversation is compacted, when a subagent finishes, when the chat needs you, and when the agent finishes. Use them to block dangerous commands, run a linter after edits, or inject project context into every prompt.

The format and exit-code semantics match Claude Code hooks, so existing hook scripts work unchanged.

## Configuration files

| File                                        | Scope        | Notes                                                                                     |
| ------------------------------------------- | ------------ | ----------------------------------------------------------------------------------------- |
| `~/.vynorai/hooks.json`                     | All projects | Runs without prompting                                                                    |
| `.vynorai/hooks.json` in the workspace root | This project | Runs only in a trusted workspace, after you approve the file. Editing the file asks again |

Both files are read on every hook event, so changes apply immediately. User hooks run before project hooks.

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "run_terminal_command",
        "command": "node .vynorai/hooks/block-rm.js",
        "timeout": 10
      }
    ],
    "PostToolUse": [
      {
        "matcher": "multi_edit|single_find_and_replace|create_new_file",
        "command": "npx eslint --quiet ."
      }
    ],
    "UserPromptSubmit": [{ "command": "cat .vynorai/context.md" }],
    "Stop": [{ "command": "npm test --silent" }]
  }
}
```

The Claude Code nested form (`{ "matcher": "...", "hooks": [{ "type": "command", "command": "..." }] }`) is also accepted.

| Field     | Default   | Description                                                                                  |
| --------- | --------- | -------------------------------------------------------------------------------------------- |
| `command` | required  | Shell command, run from the workspace root                                                   |
| `matcher` | all tools | Regex over the tool name, anchored at both ends. Only used by `PreToolUse` and `PostToolUse` |
| `timeout` | `30`      | Seconds before the command and its child processes are killed. Maximum `120`                 |

## Events

| Event              | When                                                                                                            | Exit 2 effect                                                                  | Exit 0 stdout                            |
| ------------------ | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ---------------------------------------- |
| `UserPromptSubmit` | A prompt is sent, before the model sees it                                                                      | The turn is stopped and the reason is shown                                    | Attached to the prompt as context        |
| `PreToolUse`       | Before a tool runs (file edits, terminal, search, MCP)                                                          | The tool does not run; the reason is returned to the model as the tool's error | Ignored                                  |
| `PostToolUse`      | After a tool runs                                                                                               | The reason is returned to the model next to the tool output                    | Ignored                                  |
| `Stop`             | The agent finished the turn                                                                                     | The reason is shown to you; the turn does not resume                           | Ignored                                  |
| `SessionStart`     | The first prompt of a new conversation, before `UserPromptSubmit`                                               | Never blocks; reported as a warning                                            | Attached to that first prompt as context |
| `PreCompact`       | Right before the conversation is summarized (`/compact`, the Compact button, or auto-compaction at 70% context) | Never blocks; reported as a warning                                            | Ignored                                  |
| `SubagentStop`     | A `run_subagent` tool call finished (report or failure)                                                         | Never blocks; reported as a warning                                            | Ignored                                  |

| `Notification` | The chat needs you: a tool waits for your approval, or the agent paused (stalled, no change, same failure, action or credit limit) | Never blocks; reported as a warning | Ignored |

`SessionStart`, `PreCompact`, `SubagentStop` and `Notification` cannot block: the session starts, the compaction runs, the subagent result is used and the approval prompt is shown no matter what. Exit 2 from them is shown as a warning with the stderr text. `matcher` is ignored for these four events.

Any other non-zero exit, a timeout, or a command that fails to start is a warning shown as a notification. It never blocks.

## Hook input

Each command receives a JSON object on stdin. The environment also contains `VYNORAI_HOOK_EVENT` and `VYNORAI_PROJECT_DIR`.

```json
{
  "event": "PreToolUse",
  "sessionId": "8f1c…",
  "toolName": "run_terminal_command",
  "toolInput": { "command": "rm -rf build" }
}
```

`UserPromptSubmit` sends `prompt`. `PostToolUse` also sends `toolOutput` (truncated to 8,000 characters) and `toolError` when the tool failed.

`SessionStart` sends only `sessionId`. `PreCompact` sends `trigger` (`"manual"` or `"auto"`) and, for `/compact <focus>`, `instructions`. `SubagentStop` sends `subagentId` (the tool-call id), `subagentType` (`"explore"` or the custom agent name), `toolOutput` (the report, truncated) and `toolError` when the subagent failed. `Notification` sends `message` (the text) and `kind` (`"approval_required"` or `"agent_paused"`).

```json
{
  "hooks": {
    "SessionStart": [{ "command": "cat .vynorai/context.md" }],
    "PreCompact": [{ "command": "node .vynorai/hooks/save-notes.js" }],
    "SubagentStop": [{ "command": "node .vynorai/hooks/log-subagent.js" }],
    "Notification": [{ "command": "node .vynorai/hooks/notify.js" }]
  }
}
```

## Example: block recursive deletes

`.vynorai/hooks/block-rm.js`:

```js
let input = "";
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  const { toolInput } = JSON.parse(input);
  if (
    /\brm\s+-[a-z]*r[a-z]*f|\brm\s+-[a-z]*f[a-z]*r/i.test(
      toolInput.command ?? "",
    )
  ) {
    process.stderr.write(
      "Recursive force deletes are blocked by project policy. Delete specific files instead.",
    );
    process.exit(2);
  }
});
```

With this hook in place, an agent that tries `rm -rf build` gets the stderr message back as the tool error and chooses another approach.
