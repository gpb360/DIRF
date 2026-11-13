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

/**
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
  const { pr, reviewer, fixer, check, outDir } = options;
  if (!Number.isInteger(pr) || pr < 1) throw new Error("dirf review loop requires --pr with a pull-request number");
  if (!reviewer || !fixer) throw new Error("dirf review loop requires --reviewer and --fixer commands");
  mkdirSync(outDir, { recursive: true });

  const steps = [];
  const reviews = [];
  let head = String(deps.head()).toLowerCase();
  const startHead = head;

  const checkGate = (before) => {
    if (!check) return;
    const result = deps.run(check, { DIRF_REVIEW_PR: String(pr), DIRF_REVIEW_HEAD: head });
    steps.push({ kind: "check", before, head, status: result.status === 0 ? "passed" : "failed" });
    if (result.status !== 0) throw new LoopStop("check_failed", { check_output: result.output });
  };

  const review = (step, prior = [], requestPath = "") => {
    const path = join(outDir, `${head.slice(0, 12)}-step${step}.json`);
    rmSync(path, { force: true });
    const result = deps.run(reviewer, {
      DIRF_REVIEW_OUTPUT: path,
      DIRF_REVIEW_PR: String(pr),
      DIRF_REVIEW_HEAD: head,
      DIRF_REVIEW_STEP: String(step),
      DIRF_REVIEW_PRIOR: prior.join(delimiter),
      DIRF_REVIEW_REQUEST: requestPath,
    });
    if (result.status !== 0) throw new LoopStop("error", { error: `The reviewer command exited with status ${result.status} at step ${step}.`, output: result.output });
    if (!existsSync(path)) throw new LoopStop("error", { error: `The reviewer command wrote no review at step ${step}. It must write review JSON to DIRF_REVIEW_OUTPUT.` });
    let artifact;
    try {
      artifact = JSON.parse(readFileSync(path, "utf8"));
      validateReview(artifact);
    } catch (error) {
      throw new LoopStop("error", { error: `The review from step ${step} is not valid: ${error.message}` });
    }
    if (artifact.target.pr_number !== pr) throw new LoopStop("error", { error: `The review from step ${step} names PR #${artifact.target.pr_number}, not PR #${pr}.` });
    if (String(artifact.target.head_sha).toLowerCase() !== head) throw new LoopStop("error", { error: `The review from step ${step} names commit ${artifact.target.head_sha}, not the checkout commit ${head}.` });
    const action = deps.trigger(artifact);
    const entry = { step, path, head, qualified: isQualified(artifact), findings: blockingFindings(artifact).length, action: action.action };
    if (!entry.qualified && entry.findings === 0) entry.partial = true;
    steps.push({ kind: "review", ...entry });
    reviews.push({ ...entry, review: artifact, request: action });
    if (action.action === "stop_for_person") throw new LoopStop("stop_for_person", { findings: action.findings });
    return reviews.at(-1);
  };

  const finish = (outcome, detail = {}) => ({
    schema_version: 1,
    pr,
    outcome,
    summary: LOOP_OUTCOMES[outcome],
    start_head: startHead,
    head,
    steps,
    reviews: reviews.map(({ step, path, qualified, findings, partial }) => ({ step, path, qualified, findings, ...(partial ? { partial } : {}) })),
    ...detail,
    guardrails: { merge_is_not_authorized: true, push_is_not_performed: true },
  });

  try {
    if (recordedCommitQualified(deps.recorded(pr, head) || [])) return finish("already_qualified");

    checkGate("step 1");
    const first = review(1);
    if (first.qualified) return finish("qualified");

    const second = review(2);
    const third = review(3);
    const sameCommit = [first, second, third];
    const qualified = sameCommit.filter((item) => item.qualified);
    if (qualified.length >= 2) {
      const open = sameCommit.find((item) => !item.qualified);
      return finish("qualified", { reported_findings: blockingFindings(open.review) });
    }

    // Only a review with a blocking finding gives the fixer work. When no
    // review found one, the open reviews are partial and a person decides.
    const fixSource = sameCommit.find((item) => !item.qualified && item.findings > 0);
    if (!fixSource) return finish("partial", { limitations: sameCommit.flatMap((item) => item.review.limitations) });
    const request = fixSource.request;
    const requestPath = join(outDir, `${head.slice(0, 12)}-fix-request.json`);
    writeFileSync(requestPath, JSON.stringify(request, null, 2) + "\n");
    const reviewPaths = sameCommit.map((item) => item.path);
    const fix = deps.run(fixer, {
      DIRF_REVIEW_PR: String(pr),
      DIRF_REVIEW_HEAD: head,
      DIRF_REVIEW_FINDINGS: reviewPaths.join(delimiter),
      DIRF_REVIEW_REQUEST: requestPath,
      // "1" when the ledger asks for a new approach: run the fix in a new agent session.
      DIRF_REVIEW_NEW_AGENT: request.new_agent?.required ? "1" : "",
    });
    steps.push({ kind: "fix", head, status: fix.status === 0 ? "passed" : "failed" });
    if (fix.status !== 0) return finish("fixer_failed", { output: fix.output });
    const fixedHead = String(deps.head()).toLowerCase();
    if (fixedHead === head) return finish("fixer_made_no_commit");
    if (!deps.descends(head, fixedHead)) {
      head = fixedHead;
      return finish("fixer_rewrote_history");
    }
    head = fixedHead;

    checkGate("step 4");
    const last = review(4, reviewPaths, requestPath);
    try {
      verifyUpdatedReview(request, last.review);
    } catch (error) {
      throw new LoopStop("error", { error: `The review of the fix does not match the original PR: ${error.message}` });
    }
    if (last.qualified) return finish("qualified_after_fix");
    return finish("needs_new_examination", { reported_findings: blockingFindings(last.review) });
  } catch (error) {
    if (error instanceof LoopStop) return finish(error.outcome, error.detail);
    return finish("error", { error: error.message });
  }
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
