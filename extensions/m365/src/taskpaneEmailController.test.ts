import assert from "node:assert/strict";
import {
  createEmailController,
  type EmailControllerElements,
} from "./taskpaneEmailController.js";

class FakeInput {
  value = "";
  disabled = false;
  listeners = new Map<string, () => void>();
  addEventListener(name: string, listener: () => void) {
    this.listeners.set(name, listener);
  }
  focus() {}
}

class FakeElement {
  hidden = true;
  textContent = "";
  className = "";
  scrollIntoView() {}
}

const to = new FakeInput();
const subject = new FakeInput();
const body = new FakeInput();
const send = new FakeInput();
const elements = {
  card: new FakeElement(),
  note: new FakeElement(),
  to,
  subject,
  body,
  send,
  cc: new FakeInput(),
  bcc: new FakeInput(),
  format: new FakeInput(),
  bodyType: new FakeInput(),
  deliveryMode: new FakeInput(),
  includeChart: { checked: false },
  aiWrite: new FakeInput(),
  deliveryStatus: new FakeElement(),
  reportName: new FakeElement(),
  attachmentSize: new FakeElement(),
  draftFallback: new FakeElement(),
  draftLink: { href: "" },
  draftNote: new FakeElement(),
} as unknown as EmailControllerElements;

const log = {
  record() {},
  async step<T>(_name: string, operation: () => Promise<T>): Promise<T> {
    return operation();
  },
} as any;
let report = true;
let refreshes = 0;
let activations = 0;
const controller = createEmailController({
  elements,
  config: {
    tenantId: "tenant",
    clientId: "client",
    redirectUri: "https://example.test/callback",
    scopes: ["openid"],
    graphScopes: ["Mail.Send"],
  },
  getAccessToken: () => "token",
  getLanguage: () => "en",
  getTextLanguage: () => "en",
  getReportSheet: () => "Results",
  getGalleryResults: () => [],
  hasReport: () => report,
  apiClient: () => ({}) as any,
  signInWithOfficeDialog: async () => "",
  setStatus() {},
  refreshNavigation: () => {
    refreshes += 1;
  },
  activateShare: () => {
    activations += 1;
  },
  log,
});

controller.updateUi();
assert.equal(send.disabled, true);
to.value = "person@example.test";
subject.value = "Report";
controller.updateUi();
assert.equal(send.disabled, false);
controller.prepare("owner@example.test");
assert.equal(to.value, "person@example.test");
assert.equal(subject.value, "Report");
assert.equal(refreshes, 1);
assert.equal(activations, 1);
report = false;
controller.updateUi();
assert.equal(send.disabled, true);
console.log("taskpaneEmailController tests passed");
