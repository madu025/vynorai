import type { ApprovalReceipt, VerificationResult } from "./types";

type VerificationTask = {
  approvals: ApprovalReceipt[];
  verification: VerificationResult[];
};

function latestMutatingApproval(
  approvals: ApprovalReceipt[],
): ApprovalReceipt | undefined {
  return approvals
    .filter(
      (receipt) =>
        receipt.decision === "approved" &&
        (receipt.risk === "R2" || receipt.risk === "R3"),
    )
    .sort((left, right) => right.approvedAt - left.approvedAt)[0];
}

/**
 * Read-only tasks do not need verification evidence. A task that performed a
 * approved mutation does: a model response is never evidence, and evidence
 * from before the latest approved mutation is stale.
 */
export function hasPassedRequiredVerification(task: VerificationTask): boolean {
  const latestApproval = latestMutatingApproval(task.approvals);
  if (!latestApproval) return true;

  return task.verification.some(
    (result) =>
      result.status === "passed" &&
      result.kind !== "response" &&
      result.createdAt >= latestApproval.approvedAt,
  );
}
