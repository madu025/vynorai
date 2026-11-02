import assert from "node:assert/strict";
import { test } from "node:test";
import { appendEmphasized } from "./taskpaneChatView.js";

/** A tiny stand-in DOM: text nodes are strings, bold nodes are "**text**". */
function fakeDocument() {
  const node = () => {
    const parts: string[] = [];
    return {
      parts,
      textContent: "",
      append(child: any) {
        parts.push(typeof child === "string" ? child : child.render());
      },
    };
  };
  return {
    createTextNode: (text: string) => text,
    createElement: () => {
      const b: any = node();
      b.render = () => `**${b.textContent}**`;
      return b;
    },
    root: node,
  };
}

test("numbers and a leading label are bold in an answer point", () => {
  const doc: any = fakeDocument();
  const line = doc.root();
  appendEmphasized(
    doc,
    line,
    "Most profitable product: Laptop (1,390 total), margin 14.3%",
  );
  assert.equal(
    line.parts.join(""),
    "**Most profitable product:** Laptop (**1,390** total), margin **14.3%**",
  );
});

test("text without numbers stays plain", () => {
  const doc: any = fakeDocument();
  const line = doc.root();
  appendEmphasized(doc, line, "Keys match on both sheets");
  assert.equal(line.parts.join(""), "Keys match on both sheets");
});
