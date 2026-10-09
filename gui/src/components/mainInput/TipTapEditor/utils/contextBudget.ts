import type { ContextItemWithId } from "core";
import { countTokens } from "../../../../util/tokenCount";

export const DEFAULT_CONTEXT_TOKEN_BUDGET = 18_000;
export const DEFAULT_ITEM_TOKEN_BUDGET = 8_000;

function truncateToTokens(
  content: string,
  model: string,
  limit: number,
): string {
  if (countTokens(content, model) <= limit) return content;
  const notice = "\n\n[Context truncated to the deterministic token budget.]";
  const contentLimit = Math.max(0, limit - countTokens(notice, model));
  let low = 0;
  let high = content.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (countTokens(content.slice(0, middle), model) <= contentLimit)
      low = middle;
    else high = middle - 1;
  }
  return `${content.slice(0, low)}${notice}`;
}

export function applyContextBudget(
  items: ContextItemWithId[],
  model: string,
  totalBudget = DEFAULT_CONTEXT_TOKEN_BUDGET,
  itemBudget = DEFAULT_ITEM_TOKEN_BUDGET,
): ContextItemWithId[] {
  const output: ContextItemWithId[] = [];
  let remaining = totalBudget;

  for (const item of items) {
    if (remaining <= 0) break;
    const content = truncateToTokens(
      item.content,
      model,
      Math.min(itemBudget, remaining),
    );
    const tokens = countTokens(content, model);
    if (tokens > remaining) continue;
    output.push({ ...item, content });
    remaining -= tokens;
  }
  return output;
}
