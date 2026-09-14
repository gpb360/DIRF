import { test } from "node:test";
import assert from "node:assert/strict";
import * as reviewReport from "../skills/code-review/scripts/review-report.mjs";

const head = "a".repeat(40);
const review = (repository) => ({ target: { repository, pr_number: 57 } });
const threads = (nodes = [], hasNextPage = false) => ({ data: { repository: { pullRequest: {
  reviewThreads: { nodes, pageInfo: { hasNextPage } },
} } } });

const checkRun = ({
  id = 1,
  app = { id: 8329, slug: "vercel" },
  suiteId = 100,
  runId = null,
  name = "Vercel Preview Comments",
  startedAt = "2026-09-13T00:00:00Z",
  status = "completed",
  conclusion = "success",
  hostname = "github.com",
} = {}) => ({
  id,
  app,
  check_suite: { id: suiteId },
  details_url: runId === null ? "https://vercel.com/github" : `https://${hostname}/owner/repo/actions/runs/${runId}/job/${id}`,
  name,
  started_at: startedAt,
  status,
  conclusion,
});

const workflowRun = ({
  id,
  suiteId,
  workflowId = 900,
  runNumber = id,
  createdAt,
  status = "completed",
  conclusion = "success",
} = {}) => ({
  id,
  check_suite_id: suiteId,
  workflow_id: workflowId,
  run_number: runNumber,
  run_attempt: 1,
  status,
  conclusion,
  created_at: createdAt,
  head_sha: head,
});

function githubActionsCheck(options = {}) {
  return checkRun({
    app: { id: 15368, slug: "github-actions" },
    name: "build",
    ...options,
  });
}

function githubRequest({
  pages,
  workflows = new Map(),
  statusPages = [[]],
  graph = threads([{ isResolved: true }]),
}) {
  const calls = [];
  const request = (args) => {
    calls.push(args);
    if (args.includes("graphql")) return graph;
    const endpoint = args.find((arg) => typeof arg === "string" && arg.startsWith("repos/"));
    const workflowMatch = endpoint?.match(/\/actions\/runs\/(\d+)$/);
    if (workflowMatch) return workflows.get(Number(workflowMatch[1]));
    const pageMatch = endpoint?.match(/[?&]page=(\d+)/);
    const page = (pageMatch ? Number(pageMatch[1]) : 1) - 1;
    if (endpoint?.includes("/statuses?")) return statusPages[page];
    return pages[page];
  };
  return { calls, request };
}

test("canonical GitHub URLs require live checks instead of silently skipping them", () => {
  for (const repository of ["https://github.com/gpb360/DIRF.git", "git@github.com:gpb360/DIRF.git", "gpb360/DIRF"]) {
    const calls = [];
    assert.throws(() => reviewReport.liveGithubState(review(repository), head, (args) => {
      calls.push(args);
      return { total_count: 0, check_runs: [] };
    }), /all live pull-request checks passed/);
    assert.equal(calls.length, 1);
    assert.ok(calls[0].includes(`repos/gpb360/dirf/commits/${head}/check-runs?per_page=100&filter=all`));
    assert.ok(calls[0].includes("github.com"));
  }
});

test("successful verification checks the requested host and all review conversations", () => {
  const { calls, request } = githubRequest({
    pages: [{ total_count: 1, check_runs: [checkRun({ hostname: "github.example.test" })] }],
  });
  const result = reviewReport.liveGithubState(review("https://github.example.test/owner/repo.git"), head, request);
  assert.deepEqual(result, { live_checks_passed: true, live_unresolved_threads: 0 });
  assert.equal(calls.length, 3);
  assert.ok(calls.every((args) => args[0] === "--hostname" && args[1] === "github.example.test"));
  assert.ok(calls[2].includes("number=57"));
});

test("reads every check-run page and rejects incomplete or duplicated pagination", () => {
  const first = checkRun({ id: 1 });
  const second = checkRun({ id: 2, name: "deployment", startedAt: "2026-09-13T00:01:00Z" });
  const passing = githubRequest({ pages: [
    { total_count: 2, check_runs: [first] },
    { total_count: 2, check_runs: [second] },
  ] });
  assert.deepEqual(
    reviewReport.liveGithubState(review("https://github.com/owner/repo"), head, passing.request),
    { live_checks_passed: true, live_unresolved_threads: 0 },
  );
  assert.ok(passing.calls.some((args) => args.some((arg) => arg.includes("&filter=all&page=2"))));

  for (const pages of [
    [{ total_count: 2, check_runs: [first] }, { total_count: 2, check_runs: [] }],
    [{ total_count: 2, check_runs: [first] }, { total_count: 3, check_runs: [second] }],
    [{ total_count: 2, check_runs: [first] }, { total_count: 2, check_runs: [first] }],
  ]) {
    assert.throws(() => reviewReport.liveGithubState(
      review("https://github.com/owner/repo"), head, githubRequest({ pages }).request,
    ), /all live pull-request checks passed/);
  }
});

