// GitHub sync (`dirf sync`).
//
// DIRF state changes only when an agent calls dirf, so work that merges
// without a record-progress call leaves the store behind GitHub. Sync reads
// the board with branch-name links, then reports three kinds of drift:
//   - open attempts whose own PRs merged (close them as shipped),
//   - merged PRs that no attempt records (work DIRF never saw),
//   - a DIRF CLI checkout that is behind origin/main.
// --apply closes only the shipped attempts. Sync never merges, never
// abandons, and never records a gate decision.
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { applyCleanup, boardSnapshot, cleanupPlan, defaultGh, handoffPullRequests } from "./board.js";
import { listAttempts, readAttemptHandoff, readHandoff } from "./state.js";

const DAY_MS = 86_400_000;
const DEFAULT_SINCE_DAYS = 30;
const HINT_GH_TIMEOUT_MS = 5_000;
const LIST_LIMIT = 15;

// The checkout this CLI runs from, compared with its local origin/main ref.
// No fetch: the answer is only as fresh as the last fetch, and costs no network.
export function cliFreshness(repo = join(dirname(fileURLToPath(import.meta.url)), "..")) {
  const git = (...args) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "ignore"] }).trim();
  try {
    const branch = git("rev-parse", "--abbrev-ref", "HEAD");
    let behind = null;
    let ahead = null;
    try {
      behind = Number(git("rev-list", "--count", "HEAD..origin/main"));
      ahead = Number(git("rev-list", "--count", "origin/main..HEAD"));
    } catch { /* no origin/main ref */ }
    return { repo, branch, behind, ahead, stale: Boolean(behind) };
  } catch {
    return null; // an npm install, not a Git checkout
  }
}

// PR numbers DIRF already records anywhere: closures, attempt handoffs, and
// the project handoff. A PR named there is known work, even as context.
function recordedPullRequests(slug) {
  const numbers = new Set();
  const add = (set) => { for (const number of set) numbers.add(number); };
  let attempts = [];
  try { attempts = listAttempts(slug); } catch { attempts = []; }
  for (const attempt of attempts) {
    for (const pr of attempt.closure?.prs || []) numbers.add(Number(pr.number));
    try { add(handoffPullRequests(readAttemptHandoff(slug, attempt.id))); } catch { /* unreadable handoff */ }
  }
  try { add(handoffPullRequests(readHandoff(slug))); } catch { /* no project handoff */ }
  return numbers;
}

export function syncSnapshot(slug, { checkout, gh = defaultGh, now = new Date(), sinceDays = DEFAULT_SINCE_DAYS, requireOrigin = true, mergeBase, cli = cliFreshness() } = {}) {
  const board = boardSnapshot(slug, { checkout, gh, now, requireOrigin, mergeBase, nameLinks: true });
  // Merges need a review and a person; sync leaves them to dirf cleanup.
  const actions = cleanupPlan(board).filter((action) => action.kind !== "merge" && !(action.kind === "close" && action.requires_merge.length));
  // A started attempt can name work after its PR (a hosted migration, a
  // production run). Its merged PR does not prove that work is done, so a
  // person reviews it; only planned attempts, or ones whose next action
  // already says done, close on GitHub evidence alone.
  const byId = new Map(board.attempts.map((attempt) => [attempt.id, attempt]));
  const closesAlone = (action) => {
    const attempt = byId.get(action.attempt);
    return attempt?.status === "planned" || attempt?.next_action_done === true || !attempt?.next_action;
  };
  const closeActions = actions.filter((action) => action.kind === "close");
  const linked = new Set(board.attempts.flatMap((attempt) => attempt.prs.map((pr) => pr.number)));
  const recorded = recordedPullRequests(slug);
  const since = now.getTime() - sinceDays * DAY_MS;
  const untracked = board.merged_prs
    .filter((pr) => !linked.has(pr.number) && !recorded.has(pr.number) && (Date.parse(pr.merged_at || 0) || 0) >= since)
    .sort((a, b) => b.number - a.number);
  return {
    generated_at: now.toISOString(),
    project: board.project,
    github: board.github,
    since_days: sinceDays,
    close: closeActions.filter(closesAlone),
    review: closeActions.filter((action) => !closesAlone(action)).map((action) => ({ ...action, status: byId.get(action.attempt)?.status || null })),
    stale: actions.filter((action) => action.kind === "stale"),
    untracked_merged_prs: untracked,
    unlinked_open_prs: board.unlinked_prs.map((pr) => ({ number: pr.number, title: pr.title, branch: pr.branch })),
    cli,
  };
}

