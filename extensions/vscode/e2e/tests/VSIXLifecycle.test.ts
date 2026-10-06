import { expect } from "chai";
import { By, WebView, Workbench } from "vscode-extension-tester";
import { attachToPanel, openPanel, retry } from "../smart/gui";

async function assertVynorModel(view: WebView) {
  const modelText = await retry(async () => {
    const model = await view.findWebElement(
      By.css("[data-testid='model-select-button']"),
    );
    const text = (await model.getText()).trim();
    if (text !== "VynorAI Auto") {
      throw new Error(`model is still loading: ${text}`);
    }
    return text;
  }, 60_000);
  expect(modelText).to.equal("VynorAI Auto");
}

describe("VSIX lifecycle recovery", function () {
  this.timeout(180_000);

  let view: WebView | undefined;

  afterEach(async () => {
    await view?.switchBack().catch(() => undefined);
  });

  it("re-attaches after a VS Code window reload and extension-host restart", async () => {
    ({ view } = await openPanel());
    await assertVynorModel(view);

    await view.switchBack();
    await new Workbench().executeCommand("workbench.action.reloadWindow");
    ({ view } = await attachToPanel());
    await assertVynorModel(view);

    await view.switchBack();
    await new Workbench().executeCommand("Developer: Restart Extension Host");
    ({ view } = await attachToPanel());
    await assertVynorModel(view);
  });
});