test("selects the latest workflow execution before evaluating its jobs", () => {
  const oldRunId = 34737909060;
  const newRunId = 34737923132;
  const oldSuiteId = 94086915799;
  const newSuiteId = 94086948585;
  const checks = [
    githubActionsCheck({
      id: 103672510466,
      suiteId: oldSuiteId,
      runId: oldRunId,
      name: "github.event.action == 'labeled' && 'Final exact-head validation'",
      startedAt: "2026-09-13T04:27:21Z",
      conclusion: "cancelled",
    }),
    githubActionsCheck({
      id: 103672509957,
      suiteId: oldSuiteId,
      runId: oldRunId,
      name: "Supabase database tests",
      startedAt: "2026-09-13T04:27:21Z",
      conclusion: "skipped",
    }),
    githubActionsCheck({
      id: 103672953769,
      suiteId: newSuiteId,
      runId: newRunId,
      name: "Final exact-head validation",
      startedAt: "2026-09-13T04:31:27Z",
    }),
    githubActionsCheck({
      id: 103672549164,
      suiteId: newSuiteId,
      runId: newRunId,
      name: "Supabase database tests",
      startedAt: "2026-09-13T04:27:52Z",
    }),
  ];
  const workflows = new Map([
    [oldRunId, workflowRun({ id: oldRunId, suiteId: oldSuiteId, createdAt: "2026-09-13T04:26:56Z", conclusion: "cancelled" })],
    [newRunId, workflowRun({ id: newRunId, suiteId: newSuiteId, createdAt: "2026-09-13T04:27:17Z" })],
  ]);
  const { request } = githubRequest({ pages: [{ total_count: checks.length, check_runs: checks }], workflows });
  assert.deepEqual(
    reviewReport.liveGithubState(review("https://github.com/owner/repo"), head, request),
    { live_checks_passed: true, live_unresolved_threads: 0 },
  );
});

test("fails closed when the newest required workflow or one of its jobs is failed or pending", () => {
  for (const newest of [
    { status: "completed", conclusion: "failure" },
    { status: "in_progress", conclusion: null },
  ]) {
    const oldRunId = 10;
    const newRunId = 20;
    const checks = [
      githubActionsCheck({ id: 1, suiteId: 100, runId: oldRunId, startedAt: "2026-09-13T00:00:00Z" }),
      githubActionsCheck({ id: 2, suiteId: 200, runId: newRunId, startedAt: "2026-09-13T00:01:00Z", ...newest }),
    ];
    const workflows = new Map([
      [oldRunId, workflowRun({ id: oldRunId, suiteId: 100, createdAt: "2026-09-13T00:00:00Z" })],
      [newRunId, workflowRun({ id: newRunId, suiteId: 200, createdAt: "2026-09-13T00:01:00Z", ...newest })],
    ]);
    assert.throws(() => reviewReport.liveGithubState(
      review("https://github.com/owner/repo"),
      head,
      githubRequest({ pages: [{ total_count: checks.length, check_runs: checks }], workflows }).request,
    ), /all live pull-request checks passed/);
  }

  const pendingJob = githubActionsCheck({ id: 3, suiteId: 300, runId: 30, status: "in_progress", conclusion: null });
  assert.throws(() => reviewReport.liveGithubState(
    review("https://github.com/owner/repo"),
    head,
    githubRequest({
      pages: [{ total_count: 1, check_runs: [pendingJob] }],
      workflows: new Map([[30, workflowRun({ id: 30, suiteId: 300, createdAt: "2026-09-13T00:02:00Z" })]]),
    }).request,
  ), /all live pull-request checks passed/);
});

test("fails closed when multiple attempts for one workflow run cannot be bound to current jobs", () => {
  const runId = 30;
  const checks = [
    githubActionsCheck({
      id: 1,
      suiteId: 300,
      runId,
      startedAt: "2026-09-13T00:00:00Z",
      conclusion: "failure",
    }),
    githubActionsCheck({
      id: 2,
      suiteId: 300,
      runId,
      startedAt: "2026-09-13T00:01:00Z",
    }),
  ];
  const workflows = new Map([[
    runId,
    workflowRun({ id: runId, suiteId: 300, createdAt: "2026-09-13T00:00:00Z" }),
  ]]);
  assert.throws(() => reviewReport.liveGithubState(
    review("https://github.com/owner/repo"),
    head,
    githubRequest({ pages: [{ total_count: checks.length, check_runs: checks }], workflows }).request,
  ), /all live pull-request checks passed/);
});

