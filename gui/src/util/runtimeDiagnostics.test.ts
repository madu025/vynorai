import {
  createRuntimeDiagnostic,
  saveRuntimeDiagnostic,
} from "./runtimeDiagnostics";

test("redacts credentials and local paths from a runtime diagnostic", () => {
  const diagnostic = createRuntimeDiagnostic({
    error: new Error(
      "apiKey=sk-secret C:\\Users\\person\\project\\file.ts failed",
    ),
    historyLength: 3,
    toolStatusCounts: { done: 1 },
  });

  expect(diagnostic.error.message).toContain("[REDACTED]");
  expect(diagnostic.error.message).toContain("[LOCAL_PATH]");
  expect(diagnostic.error.message).not.toContain("sk-secret");
  expect(diagnostic.privacy).toContain("No prompt");
});

test("redacts encoded VS Code resource and Unix home paths", () => {
  const diagnostic = createRuntimeDiagnostic({
    error: new Error(
      "at file+.vscode-resource.vscode-cdn.net/c%3A/Users/person/project/index.js then /home/person/project/file.ts",
    ),
    historyLength: 1,
    toolStatusCounts: {},
  });

  expect(diagnostic.error.message).toContain("[LOCAL_RESOURCE]");
  expect(diagnostic.error.message).toContain("[LOCAL_PATH]");
  expect(diagnostic.error.message).not.toContain("person/project");
});

test("extracts a structured quota error instead of recording object Object", () => {
  const diagnostic = createRuntimeDiagnostic({
    error: {
      message: JSON.stringify({
        error: {
          message: "Monthly credits are used up",
          code: "monthly_limit_reached",
          type: "quota_exceeded",
        },
      }),
    },
    sessionId: "session-1",
    historyLength: 12,
    toolStatusCounts: { done: 8 },
  });

  expect(diagnostic.error.message).toBe("Monthly credits are used up");
  expect(diagnostic.error.code).toBe("monthly_limit_reached");
  expect(diagnostic.error.type).toBe("quota_exceeded");
  expect(diagnostic.analysis.likelyCause).toContain("credit quota");
  expect(diagnostic.error.message).not.toBe("[object Object]");
});

test("stores the same runtime failure only once", () => {
  window.localStorage.clear();
  const diagnostic = createRuntimeDiagnostic({
    error: { message: "Cannot read properties of undefined (reading 'map')" },
    sessionId: "session-1",
    historyLength: 4,
    toolStatusCounts: {},
  });

  saveRuntimeDiagnostic(diagnostic);
  saveRuntimeDiagnostic({ ...diagnostic, id: "duplicate" });

  const saved = JSON.parse(
    window.localStorage.getItem("vynorai.runtimeDiagnostics.v1") ?? "[]",
  );
  expect(saved).toHaveLength(1);
});
