// Offline experiment only. Not called by the DIRF CLI or renderer.
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildInstructions } from "../src/renderer.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OPENING = "Open the target repository in your current host. Load this README.md as the operating workflow and execute the task.\nFollow the phases in order, act as one role at a time, and load only that role's detail. Read policy.md before editing. State an access blocker instead of guessing about unavailable files.";
const SHORT_OPENING = "Open the target repository. Follow this README.md's phases in order, one role at a time. Load only that role's detail. Read policy.md before editing. Report unavailable files; do not guess.";

function openingPosition(original) {
  const marker = "\n## Next step\n";
  const index = original.indexOf(marker);
  if (index < 0 || original.indexOf(marker, index + marker.length) !== -1) return -1;
  const start = index + marker.length;
  return original.slice(start, start + OPENING.length + 2) === OPENING + "\n\n" ? start : -1;
}

export function shortenAssignment(original) {
  const start = openingPosition(original);
  // Unknown or ambiguous layouts stay untouched. This is not a general compressor.
  return start < 0 ? original : original.slice(0, start) + SHORT_OPENING + original.slice(start + OPENING.length);
}

export function assessAssignment(original, candidate, constraints) {
  if (!Array.isArray(constraints) || !constraints.length || constraints.some((text) => typeof text !== "string" || !text.trim())) {
    throw new Error("Declare at least one nonempty exact constraint before comparing assignments");
  }
  const failures = [];
  const start = openingPosition(original);
  const unchanged = candidate === original;
  const approvedEdit = start >= 0 && candidate === original.slice(0, start) + SHORT_OPENING + original.slice(start + OPENING.length);
  if (!unchanged && !approvedEdit) failures.push("content outside the approved opening changed");
  for (const constraint of constraints) {
    if (!original.includes(constraint)) failures.push(`baseline missing constraint: ${constraint}`);
    if (!candidate.includes(constraint)) failures.push(`candidate missing constraint: ${constraint}`);
  }
  const baseline_bytes = Buffer.byteLength(original, "utf8");
  const candidate_bytes = Buffer.byteLength(candidate, "utf8");
  const saved_bytes = baseline_bytes - candidate_bytes;
  const digest = (text) => createHash("sha256").update(text, "utf8").digest("hex");
  return {
    baseline_bytes, candidate_bytes, saved_bytes,
    baseline_sha256: digest(original), candidate_sha256: digest(candidate),
    preservation_pass: failures.length === 0,
    benefit_pass: failures.length === 0 && saved_bytes > 0,
    failures,
    // Keep the complete pair, not just counters; callers can review or restore it.
    original, candidate,
  };
}

export function runExperiment() {
  const fixtures = JSON.parse(readFileSync(join(ROOT, "tests/fixtures/assignment-experiment.json"), "utf8"));
  const scratch = join(ROOT, ".scratch");
  mkdirSync(scratch, { recursive: true });
  const directory = mkdtempSync(join(scratch, "assignment-experiment-"));
  try {
    const cases = fixtures.map((fixture, index) => {
      const workflow = {
        schema_version: 5, name: fixture.id, task: fixture.task, playbook: "offline-experiment",
        repository: { name: "local-fixture", remote: "https://example.test/local/fixture.git" },
        workflow: {
          phases: fixture.phases || ["understand", "build", "verify"],
          output: fixture.output, requirements: fixture.requirements,
          gates: fixture.gates || {}, validation: "Record actual execution evidence, not selected metadata.",
          recovery: "Stop and report the blocker; do not guess or expand the task.",
        },
        agents: [], questions: fixture.questions || [],
        repository_context: ["AGENTS.md"],
        skill_flow: { steps: [], gaps: [], branches: [] },
        policy: "policies/workflow-policy.md",
      };
      const output = join(directory, String(index));
      const files = buildInstructions(workflow, output);
      const original = readFileSync(join(output, "README.md"), "utf8");
      const candidate = shortenAssignment(original);
      const assessment = assessAssignment(original, candidate, fixture.constraints);
      const generated_files_bytes = files.reduce((sum, file) => sum + readFileSync(file).length, 0);
      return { id: fixture.id, ...assessment, generated_files_bytes, candidate_files_bytes: generated_files_bytes - assessment.saved_bytes };
    });
    return {
      measurement: "UTF-8 bytes, not tokens, cost, or model understanding",
      scope: "One startup paragraph only. DIRF defaults and canonical artifacts are unchanged.",
      cases,
      benefit_pass: cases.length > 0 && cases.every((entry) => entry.benefit_pass),
      baseline_bytes: cases.reduce((sum, entry) => sum + entry.baseline_bytes, 0),
      candidate_bytes: cases.reduce((sum, entry) => sum + entry.candidate_bytes, 0),
      saved_bytes: cases.reduce((sum, entry) => sum + entry.saved_bytes, 0),
    };
  } finally {
    // Delete only the uniquely created child of this worktree's scratch folder.
    if (dirname(directory) !== scratch || !basename(directory).startsWith("assignment-experiment-")) throw new Error("Unsafe scratch cleanup path");
    rmSync(directory, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.slice(2).some((argument) => argument !== "--summary")) {
    console.error("Usage: node scripts/assignment-experiment.js [--summary]");
    process.exitCode = 2;
  } else {
    const report = runExperiment();
    const output = process.argv.includes("--summary")
      ? { ...report, cases: report.cases.map(({ original, candidate, ...entry }) => entry) }
      : report;
    console.log(JSON.stringify(output, null, 2));
    if (!report.benefit_pass) process.exitCode = 1;
  }
}
