import type { ApprovalReceipt, VerificationResult } from "./types";

type VerificationTask = {
  approvals: ApprovalReceipt[];
  verification: VerificationResult[];
};

function latestMutatingApproval(
  approvals: ApprovalReceipt[],
): ApprovalReceipt | undefined {
  const workspaceMutationTools = new Set([
    "edit_existing_file",
    "single_find_and_replace",
    "multi_edit",
    "create_new_file",
    "create_rule_block",
  ]);
  return approvals
    .filter(
      (receipt) =>
        receipt.decision === "approved" &&
        workspaceMutationTools.has(receipt.toolName),
    )
    .sort((left, right) => right.approvedAt - left.approvedAt)[0];
}

/**
 * Read-only tasks do not need verification evidence. A task that performed a
 * approved workspace edit does: a model response is never evidence, and evidence
 * from before the latest approved mutation is stale.
 *
 * Terminal commands are R3 because of their security risk, not because every
 * command mutates the project. Treating a later server-stop command as a
 * mutation invalidated the passing test immediately before it.
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
