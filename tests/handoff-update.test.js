import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCurrentHandoff, updateProgressSection } from "../src/handoff-update.js";

test("updateProgressSection updates the standard DIRF handoff without retaining stale values", () => {
  const handoff = [
    "# DIRF Handoff", "",
    "## Objective", "", "Ship safely", "",
    "## Current phase", "", "_(not started)_", "",
    "## Completed", "", "- _(none yet)_", "",
    "## Changed files", "", "- _(none yet)_", "",
    "## Exact next action", "", "_(start the first workflow phase)_", "",
  ].join("\n");

  const updated = updateProgressSection(handoff, {
    message: "Published PR 21",
    phase: "verify",
    next: "Review exact head before merge",
    files: ["src/cli.js"],
  });
  const parsed = parseCurrentHandoff(updated);

  assert.equal(parsed.currentPhase, "verify");
  assert.equal(parsed.lastUpdated, null);
  assert.deepEqual(parsed.completedSteps, ["Published PR 21"]);
  assert.deepEqual(parsed.changedFiles, ["src/cli.js"]);
  assert.equal(parsed.nextAction, "Review exact head before merge");
  assert.doesNotMatch(updated, /start the first workflow phase/);
});

test("progress timestamps make newer project work detectable", () => {
  const updated = updateProgressSection("# DIRF Handoff\n", {
    message: "Found a new review issue",
    timestamp: "2026-09-02T01:30:00.000Z",
    next: "Fix the issue and review the updated PR again",
    files: [],
  });

  assert.equal(parseCurrentHandoff(updated).lastUpdated, "2026-09-02T01:30:00.000Z");
});

test("updateProgressSection adds progress sections when the canonical handoff is skeletal", () => {
  const updated = updateProgressSection("# DIRF Handoff\n\n## Objective\n\nWork in progress\n", {
    message: "Published PR 21",
    phase: "verify",
    next: "Review exact head before merge",
    files: [],
  });
  const parsed = parseCurrentHandoff(updated);

  assert.equal(parsed.currentPhase, "verify");
  assert.deepEqual(parsed.completedSteps, ["Published PR 21"]);
  assert.equal(parsed.nextAction, "Review exact head before merge");
});
