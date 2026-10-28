import assert from "node:assert/strict";
import { createResultGalleryController } from "./taskpaneResultGalleryController.js";

class FakeElement {
  hidden = false;
  value = "make a chart";
  textContent = "";
  className = "";
  type = "";
  disabled = false;
  title = "";
  children: FakeElement[] = [];
  listeners = new Map<string, () => void>();
  append(...children: FakeElement[]) {
    this.children.push(...children);
  }
  appendChild(child: FakeElement) {
    this.children.push(child);
  }
  replaceChildren(...children: FakeElement[]) {
    this.children = children;
  }
  addEventListener(name: string, listener: () => void) {
    this.listeners.set(name, listener);
  }
  focus() {}
}

const nodes = new Map<string, FakeElement>([
  ["#result-gallery", new FakeElement()],
  ["#result-gallery-list", new FakeElement()],
  ["#operation-history", new FakeElement()],
  ["#verified-result-banner", new FakeElement()],
  [".safety-summary", new FakeElement()],
]);
const document = {
  querySelector<T>(selector: string) {
    return nodes.get(selector) as T | undefined;
  },
  createElement() {
    return new FakeElement();
  },
} as unknown as Document;

const results = [
  {
    kind: "chart",
    name: "Sales chart",
    targetSheet: "VynorAI_Chart",
    status: "created" as const,
    request: "Create a chart by region",
    sourceRange: "VynorAI_QA!A1:B5",
  },
];
const controller = createResultGalleryController({
  document,
  rollbackButton: null,
  instruction: new FakeElement() as unknown as HTMLInputElement,
  getLanguage: () => "en",
  getTextLanguage: () => "en",
  getPlanId: () => "plan-1",
  getResults: () => results,
  setResults: () => {},
  getLastCreated: () => undefined,
  setLastCreated: () => {},
  getLastRevealSheet: () => "",
  setLastRevealSheet: () => {},
  getCurrentRequest: () => "",
  getCurrentRange: () => "",
  resetPreview: () => {},
  inspect: () => {},
  prepareEmail: () => {},
  persist: () => {},
  updateEmailUi: () => {},
  renderChanged: () => {},
  markChangeNote: () => {},
  setStatus: () => {},
  handleApiError: () => {},
  officeRuntime: () => ({}),
  apiClient: () => ({}) as any,
  listVynorSheets: async () => [],
  askInPane: async () => false,
  log: {
    record() {},
    async step<T>(_name: string, operation: () => Promise<T>) {
      return operation();
    },
  } as any,
});

controller.render();
assert.equal(nodes.get("#result-gallery")!.hidden, false);
const list = nodes.get("#result-gallery-list")!;
assert.equal(list.children.length, 1);
assert.equal(list.children[0].children.length, 4);
assert.equal(
  list.children[0].children[0].children[1].textContent,
  "Verified · VynorAI_Chart",
);
assert.equal(list.children[0].children[2].children.length, 2);
console.log("taskpaneResultGalleryController tests passed");
