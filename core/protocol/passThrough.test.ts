import {
  CORE_TO_WEBVIEW_PASS_THROUGH,
  WEBVIEW_TO_CORE_PASS_THROUGH,
} from "./passThrough.js";

describe("workspace and agent protocol pass-through", () => {
  it("routes workspace and agent requests from the webview to Core", () => {
    expect(WEBVIEW_TO_CORE_PASS_THROUGH).toEqual(
      expect.arrayContaining([
        "workspace/getSnapshot",
        "workspace/refreshSnapshot",
        "workspace/invalidate",
        "workspace/setActiveRoot",
        "workspace/getVerificationPlan",
        "agent/task/start",
        "agent/task/transition",
        "agent/task/authorizeAction",
        "agent/task/listResumable",
        "agent/plan/create",
        "agent/plan/next",
        "agent/plan/startStep",
        "agent/plan/completeStep",
        "agent/plan/failStep",
      ]),
    );
  });

  it("routes workspace status changes from Core to the webview", () => {
    expect(CORE_TO_WEBVIEW_PASS_THROUGH).toContain("workspace/statusUpdate");
  });
});
