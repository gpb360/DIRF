// dirf review loop: run the Review Ladder for one PR checkout without a
// person between steps, then report once. The ladder never repeats a step:
// check gate, one review, two more reviews, one fix, check gate, one review of
// the fix, stop. Every review goes through the DIRF review ledger, so the store
// round limit still applies. The loop never pushes and never merges.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import { blockingFindings, deriveVerdict, validateReview } from "../skills/code-review/scripts/review-report.mjs";
import { verifyUpdatedReview } from "../skills/code-review/scripts/review-ledger.mjs";

const OUTPUT_TAIL_CHARS = 4000;
// The ledger action for a complete review with no finding and passing evidence.
// continue_review is not clean: the ledger also returns it for a review that
// has no finding but could not verify everything.
const QUALIFIED_ACTIONS = new Set(["verify_merge_readiness"]);

export const LOOP_OUTCOMES = Object.freeze({
  already_qualified: "The recorded review of this commit is qualified. No command ran.",
  qualified: "The review is qualified.",
  qualified_after_fix: "The review of the fix is qualified.",
  check_failed: "A required check failed. No reviewer ran on this commit.",
  stop_for_person: "The review ledger stopped the loop for a person.",
  fixer_failed: "The fixer command failed.",
  fixer_made_no_commit: "The fixer command made no new commit.",
  fixer_rewrote_history: "The fixer command replaced the reviewed commit instead of adding a commit on top of it.",
  partial: "No review found a blocking issue, but a review could not verify everything. A person decides.",
  needs_new_examination: "The review of the fix is not qualified. The work needs a new examination by a person.",
  error: "The loop stopped because of an error.",
});

const PASSING = new Set(["already_qualified", "qualified", "qualified_after_fix"]);

export function loopPassed(report) {
  return PASSING.has(report.outcome);
}

// A review is qualified when it has no blocking P0, P1, P2, or P3 finding and
// its evidence is complete (derived verdict PASS). A pre-existing P2 or P3
// finding does not block; a pre-existing P0 or P1 does. A review with no
// finding but with limitations, unpassed verification, low confidence, or an
// incomplete completion record is partial: absence of findings is not proof.
export function isQualified(review) {
  return deriveVerdict(review) === "PASS";
}

// The recorded reviews of one commit qualify it when the ladder would stop
// there: every review is qualified, or at least two reviews are qualified.
// One clean entry after reviews with findings does not qualify the commit.
export function recordedCommitQualified(entries) {
  const clean = entries.filter((entry) => QUALIFIED_ACTIONS.has(entry.action)).length;
  return clean > 0 && (clean === entries.length || clean >= 2);
}

function tail(text) {
  const value = String(text || "");
  return value.length > OUTPUT_TAIL_CHARS ? value.slice(-OUTPUT_TAIL_CHARS) : value;
}

