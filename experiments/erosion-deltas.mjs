// @ts-check
// Read-only code-erosion report: the single approved experiment from DIRF
// learn attempt 20261031T200709157Z-slop-code-bench-docs (recommendation
// learning-recommendation).
//
// Over the last N commits touching a path, reports per file the line-count
// delta and churn ratio SlopCodeBench tracks between checkpoints. It runs git
// read-only, has zero dependencies, and never touches DIRF state. Values are
// for comparison between runs only, never a gate: growth from new features is
// not erosion by itself.
//
// Pattern source: SprocketLab/slop-code-bench docs/metrics/interpreting-results.md
// ("Delta Metrics": delta.loc, delta.churn_ratio = (added + removed) / prev_total).

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/**
 * Parses `git log --reverse --no-renames --numstat --format=@%H` output.
 * Binary files (numstat "-") are skipped.
 * @param {string} text
 * @returns {{ sha: string, files: Record<string, { added: number, removed: number }> }[]}
 */
export function parseNumstat(text) {
  /** @type {{ sha: string, files: Record<string, { added: number, removed: number }> }[]} */
  const commits = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("@")) commits.push({ sha: line.slice(1), files: {} });
    else if (line.trim() && commits.length) {
      const [added, removed, ...rest] = line.split("\t");
      if (added === "-" || removed === "-") continue;
      commits[commits.length - 1].files[rest.join("\t")] = { added: Number(added), removed: Number(removed) };
    }
  }
  return commits;
}

/** Percentage change; Infinity when growing from zero, as the source reports `inf`. */
function percentChange(prev, curr) {
  if (prev === 0) return curr === 0 ? 0 : Infinity;
  return ((curr - prev) / prev) * 100;
}

/**
 * Aggregates per-file deltas across the window of commits.
 * @param {ReturnType<typeof parseNumstat>} commits oldest first
 * @param {Record<string, number>} baseline line counts before the first commit
 * @returns {{ file: string, commits: number, added: number, removed: number, prev_total: number, total: number, delta_loc_pct: number, churn_ratio: number, add_remove_ratio: number }[]}
 *   sorted by churn_ratio, highest first
 */
export function computeDeltas(commits, baseline) {
  /** @type {Map<string, { commits: number, added: number, removed: number }>} */
  const byFile = new Map();
  for (const commit of commits) {
    for (const [file, { added, removed }] of Object.entries(commit.files)) {
      const row = byFile.get(file) || { commits: 0, added: 0, removed: 0 };
      row.commits += 1;
      row.added += added;
      row.removed += removed;
      byFile.set(file, row);
    }
  }
  return [...byFile].map(([file, row]) => {
    const prev = baseline[file] || 0;
    const total = prev + row.added - row.removed;
    const changed = row.added + row.removed;
    return {
      file,
      ...row,
      prev_total: prev,
      total,
      delta_loc_pct: percentChange(prev, total),
      churn_ratio: prev === 0 ? (changed === 0 ? 0 : Infinity) : changed / prev,
      add_remove_ratio: row.removed === 0 ? (row.added === 0 ? 0 : Infinity) : row.added / row.removed,
    };
  }).sort((a, b) => b.churn_ratio - a.churn_ratio || a.file.localeCompare(b.file));
}

/** Counts lines the way numstat does: a final line without a newline still counts. */
function countLines(content) {
  if (!content) return 0;
  return content.split("\n").length - (content.endsWith("\n") ? 1 : 0);
}

/**
 * Reads the window from a git repository and computes deltas.
 * @param {{ repo?: string, path?: string, commits?: number }} options
 */
export function erosionReport({ repo = process.cwd(), path = "src", commits = 20 } = {}) {
  const git = (/** @type {string[]} */ args) => execFileSync("git", args, { cwd: repo, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
  const shas = git(["log", `-${commits}`, "--format=%H", "--", path]).split(/\r?\n/).filter(Boolean);
  if (!shas.length) return { path, commits: 0, base: null, files: [] };
  const oldest = shas[shas.length - 1];
  const window = parseNumstat(git(["log", "--reverse", "--no-renames", "--numstat", "--format=@%H", `-${commits}`, "--", path]));
  const hasParent = git(["rev-list", "--parents", "-n", "1", oldest]).trim().split(" ").length > 1;
  /** @type {Record<string, number>} */
  const baseline = {};
  if (hasParent) {
    for (const file of new Set(window.flatMap((commit) => Object.keys(commit.files)))) {
      try {
        baseline[file] = countLines(git(["show", `${oldest}^:${file}`]));
      } catch {
        baseline[file] = 0; // file did not exist before the window
      }
    }
  }
  return { path, commits: window.length, base: hasParent ? `${oldest}^` : null, files: computeDeltas(window, baseline) };
}

const fmt = (value, digits = 1) => (value === Infinity ? "inf" : value.toFixed(digits));

function main(argv) {
  const flag = (name) => {
    const index = argv.indexOf(name);
    return index === -1 ? undefined : argv[index + 1];
  };
  const report = erosionReport({
    repo: flag("--repo"),
    path: flag("--path"),
    commits: flag("--commits") ? Number(flag("--commits")) : undefined,
  });
  if (argv.includes("--json")) {
    console.log(JSON.stringify(report, (_, value) => (value === Infinity ? "inf" : value), 2));
    return;
  }
  console.log(`Erosion deltas for ${report.path} over ${report.commits} commits (relative signal, not a gate)`);
  console.log("file\tcommits\t+added\t-removed\tprev\ttotal\tdelta_loc%\tchurn\tadd:remove");
  for (const row of report.files) {
    console.log([row.file, row.commits, row.added, row.removed, row.prev_total, row.total,
      fmt(row.delta_loc_pct), fmt(row.churn_ratio, 2), fmt(row.add_remove_ratio, 2)].join("\t"));
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main(process.argv.slice(2));
