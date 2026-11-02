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

function recordingDocument() {
  const nodes: Array<{
    name: string;
    attrs: Record<string, string>;
    textContent: string;
  }> = [];
  const document = {
    createElementNS(_namespace: string, name: string) {
      const node = {
        name,
        attrs: {} as Record<string, string>,
        textContent: "",
        setAttribute(key: string, value: string) {
          this.attrs[key] = value;
        },
        appendChild() {},
      };
      nodes.push(node);
      return node;
    },
  } as unknown as Document;
  return { document, nodes };
}

test("a horizontal bar sketch labels each bar on its own row, not under an x axis", () => {
  // Live run 2026-11-02: four horizontal bars had North/South/East/West spread along the bottom.
  const { document, nodes } = recordingDocument();
  drawOutcomeChart(document, {
    type: "bar",
    categories: ["North", "South", "East", "West"],
    series: [{ name: "Sales", values: [34650, 35500, 18200, 16400] }],
  });
  const bars = nodes.filter((node) => node.name === "rect");
  const labels = nodes.filter((node) => node.name === "text");
  assert.equal(bars.length, 4);
  assert.deepEqual(
    labels.map((label) => label.textContent),
    ["North", "South", "East", "West"],
  );
  labels.forEach((label, at) => {
    const bar = bars[at];
    const barTop = Number(bar.attrs.y);
    const barBottom = barTop + Number(bar.attrs.height);
    const labelY = Number(label.attrs.y);
    assert.ok(
      labelY > barTop && labelY <= barBottom + 2,
      `label ${at} is not on its bar row`,
    );
    assert.ok(
      Number(label.attrs.x) <= Number(bar.attrs.x),
      `label ${at} overlaps its bar`,
    );
    assert.equal(label.attrs["text-anchor"], "end");
  });
});
