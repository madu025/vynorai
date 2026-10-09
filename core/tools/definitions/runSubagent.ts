import { GetTool } from "../..";
import {
  describeAgentForTool,
  loadUserSubagents,
} from "../../agent/userSubagents";

import { BUILT_IN_GROUP_NAME, BuiltInToolNames } from "../builtIn";

export const runSubagentTool: GetTool = async ({ ide }) => {
  const { agents } = await loadUserSubagents(ide).catch(() => ({
    agents: [],
  }));
  const agentList = agents.length
    ? `\n\nCustom agents you can pick with the agent argument (omit it for the general explore subagent):\n${agents
        .map((agent) => describeAgentForTool(agent))
        .join("\n")}`
    : "";
  return {
    type: "function",
    displayTitle: "Subagent",
    wouldLikeTo: "run a subagent: {{{ description }}}",
    isCurrently: "running a subagent: {{{ description }}}",
    hasAlready: "ran a subagent: {{{ description }}}",
    readonly: true,
    isInstant: false,
    group: BUILT_IN_GROUP_NAME,
    function: {
      name: BuiltInToolNames.RunSubagent,
      description: `Launch a read-only explore subagent that researches the codebase in its own context and returns a single report. Its file reads and searches do not enter your context, so this keeps long tasks fast and cheap.
Use it for:
- Open-ended questions that need several searches or files ("how does billing settle credits?", "where is auth enforced?").
- Mapping every place that must change before a multi-file edit.
- Independent questions at once: call it several times in one message and they run in parallel.
Do not use it to read one known file or to search for one exact symbol; use read_file or grep_search directly.
The subagent cannot see this conversation, edit files or run commands. Write a self-contained prompt: the goal, what you already know, where to look, and exactly what the report must contain. Verify anything critical in its report before editing.${agentList}`,
      parameters: {
        type: "object",
        required: ["description", "prompt"],
        properties: {
          description: {
            type: "string",
            description: "3-6 word label shown to the user",
          },
          prompt: {
            type: "string",
            description: "Self-contained research task and the report you need",
          },
          ...(agents.length
            ? {
                agent: {
                  type: "string",
                  description: `Name of a custom agent: ${agents.map((agent) => agent.name).join(", ")}`,
                },
              }
            : {}),
        },
      },
    },
    systemMessageDescription: {
      prefix: `To research the codebase without filling your context, use the ${BuiltInToolNames.RunSubagent} tool. It runs a read-only subagent and returns one report. Call it several times at once for independent questions.`,
      exampleArgs: [
        ["description", "Map payment flow"],
        [
          "prompt",
          "Find how a PayHere IPN activates a subscription: entry route, validation, DB writes. Report each step with path:line.",
        ],
      ],
    },
    defaultToolPolicy: "allowedWithoutPermission",
    toolCallIcon: "UserGroupIcon",
  };
};