test("allows only the known optional CodeSmith check to be skipped", () => {
  const required = checkRun({ id: 1 });
  const codeSmith = checkRun({
    id: 2,
    app: { id: 807020, slug: "blacksmith-sh" },
    suiteId: 200,
    name: "[code]smith",
    startedAt: "2026-09-13T00:01:00Z",
    conclusion: "skipped",
  });
  assert.deepEqual(reviewReport.liveGithubState(
    review("https://github.com/owner/repo"),
    head,
    githubRequest({ pages: [{ total_count: 2, check_runs: [required, codeSmith] }] }).request,
  ), { live_checks_passed: true, live_unresolved_threads: 0 });

  for (const impostor of [
    { ...codeSmith, app: { id: 1, slug: "blacksmith-sh" } },
    { ...codeSmith, name: "CodeSmith" },
  ]) {
    assert.throws(() => reviewReport.liveGithubState(
      review("https://github.com/owner/repo"),
      head,
      githubRequest({ pages: [{ total_count: 2, check_runs: [required, impostor] }] }).request,
    ), /all live pull-request checks passed/);
  }
});

test("uses only the newest state per commit-status context and paginates statuses", () => {
  const firstStatusPage = Array.from({ length: 99 }, (_, index) => ({
    id: index + 1,
    context: `required-${index}`,
    state: "success",
    created_at: "2026-09-13T00:00:00Z",
  }));
  firstStatusPage.push({
    id: 100,
    context: "Vercel",
    state: "pending",
    created_at: "2026-09-13T00:00:00Z",
  });
  const currentVercel = {
    id: 101,
    context: "Vercel",
    state: "success",
    created_at: "2026-09-13T00:01:00Z",
  };
  const passing = githubRequest({
    pages: [{ total_count: 1, check_runs: [checkRun()] }],
    statusPages: [firstStatusPage, [currentVercel]],
  });
  assert.deepEqual(
    reviewReport.liveGithubState(review("https://github.com/owner/repo"), head, passing.request),
    { live_checks_passed: true, live_unresolved_threads: 0 },
  );
  assert.ok(passing.calls.some((args) => args.some((arg) => arg.includes("/statuses?per_page=100&page=2"))));

  for (const state of ["pending", "failure"]) {
    const statusPages = [[
      { id: 1, context: "Vercel", state: "success", created_at: "2026-09-13T00:00:00Z" },
      { id: 2, context: "Vercel", state, created_at: "2026-09-13T00:01:00Z" },
    ]];
    assert.throws(() => reviewReport.liveGithubState(
      review("https://github.com/owner/repo"),
      head,
      githubRequest({ pages: [{ total_count: 1, check_runs: [checkRun()] }], statusPages }).request,
    ), /all live pull-request commit statuses passed/);
  }
});

test("fails closed on malformed workflow identity and missing, failed, or unresolved evidence", () => {
  const malformedWorkflowCheck = githubActionsCheck({ id: 1, suiteId: 100, runId: null });
  assert.throws(() => reviewReport.liveGithubState(
    review("https://github.com/owner/repo"),
    head,
    githubRequest({ pages: [{ total_count: 1, check_runs: [malformedWorkflowCheck] }] }).request,
  ), /all live pull-request checks passed/);
  assert.throws(() => reviewReport.liveGithubState(
    review("https://github.com/owner/repo"),
    head,
    githubRequest({
      pages: [{ total_count: 1, check_runs: [{ ...checkRun(), started_at: null }] }],
    }).request,
  ), /all live pull-request checks passed/);
  assert.throws(() => reviewReport.liveGithubState(
    review("https://github.com/owner/repo"),
    head,
    githubRequest({
      pages: [{ total_count: 1, check_runs: [checkRun()] }],
      statusPages: [[{ id: 1, context: "Vercel", state: "success" }]],
    }).request,
  ), /all live pull-request commit statuses passed/);

  for (const checks of [
    {},
    { total_count: 1, check_runs: [checkRun({ status: "in_progress", conclusion: null })] },
    { total_count: 1, check_runs: [checkRun({ conclusion: "failure" })] },
  ]) {
    assert.throws(() => reviewReport.liveGithubState(review("https://github.com/owner/repo"), head,
      () => checks), /all live pull-request checks passed/);
  }
  for (const graph of [{}, threads([{ isResolved: false }]), threads([], true)]) {
    assert.throws(() => reviewReport.liveGithubState(
      review("https://github.com/owner/repo"),
      head,
      githubRequest({ pages: [{ total_count: 1, check_runs: [checkRun()] }], graph }).request,
    ), /conversations are resolved/);
  }
  assert.throws(() => reviewReport.liveGithubState(review("https://github.com/owner/repo"), head,
    () => { throw new Error("API unavailable"); }), /API unavailable/);
  for (const repository of ["unknown", "https://github.com/owner/repo/tree/main", "https://github.com/../repo"]) {
    assert.throws(() => reviewReport.liveGithubState(review(repository), head,
      () => assert.fail("invalid target must not call GitHub")), /could not identify/);
  }
});
