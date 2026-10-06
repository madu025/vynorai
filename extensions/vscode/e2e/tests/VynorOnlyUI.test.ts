import { expect } from "chai";
import { By, WebDriver, WebView, Workbench } from "vscode-extension-tester";
import { attachToPanel, openPanel, pageText, retry } from "../smart/gui";

describe("VynorAI-only packaged UI", function () {
  this.timeout(120_000);

  let view: WebView;
  let driver: WebDriver;

  afterEach(async () => {
    await view?.switchBack().catch(() => undefined);
  });

  it("does not expose BYOK onboarding or model-provider configuration", async () => {
    ({ view, driver } = await openPanel());

    const modelStatus = await retry(() =>
      view.findWebElement(By.css("[data-testid='model-select-button']")),
    );
    expect((await modelStatus.getText()).trim()).to.equal("VynorAI Auto");

    const chatText = await pageText(view);
    for (const removedText of [
      "Add Chat model",
      "Enter your OpenAI API key",
      "Enter your Anthropic API key",
    ]) {
      expect(chatText).not.to.include(removedText);
    }

    await view.switchBack();
    await new Workbench().executeCommand("Continue: Open Settings");
    ({ view, driver } = await attachToPanel("h2"));

    const settingsText = await driver.executeScript<string>(
      "return document.body.textContent || '';",
    );
    expect(settingsText).to.include("User Settings");
    expect(settingsText).not.to.match(/(^|\n)Models($|\n)/);
    expect(settingsText).not.to.include("Add Chat model");
    expect(settingsText).not.to.include("API Key");
  });
});
