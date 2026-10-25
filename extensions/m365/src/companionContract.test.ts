import assert from "node:assert/strict";
import test from "node:test";
import {
  companionFeatureForOperation,
  isValidCompanionDispatchRequest,
  isValidCompanionDispatchResponse,
  type CompanionDispatchRequest,
} from "../../../packages/m365-contracts/src/companion.ts";

const base: CompanionDispatchRequest = {
  contractVersion: "2026-10-24.windows-companion.v1",
  type: "execute",
  requestId: "request-1234567890",
  tenantId: "tenant-1",
  objectId: "user-1",
  feature: "solver",
  operation: "run-solver",
  workbook: {
    sessionId: "session-1234567890",
    workbookFingerprint: "workbook-1234567890",
    sourceFingerprint: "source-1234567890",
    origin: "excel-desktop-addin",
  },
  approval: {
    approved: true,
    grantId: "grant-1234567890",
    expiresAt: "2026-10-25T12:00:00.000Z",
  },
  parameters: { objective: "maximize", targetCell: "B2" },
  requestedAt: "2026-10-25T11:00:00.000Z",
};

test("companion operations map only to known native capabilities", () => {
  assert.equal(companionFeatureForOperation("run-solver"), "solver");
  assert.equal(
    companionFeatureForOperation("create-data-model"),
    "data-model-authoring",
  );
});

test("native dispatch accepts bounded approval-bound settings", () => {
  assert.equal(isValidCompanionDispatchRequest(base), true);
});

test("native dispatch rejects feature mismatches, workbook values and oversized settings", () => {
  assert.equal(
    isValidCompanionDispatchRequest({ ...base, feature: "vba-com" }),
    false,
  );
  assert.equal(
    isValidCompanionDispatchRequest({
      ...base,
      parameters: { workbookValues: "do not send" },
    }),
    false,
  );
  assert.equal(
    isValidCompanionDispatchRequest({
      ...base,
      parameters: { value: "x".repeat(513) },
    }),
    false,
  );
});

test("native responses require the exact request binding and verified completion", () => {
  const response = {
    contractVersion: base.contractVersion,
    type: "execute-result" as const,
    requestId: base.requestId,
    status: "completed" as const,
    feature: base.feature,
    operation: base.operation,
    workbook: base.workbook,
    verification: {
      status: "verified" as const,
      changedCells: 2,
      evidence: ["ok"],
    },
  };
  assert.equal(isValidCompanionDispatchResponse(response, base), true);
  assert.equal(
    isValidCompanionDispatchResponse(
      {
        ...response,
        workbook: {
          ...base.workbook,
          sourceFingerprint: "other-source-123456",
        },
      },
      base,
    ),
    false,
  );
  assert.equal(
    isValidCompanionDispatchResponse(
      {
        ...response,
        verification: { ...response.verification, status: "failed" as const },
      },
      base,
    ),
    false,
  );
  assert.equal(
    isValidCompanionDispatchResponse(
      {
        ...response,
        status: "failed" as const,
        verification: { ...response.verification, status: "failed" as const },
      },
      base,
    ),
    false,
  );
});