function clip(text, width = 72) {
  const value = String(text || "");
  return value.length > width ? `${value.slice(0, width - 1)}…` : value;
}

function cliLine(cli) {
  if (!cli?.stale) return null;
  return `DIRF CLI: ${cli.repo} is on ${cli.branch}, ${cli.behind} commit(s) behind origin/main. Update it so every session runs current DIRF.`;
}

export function formatSync(snapshot, { apply = false } = {}) {
  const lines = [`DIRF sync — ${snapshot.project?.name || snapshot.project?.slug || "project"}${apply ? "" : " (dry run)"}`];
  if (!snapshot.github.available) lines.push(`GitHub: unavailable (${snapshot.github.reason}); only local drift is listed.`);
  const cli = cliLine(snapshot.cli);
  if (cli) lines.push(cli);
  lines.push("", `Shipped attempts to close: ${snapshot.close.length}`);
  for (const action of snapshot.close) lines.push(`  ${action.name} · PR ${action.prs.map((n) => `#${n}`).join(", ") || "none"}`);
  lines.push("", `PRs merged, but the next action names more work (a person decides): ${snapshot.review.length}`);
  for (const action of snapshot.review) lines.push(`  ${action.name} · PR ${action.prs.map((n) => `#${n}`).join(", ")} · next: ${clip(action.next_action, 70)}`);
  lines.push("", `Merged PRs no attempt records (last ${snapshot.since_days}d): ${snapshot.untracked_merged_prs.length}`);
  for (const pr of snapshot.untracked_merged_prs.slice(0, LIST_LIMIT)) lines.push(`  #${pr.number} ${clip(pr.title)} [${pr.branch}]`);
  if (snapshot.untracked_merged_prs.length > LIST_LIMIT) lines.push(`  … ${snapshot.untracked_merged_prs.length - LIST_LIMIT} more (--json lists all)`);
  lines.push("", `Open PRs no attempt owns: ${snapshot.unlinked_open_prs.length}`);
  for (const pr of snapshot.unlinked_open_prs.slice(0, LIST_LIMIT)) lines.push(`  #${pr.number} ${clip(pr.title)} [${pr.branch}]`);
  lines.push("", `Stale attempts with no merged PR (a person decides): ${snapshot.stale.length}`);
  for (const action of snapshot.stale.slice(0, LIST_LIMIT)) lines.push(`  ${action.name} · idle ${action.idle_days}d`);
  if (snapshot.stale.length > LIST_LIMIT) lines.push(`  … ${snapshot.stale.length - LIST_LIMIT} more`);
  if (!apply) {
    lines.push("");
    lines.push(snapshot.close.length
      ? "Nothing changed. Run dirf sync --apply to close the shipped attempts. Use dirf cleanup --apply for the others and for merges."
      : "Nothing changed. No attempt can close from GitHub evidence.");
    if (snapshot.untracked_merged_prs.length) lines.push("Record untracked work with dirf record-progress, or route new work with dirf build.");
  }
  return lines.join("\n");
}

// Close the shipped attempts. Each close re-reads its PRs from GitHub and
// fails when a PR is no longer merged.
export function applySync(slug, snapshot, { checkout, gh = defaultGh, log = console.log, now = new Date() } = {}) {
  return applyCleanup(slug, snapshot.close, { checkout, gh, yes: true, ask: async () => "", log, now });
}

// One line for dirf state active, or null. Never throws and never prompts:
// a slow or missing gh must not stop a session from starting.
export function syncHint(slug, { checkout, gh = defaultGh, now = new Date(), env = process.env, cli } = {}) {
  if (env.DIRF_SYNC_CHECK === "0") return null;
  try {
    const quickGh = (args, options = {}) => gh(args, { ...options, timeout: HINT_GH_TIMEOUT_MS });
    const snapshot = syncSnapshot(slug, { checkout, gh: quickGh, now, ...(cli !== undefined ? { cli } : {}) });
    const parts = [];
    const shipped = snapshot.close.length + snapshot.review.length;
    if (shipped) parts.push(`${shipped} attempt(s) shipped on GitHub but still open`);
    if (snapshot.untracked_merged_prs.length) parts.push(`${snapshot.untracked_merged_prs.length} merged PR(s) in the last ${snapshot.since_days}d that no attempt records`);
    const cliText = cliLine(snapshot.cli);
    if (!parts.length && !cliText) return null;
    return [parts.length ? `Sync: ${parts.join("; ")}. Run dirf sync before you trust this next action.` : null, cliText].filter(Boolean).join(" ");
  } catch {
    return null;
  }
}
