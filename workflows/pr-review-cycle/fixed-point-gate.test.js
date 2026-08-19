const assert = require('node:assert/strict');
const test = require('node:test');
const { CONTINUE, READY, evaluateFixedPoint } = require('./fixed-point-gate');

const cleanState = () => ({
  headSha: 'head-2',
  baseSha: 'base-1',
  latestSubmittedReview: { headSha: 'head-2', submitted: true, findingCount: 0 },
  unresolvedThreadCount: 0,
  checksComplete: true,
  checksPassing: true,
  mergeable: true,
  mergeStateClean: true,
  baseIsCurrent: true,
  worktreeClean: true
});

test('pending exact-head review always continues the loop', () => {
  const state = cleanState();
  state.latestSubmittedReview = null;
  const result = evaluateFixedPoint(state);
  assert.equal(result.state, CONTINUE);
  assert.equal(result.mergeApprovalAllowed, false);
  assert.ok(result.reasons.includes('exact_head_review_pending'));
});

test('a clean review for an older head never opens merge approval', () => {
  const state = cleanState();
  state.latestSubmittedReview.headSha = 'head-1';
  const result = evaluateFixedPoint(state);
  assert.equal(result.state, CONTINUE);
  assert.ok(result.reasons.includes('latest_review_is_stale'));
});

test('findings or unresolved threads always continue remediation', () => {
  const state = cleanState();
  state.latestSubmittedReview.findingCount = 2;
  state.unresolvedThreadCount = 1;
  const result = evaluateFixedPoint(state);
  assert.equal(result.state, CONTINUE);
  assert.deepEqual(result.reasons.filter((reason) => reason.includes('finding') || reason.includes('thread')), [
    'latest_review_has_findings',
    'unresolved_review_threads'
  ]);
});

test('approval opens only at a complete exact-head fixed point', () => {
  const result = evaluateFixedPoint(cleanState());
  assert.equal(result.state, READY);
  assert.equal(result.mergeApprovalAllowed, true);
  assert.deepEqual(result.reasons, []);
});

test('every required boundary independently keeps the loop closed', () => {
  const cases = [
    ['headSha', undefined, 'missing_head_sha'],
    ['baseSha', undefined, 'missing_base_sha'],
    ['checksComplete', false, 'checks_pending'],
    ['checksPassing', false, 'checks_not_passing'],
    ['mergeable', false, 'not_mergeable'],
    ['mergeStateClean', false, 'merge_state_not_clean'],
    ['baseIsCurrent', false, 'base_is_stale'],
    ['worktreeClean', false, 'worktree_not_clean']
  ];

  for (const [field, value, reason] of cases) {
    const state = cleanState();
    state[field] = value;
    const result = evaluateFixedPoint(state);
    assert.equal(result.state, CONTINUE, field);
    assert.equal(result.mergeApprovalAllowed, false, field);
    assert.ok(result.reasons.includes(reason), `${field}: ${reason}`);
  }
});

test('an unsubmitted exact-head review remains pending', () => {
  const state = cleanState();
  state.latestSubmittedReview.submitted = false;
  const result = evaluateFixedPoint(state);
  assert.equal(result.state, CONTINUE);
  assert.ok(result.reasons.includes('exact_head_review_pending'));
});

test('duplicate pending reasons are normalized', () => {
  const state = cleanState();
  state.latestSubmittedReview = { headSha: 'head-2', submitted: false, findingCount: 0 };
  const result = evaluateFixedPoint(state);
  assert.equal(result.reasons.filter((reason) => reason === 'exact_head_review_pending').length, 1);
});
