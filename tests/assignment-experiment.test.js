import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { shortenAssignment, assessAssignment, runExperiment } from "../scripts/assignment-experiment.js";

const opening = "Open the target repository in your current host. Load this README.md as the operating workflow and execute the task.\nFollow the phases in order, act as one role at a time, and load only that role's detail. Read policy.md before editing. State an access blocker instead of guessing about unavailable files.";

test("a shorter assignment retains the task and safety instructions", () => {
  const original = `## Objective\nBuild an email preview; do not send email.\n\n## Next step\n${opening}\n\n## Definition of Done\nAn email preview, not a delivery.\n`;
  const candidate = shortenAssignment(original);
  assert.ok(Buffer.byteLength(candidate) < Buffer.byteLength(original), "candidate must be smaller, including all its instructions");
  assert.ok(candidate.includes("Build an email preview; do not send email."));
  assert.ok(candidate.includes("An email preview, not a delivery."));
  assert.ok(candidate.includes("Read policy.md before editing."));
  assert.ok(candidate.includes("do not guess"));
});

test("the offline experiment compares complete generated assignments and retains their original text", () => {
  const report = runExperiment();
  assert.equal(report.cases.length, 6);
  assert.equal(report.benefit_pass, true);
  assert.equal(report.measurement, "UTF-8 bytes, not tokens, cost, or model understanding");
  for (const entry of report.cases) {
    assert.equal(entry.preservation_pass, true);
    assert.equal(entry.benefit_pass, true);
    assert.ok(entry.original.includes("## Definition of Done"));
    assert.ok(entry.original.includes("## Policy"));
    assert.ok(entry.generated_files_bytes > entry.baseline_bytes, "linked policy, kickoff and detail files count towards the complete generated pack");
    assert.equal(entry.candidate_files_bytes, entry.generated_files_bytes - entry.saved_bytes);
    assert.match(entry.baseline_sha256, /^[a-f0-9]{64}$/);
    assert.match(entry.candidate_sha256, /^[a-f0-9]{64}$/);
  }
});

test("the comparison rejects a reversed restriction even when the original words remain elsewhere", () => {
  const original = `## Objective\nDo not send email.\n\n## Next step\n${opening}\n\n## Phases\n1. Draft\n`;
  const candidate = shortenAssignment(original).replace("## Objective\nDo not send email.", "## Objective\nSend email.") + "\nReference: Do not send email.\n";
  const result = assessAssignment(original, candidate, ["Do not send email."]);
  assert.equal(result.preservation_pass, false);
  assert.equal(result.benefit_pass, false);
  assert.ok(result.failures.includes("content outside the approved opening changed"));
});

test("removed objective, approval, command, phase order, or receipt requirements cannot pass", () => {
  const report = runExperiment();
  const defects = [
    ["email-preview", "Build an email preview for the website. Do not send email or add blockchain features.", "Build a crypto website."],
    ["human-approval", "Obtain explicit human approval before any database mutation.", "Apply changes immediately."],
    ["exact-technical-text", "node --test tests/mail.test.js", "node --test tests/other.test.js"],
    ["human-approval", "2. human approval (decision gate)", "2. verify"],
    ["execution-receipts-unicode", "Record the failing TDD check before its passing check.", "Selected TDD is sufficient."],
  ];
  for (const [id, expected, replacement] of defects) {
    const entry = report.cases.find((item) => item.id === id);
    assert.ok(entry.candidate.includes(expected), `control must actually change ${id}`);
    const defective = entry.candidate.replaceAll(expected, replacement);
    assert.equal(assessAssignment(entry.original, defective, [expected]).benefit_pass, false, id);
  }
});

test("unknown or ambiguous layouts are not compressed, and no change is not a benefit", () => {
  for (const original of ["## Objective\nDo not send email.\n", `\n## Next step\n${opening}\n\n## Next step\n${opening}\n\n`]) {
    assert.equal(shortenAssignment(original), original);
    const result = assessAssignment(original, original, [original]);
    assert.equal(result.preservation_pass, true);
    assert.equal(result.benefit_pass, false);
    assert.equal(result.saved_bytes, 0);
  }
});

test("byte accounting and hashes include Unicode, and incomplete constraint declarations fail closed", () => {
  const result = assessAssignment("Zoë", "Zoë", ["Zoë"]);
  assert.equal(result.baseline_bytes, 4);
  assert.equal(result.baseline_sha256, createHash("sha256").update("Zoë").digest("hex"));
  assert.equal(assessAssignment("Zoë", "Zoë", ["missing"]).preservation_pass, false);
  for (const constraints of [[], [""], [" "], null, [12]]) assert.throws(() => assessAssignment("Zoë", "Zoë", constraints), /Declare/);
});

test("the executable reports real generator results and rejects unsupported flags", () => {
  const command = fileURLToPath(new URL("../scripts/assignment-experiment.js", import.meta.url));
  const options = { encoding: "utf8", windowsHide: true, timeout: 30_000 };
  const result = spawnSync(process.execPath, [command, "--summary"], options);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.cases.length, 6);
  assert.equal(report.benefit_pass, true);
  assert.equal("original" in report.cases[0], false);
  const full = spawnSync(process.execPath, [command], options);
  assert.equal(full.status, 0, full.stderr);
  assert.ok(JSON.parse(full.stdout).cases.every((entry) => typeof entry.original === "string" && typeof entry.candidate === "string"));
  const invalid = spawnSync(process.execPath, [command, "--enable"], options);
  assert.equal(invalid.status, 2);
  assert.match(invalid.stderr, /Usage:/);
});
