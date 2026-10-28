import assert from "node:assert/strict";
import { test } from "node:test";
import { drawOutcomeChart } from "./taskpanePreviewView.js";

test("preview chart renderer returns a bounded SVG without workbook side effects", () => {
  const nodes: unknown[] = [];
  const document = {
    createElementNS(_namespace: string, name: string) {
      const node = {
        name,
        children: [] as unknown[],
        setAttribute() {},
        appendChild(child: unknown) {
          this.children.push(child);
        },
        textContent: "",
      };
      nodes.push(node);
      return node;
    },
  } as unknown as Document;
  const svg = drawOutcomeChart(document, {
    type: "column",
    categories: ["North", "South"],
    series: [{ name: "Net Amount", values: [100, 200] }],
  });
  assert.ok(svg);
  assert.ok(nodes.length > 2);
});