/** Run one shell command in the checkout. The command string comes from the person who runs dirf. */
export function runShellCommand(command, env, cwd) {
  const result = spawnSync(command, {
    cwd,
    env: { ...process.env, ...env },
    shell: true,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error) return { status: 127, output: tail(result.error.message) };
  return { status: result.status ?? 1, output: tail(`${result.stdout || ""}${result.stderr || ""}`) };
}

class LoopStop extends Error {
  constructor(outcome, detail = {}) {
    super(detail.error || outcome);
    this.outcome = outcome;
    this.detail = detail;
  }
}

// ── The ladder as a state machine ────────────────────────────────────────────
// One core, two drivers. `runReviewLadder` drives it with shell commands (CI).
// `dirf review next` / `dirf review record` let the host agent run each step
// with its own visible agent feature, so DIRF never starts an agent itself.
// The state is plain JSON so a host can stop and continue between steps.

export const LADDER_STATE_FILE = "loop-state.json";

function reviewPath(state, step) {
  return join(state.out_dir, `${state.head.slice(0, 12)}-step${step}.json`);
}

// A new review step never reuses an older file at its path.
function reviewStep(state, step, prior = [], request = "") {
  const path = reviewPath(state, step);
  rmSync(path, { force: true });
  return { kind: "review", step, write_to: path, prior, request, head: state.head };
}

function checkStep(state, before) {
  return { kind: "check", before, command: state.check, head: state.head };
}

function finishState(state, outcome, detail = {}) {
  state.pending = null;
  state.outcome = outcome;
  state.detail = detail;
  return state;
}

function readReview(path) {
  const review = JSON.parse(readFileSync(path, "utf8"));
  validateReview(review);
  return review;
}

/**
 * @param {{ pr: number, check?: string, outDir: string }} options
 * @param {{ head: () => string, recorded: (pr: number, head: string) => any[] }} deps
 */
export function startLadder(options, deps) {
  const { pr, check, outDir } = options;
  if (!Number.isInteger(pr) || pr < 1) throw new Error("dirf review loop requires --pr with a pull-request number");
  mkdirSync(outDir, { recursive: true });
  const head = String(deps.head()).toLowerCase();
  const state = {
    schema_version: 1,
    pr,
    check: check || null,
    out_dir: outDir,
    start_head: head,
    head,
    steps: [],
    reviews: [],
    request_path: null,
    review_paths: [],
    pending: null,
    outcome: null,
    detail: {},
  };
  if (recordedCommitQualified(deps.recorded(pr, head) || [])) return finishState(state, "already_qualified");
  state.pending = check ? checkStep(state, "step 1") : reviewStep(state, 1);
  return state;
}

function recordCheck(state, result) {
  const pending = state.pending;
  const passed = result.status === 0;
  state.steps.push({ kind: "check", before: pending.before, head: state.head, status: passed ? "passed" : "failed" });
  if (!passed) throw new LoopStop("check_failed", { check_output: result.output || "" });
  state.pending = pending.before === "step 1"
    ? reviewStep(state, 1)
    : reviewStep(state, 4, state.review_paths, state.request_path);
}

function recordReview(state, result, deps) {
  const { step, write_to: path } = state.pending;
  if (result.status !== undefined && result.status !== 0) {
    throw new LoopStop("error", { error: `The reviewer command exited with status ${result.status} at step ${step}.`, output: result.output });
  }
  if (!existsSync(path)) throw new LoopStop("error", { error: `The reviewer command wrote no review at step ${step}. It must write review JSON to DIRF_REVIEW_OUTPUT.` });
  let artifact;
  try {
    artifact = readReview(path);
  } catch (error) {
    throw new LoopStop("error", { error: `The review from step ${step} is not valid: ${error.message}` });
  }
  if (artifact.target.pr_number !== state.pr) throw new LoopStop("error", { error: `The review from step ${step} names PR #${artifact.target.pr_number}, not PR #${state.pr}.` });
  if (String(artifact.target.head_sha).toLowerCase() !== state.head) throw new LoopStop("error", { error: `The review from step ${step} names commit ${artifact.target.head_sha}, not the checkout commit ${state.head}.` });
  const action = deps.trigger(artifact);
  const entry = { step, path, head: state.head, qualified: isQualified(artifact), findings: blockingFindings(artifact).length, action: action.action };
  if (!entry.qualified && entry.findings === 0) entry.partial = true;
  state.steps.push({ kind: "review", ...entry });
  state.reviews.push({ ...entry, request: action });
  if (action.action === "stop_for_person") throw new LoopStop("stop_for_person", { findings: action.findings });

  if (step === 1) {
    if (entry.qualified) return finishState(state, "qualified");
    state.pending = reviewStep(state, 2);
  } else if (step === 2) {
    state.pending = reviewStep(state, 3);
  } else if (step === 3) {
    const sameCommit = state.reviews.slice(0, 3);
    if (sameCommit.filter((item) => item.qualified).length >= 2) {
      const open = sameCommit.find((item) => !item.qualified);
      return finishState(state, "qualified", { reported_findings: blockingFindings(readReview(open.path)) });
    }
    // Only a review with a blocking finding gives the fixer work. When no
    // review found one, the open reviews are partial and a person decides.
    const fixSource = sameCommit.find((item) => !item.qualified && item.findings > 0);
    if (!fixSource) return finishState(state, "partial", { limitations: sameCommit.flatMap((item) => readReview(item.path).limitations) });
    state.request_path = join(state.out_dir, `${state.head.slice(0, 12)}-fix-request.json`);
    writeFileSync(state.request_path, JSON.stringify(fixSource.request, null, 2) + "\n");
    state.review_paths = sameCommit.map((item) => item.path);
    state.pending = {
      kind: "fix",
      head: state.head,
      findings: state.review_paths,
      request: state.request_path,
      // true when the ledger asks for a new approach: run the fix in a new agent session.
      new_agent: fixSource.request.new_agent?.required === true,
    };
  } else {
    const request = JSON.parse(readFileSync(state.request_path, "utf8"));
    try {
      verifyUpdatedReview(request, artifact);
    } catch (error) {
      throw new LoopStop("error", { error: `The review of the fix does not match the original PR: ${error.message}` });
    }
    if (entry.qualified) return finishState(state, "qualified_after_fix");
    return finishState(state, "needs_new_examination", { reported_findings: blockingFindings(artifact) });
  }
  return state;
}

function recordFix(state, result, deps) {
  const passed = result.status === undefined || result.status === 0;
  state.steps.push({ kind: "fix", head: state.head, status: passed ? "passed" : "failed" });
  if (!passed) return finishState(state, "fixer_failed", { output: result.output });
  const fixedHead = String(deps.head()).toLowerCase();
  if (fixedHead === state.head) return finishState(state, "fixer_made_no_commit");
  if (!deps.descends(state.head, fixedHead)) {
    state.head = fixedHead;
    return finishState(state, "fixer_rewrote_history");
  }
  state.head = fixedHead;
  state.pending = state.check
    ? checkStep(state, "step 4")
    : reviewStep(state, 4, state.review_paths, state.request_path);
  return state;
}

/**
 * Record the result of the pending step and choose the next one.
 * @param {any} state
 * @param {{ status?: number, output?: string }} result
 * @param {{ head: () => string, descends: (a: string, b: string) => boolean, trigger: (review: any) => any }} deps
 */
export function recordLadderResult(state, result, deps) {
  if (!state.pending) throw new Error("The review ladder has no pending step. Start a new run.");
  try {
    if (state.pending.kind === "check") recordCheck(state, result);
    else if (state.pending.kind === "review") recordReview(state, result, deps);
    else recordFix(state, result, deps);
  } catch (error) {
    if (error instanceof LoopStop) return finishState(state, error.outcome, error.detail);
    return finishState(state, "error", { error: error.message });
  }
  return state;
}

export function loopReport(state) {
  return {
    schema_version: 1,
    pr: state.pr,
    outcome: state.outcome,
    summary: LOOP_OUTCOMES[state.outcome],
    start_head: state.start_head,
    head: state.head,
    steps: state.steps,
    reviews: state.reviews.map(({ step, path, qualified, findings, partial }) => ({ step, path, qualified, findings, ...(partial ? { partial } : {}) })),
    ...state.detail,
    guardrails: { merge_is_not_authorized: true, push_is_not_performed: true },
  };
}

// Environment for a shell command, the same names the host action carries.
function stepEnv(state, pending) {
  const base = { DIRF_REVIEW_PR: String(state.pr), DIRF_REVIEW_HEAD: pending.head };
  if (pending.kind === "review") {
    return {
      ...base,
      DIRF_REVIEW_OUTPUT: pending.write_to,
      DIRF_REVIEW_STEP: String(pending.step),
      DIRF_REVIEW_PRIOR: pending.prior.join(delimiter),
      DIRF_REVIEW_REQUEST: pending.request || "",
    };
  }
  if (pending.kind === "fix") {
    return {
      ...base,
      DIRF_REVIEW_FINDINGS: pending.findings.join(delimiter),
      DIRF_REVIEW_REQUEST: pending.request,
      DIRF_REVIEW_NEW_AGENT: pending.new_agent ? "1" : "",
    };
  }
  return base;
}

/**
 * Shell driver: run every step with a command, without a person between steps.
 * @param {{ pr: number, reviewer: string, fixer: string, check?: string, outDir: string }} options
 * @param {{
 *   run: (command: string, env: Record<string, string>) => { status: number, output: string },
 *   head: () => string,
 *   descends: (ancestor: string, descendant: string) => boolean,
 *   trigger: (review: any) => any,
 *   recorded: (pr: number, head: string) => any[],
 * }} deps
 */
export function runReviewLadder(options, deps) {
  const { reviewer, fixer } = options;
  if (!Number.isInteger(options.pr) || options.pr < 1) throw new Error("dirf review loop requires --pr with a pull-request number");
  if (!reviewer || !fixer) throw new Error("dirf review loop requires --reviewer and --fixer commands");
  const state = startLadder(options, deps);
  while (state.pending) {
    const pending = state.pending;
    const command = pending.kind === "check" ? state.check : pending.kind === "review" ? reviewer : fixer;
    recordLadderResult(state, deps.run(command, stepEnv(state, pending)), deps);
  }
  return loopReport(state);
}

// ── Host mode ────────────────────────────────────────────────────────────────

// Host detection only chooses the hint text. DIRF never starts the agent.
export function hostHint(env = process.env) {
  const named = String(env.DIRF_HARNESS || "").trim().toLowerCase();
  if (env.T3CODE_THREAD_ID || named === "t3" || named === "t3code") {
    return { host: "t3", how: "Start one new visible T3 child for this step with delegate_task (role review or implementation). Do not reuse an earlier child." };
  }
  if (env.CODEX_THREAD_ID || named === "codex") {
    return { host: "codex", how: "Start one new agent for this step with spawn_agent, then wait for it. Do not reuse an earlier agent." };
  }
  if (env.CLAUDECODE === "1" || named === "claude" || named === "claude-code") {
    return { host: "claude-code", how: "Start one new subagent for this step with the Agent tool. Do not reuse an earlier subagent." };
  }
  return { host: named || "unknown", how: "Run this step with your host's own visible agent or subagent feature, one new agent per step. Do not start hidden background agents." };
}

const FORBIDDEN = "Do not push, merge, or comment on the PR, and do not run dirf attempt, dirf record-progress, dirf review trigger, or dirf review record.";

// A paste-ready brief for the agent the host starts. It names files, not
// content, so the same brief works in every host.
export function stepBrief(state, pending) {
  if (pending.kind === "check") {
    return `Run the required check in the PR checkout: ${pending.command}. Report its exit status.`;
  }
  if (pending.kind === "review") {
    return [
      `Review PR #${state.pr} at commit ${pending.head} (review step ${pending.step}) as an independent reviewer.`,
      "Read skills/code-review/README.md and skills/code-review/findings-contract.md, then review the PR diff against its base.",
      `Write one schema version 2 review JSON for commit ${pending.head} to ${pending.write_to} and check it with dirf review validate.`,
      pending.prior.length ? `Earlier reviews: ${pending.prior.join(", ")}.` : "",
      pending.request ? `Fix request: ${pending.request}. Describe any new approach in target.approach_change.` : "",
      "Do not edit tracked files or commit.",
      FORBIDDEN,
    ].filter(Boolean).join("\n");
  }
  return [
    `Fix the blocking findings for PR #${state.pr}. The reviewed commit is ${pending.head}.`,
    `Reviews: ${pending.findings.join(", ")}. Fix request: ${pending.request}.`,
    pending.new_agent ? "The ledger asks for a new approach: start fresh, read only the fix request and the reviews, and choose a different approach or a smaller scope." : "",
    `Add exactly one commit on top of ${pending.head}. Do not amend or rebase.`,
    FORBIDDEN,
  ].filter(Boolean).join("\n");
}

function recordCommand(state, pending) {
  const base = `dirf review record --pr ${state.pr}`;
  if (pending.kind === "check") return `${base} --status passed|failed`;
  if (pending.kind === "fix") return `${base} [--status failed]`;
  return base;
}

// The next host action, or the final report when the ladder is done.
export function hostView(state, env = process.env) {
  if (!state.pending) return { schema_version: 1, pr: state.pr, mode: "host", done: true, report: loopReport(state) };
  const pending = state.pending;
  return {
    schema_version: 1,
    pr: state.pr,
    mode: "host",
    done: false,
    action: { ...pending, env: stepEnv(state, pending) },
    brief: stepBrief(state, pending),
    record_with: recordCommand(state, pending),
    // A check is a plain command, not agent work: run it directly.
    hint: pending.kind === "check"
      ? { host: hostHint(env).host, how: "Run the check command in the PR checkout yourself. It needs no agent." }
      : hostHint(env),
    guardrails: { merge_is_not_authorized: true, push_is_not_performed: true },
  };
}

export function formatHostView(view) {
  if (view.done) return formatLoopReport(view.report);
  const { action } = view;
  const title = action.kind === "check" ? `check before ${action.before}` : action.kind === "review" ? `review step ${action.step}` : "fix";
  const lines = [`PR #${view.pr}: next step is ${title} at ${action.head.slice(0, 12)}.`, `How (${view.hint.host}): ${view.hint.how}`, "", "Brief:", view.brief, "", `When it finishes: ${view.record_with}`];
  return lines.join("\n");
}

export function formatLoopReport(report) {
  const lines = [`PR #${report.pr}: ${report.summary}`];
  for (const step of report.steps) {
    if (step.kind === "check") lines.push(`- Check before ${step.before}: ${step.status}.`);
    else if (step.kind === "fix") lines.push(`- Fix: ${step.status}.`);
    else lines.push(`- Review step ${step.step}: ${step.qualified ? "qualified" : step.partial ? "partial (no finding, evidence incomplete)" : `${step.findings} finding(s)`}.`);
  }
  if (report.error) lines.push(`Error: ${report.error}`);
  if (report.reported_findings?.length) lines.push(`Open findings: ${report.reported_findings.map((item) => `${item.id} ${item.title}`).join("; ")}`);
  if (report.limitations?.length) lines.push(`Not verified: ${report.limitations.join("; ")}`);
  if (report.check_output) lines.push("Check output (end):", report.check_output.trimEnd());
  // A rewritten commit was never reviewed; pushing it would need a force-push.
  if (report.head !== report.start_head && report.outcome !== "fixer_rewrote_history") {
    lines.push(`The fixer made commit ${report.head}. Push it before you ask for merge approval.`);
  }
  if (loopPassed(report)) lines.push("Next: run dirf review ready on the current review before you ask to merge.");
  else lines.push("Next: give this result to a person.");
  return lines.join("\n");
}
