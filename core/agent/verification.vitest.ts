import { describe, expect, it } from "vitest";

import { hasPassedRequiredVerification } from "./verification";

describe("hasPassedRequiredVerification", () => {
  it("does not require evidence for read-only work", () => {
    expect(
      hasPassedRequiredVerification({ approvals: [], verification: [] }),
    ).toBe(true);
  });

  it("rejects response-only and stale evidence after a mutation", () => {
    const approval = {
      id: "approval-1",
      toolCallId: "edit-1",
      toolName: "multi_edit",
      risk: "R2" as const,
      decision: "approved" as const,
      approvedAt: 20,
      scopeDigest: "digest",
    };

    expect(
      hasPassedRequiredVerification({
        approvals: [approval],
        verification: [
          {
            id: "response-1",
            kind: "response",
            status: "passed",
            summary: "The model says it is done",
            createdAt: 21,
          },
        ],
      }),
    ).toBe(false);
    expect(
      hasPassedRequiredVerification({
        approvals: [approval],
        verification: [
          {
            id: "test-1",
            kind: "test",
            status: "passed",
            summary: "Old test pass",
            createdAt: 19,
          },
        ],
      }),
    ).toBe(false);
  });

  it("accepts passed non-response evidence after the latest mutation", () => {
    expect(
      hasPassedRequiredVerification({
        approvals: [
          {
            id: "approval-1",
            toolCallId: "edit-1",
            toolName: "multi_edit",
            risk: "R2",
            decision: "approved",
            approvedAt: 20,
            scopeDigest: "digest",
          },
        ],
        verification: [
          {
            id: "test-1",
            kind: "typecheck",
            status: "passed",
            summary: "Typecheck passed",
            createdAt: 21,
          },
        ],
      }),
    ).toBe(true);
  });
});
