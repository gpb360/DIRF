const READY = 'ready_for_merge_approval';
const CONTINUE = 'continue_review_loop';

function evaluateFixedPoint(state) {
  const reasons = [];
  const head = state?.headSha;
  const review = state?.latestSubmittedReview;

  if (!head) reasons.push('missing_head_sha');
  if (!state?.baseSha) reasons.push('missing_base_sha');
  if (!review) reasons.push('exact_head_review_pending');
  if (review && review.headSha !== head) reasons.push('latest_review_is_stale');
  if (review && review.submitted !== true) reasons.push('exact_head_review_pending');
  if (review && Number(review.findingCount || 0) > 0) reasons.push('latest_review_has_findings');
  if (Number(state?.unresolvedThreadCount || 0) > 0) reasons.push('unresolved_review_threads');
  if (state?.checksComplete !== true) reasons.push('checks_pending');
  if (state?.checksPassing !== true) reasons.push('checks_not_passing');
  if (state?.mergeable !== true) reasons.push('not_mergeable');
  if (state?.mergeStateClean !== true) reasons.push('merge_state_not_clean');
  if (state?.baseIsCurrent !== true) reasons.push('base_is_stale');
  if (state?.worktreeClean !== true) reasons.push('worktree_not_clean');

  const uniqueReasons = [...new Set(reasons)];
  return {
    state: uniqueReasons.length === 0 ? READY : CONTINUE,
    mergeApprovalAllowed: uniqueReasons.length === 0,
    reasons: uniqueReasons,
    nextAction: uniqueReasons.length === 0
      ? 'present_exact_head_merge_approval_boundary'
      : 'wait_ingest_fix_reply_resolve_rereview'
  };
}

module.exports = { CONTINUE, READY, evaluateFixedPoint };
