import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  registerProject, createAttemptInStore, deriveSlug, storeProjectDir,
  appendObservation, listObservations, promoteObservation, latestAttempt,
} from "../src/state.js";

function freshHome() {
  const home = mkdtempSync(join(tmpdir(), "dirf-notice-"));
  process.env.DIRF_HOME = home;
  return home;
}

function withProject() {
  const home = freshHome();
  const dir = mkdtempSync(join(tmpdir(), "noticerepo-"));
  const { slug } = registerProject(dir);
  return { home, dir, slug };
}

test("appendObservation writes to the explicit attempt's OBSERVATIONS.md", () => {
  const { slug } = withProject();
  createAttemptInStore(slug, "demo", new Date("2026-07-26T10:00:00.000Z"));
  appendObservation(slug, "Sidebar has 23 text-white — not this task", { attemptId: "demo" });
  const file = join(storeProjectDir(slug), "attempts", "20260726T100000000Z-demo", "OBSERVATIONS.md");
  assert.ok(existsSync(file), "OBSERVATIONS.md must exist in the attempt dir");
  const content = readFileSync(file, "utf8");
  assert.match(content, /Sidebar has 23 text-white/);
  assert.match(content, /^\d+\. /m, "entry should be numbered");
});

test("appendObservation is append-only across calls (no clobber)", () => {
  const { slug } = withProject();
  createAttemptInStore(slug, "demo", new Date("2026-07-26T10:00:00.000Z"));
  appendObservation(slug, "first observation", { attemptId: "demo" });
  appendObservation(slug, "second observation", { attemptId: "demo" });
  appendObservation(slug, "third observation", { attemptId: "demo" });
  const entries = listObservations(slug, { attemptId: "demo" });
  assert.equal(entries.length, 3);
  assert.match(entries[0].text, /first observation/);
  assert.match(entries[2].text, /third observation/);
  assert.equal(entries[0].n, 1);
  assert.equal(entries[2].n, 3);
});

test("appendObservation --attempt targets a specific attempt, not the most recent", () => {
  const { slug } = withProject();
  const old = createAttemptInStore(slug, "old", new Date("2026-07-25T10:00:00.000Z"));
  createAttemptInStore(slug, "new", new Date("2026-07-26T10:00:00.000Z"));
  // Target the OLD one explicitly; default would hit 'new'.
  appendObservation(slug, "goes to old", { attemptId: old.id });
  const oldEntries = listObservations(slug, { attemptId: old.id });
  const newEntries = listObservations(slug, { attemptId: "20260726T100000000Z-new" });
  assert.equal(oldEntries.length, 1);
  assert.match(oldEntries[0].text, /goes to old/);
  assert.equal(newEntries.length, 0, "the newer attempt must be untouched");
});

test("explicit observation targets must name an existing attempt", () => {
  const { slug } = withProject();
  createAttemptInStore(slug, "demo", new Date("2026-07-26T10:00:00.000Z"));
  assert.throws(
    () => appendObservation(slug, "must not create orphan state", { attemptId: "../../escaped" }),
    /no DIRF attempt|invalid attempt id/i,
  );
});

test("observation text stays a single append-only record", () => {
  const { slug } = withProject();
  createAttemptInStore(slug, "demo", new Date("2026-07-26T10:00:00.000Z"));
  appendObservation(slug, "first line\n2. forged — entry", { attemptId: "demo" });
  const entries = listObservations(slug, { attemptId: "demo" });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].text, "first line 2. forged — entry");
});

test("latestAttempt returns the most recent (newest-last in listAttempts)", () => {
  const { slug } = withProject();
  createAttemptInStore(slug, "old", new Date("2026-07-25T10:00:00.000Z"));
  createAttemptInStore(slug, "newer", new Date("2026-07-26T10:00:00.000Z"));
  const cur = latestAttempt(slug);
  assert.ok(cur, "latestAttempt must resolve when attempts exist");
  assert.equal(cur.id, "20260726T100000000Z-newer");
});

test("latestAttempt returns null when no attempts exist", () => {
  const { slug } = withProject();
  assert.equal(latestAttempt(slug), null);
});

test("appendObservation without an attempt throws a clear error", () => {
  const { slug } = withProject();
  // no attempt created
  assert.throws(() => appendObservation(slug, "nothing to attach to"), /no unique active attempt/i);
});

test("appendObservation to project-level writes to the project OBSERVATIONS.md", () => {
  const { slug } = withProject();
  appendObservation(slug, "project-level note", { project: true });
  const file = join(storeProjectDir(slug), "OBSERVATIONS.md");
  assert.ok(existsSync(file));
  assert.match(readFileSync(file, "utf8"), /project-level note/);
});

test("listObservations --project reads the project-level file", () => {
  const { slug } = withProject();
  appendObservation(slug, "p1", { project: true });
  appendObservation(slug, "p2", { project: true });
  const entries = listObservations(slug, { project: true });
  assert.equal(entries.length, 2);
});

test("promoteObservation moves entry N from an attempt to the project level", () => {
  const { slug } = withProject();
  const att = createAttemptInStore(slug, "demo", new Date("2026-07-26T10:00:00.000Z"));
  appendObservation(slug, "ephemeral one", { attemptId: "demo" });
  appendObservation(slug, " keeper — this one matters ", { attemptId: "demo" });
  appendObservation(slug, "another ephemeral", { attemptId: "demo" });
  // Promote entry #2 from the attempt to project-level.
  promoteObservation(slug, 2, { attemptId: att.id });
  // Attempt still has all 3 (promote copies, doesn't delete — non-destructive).
  const attemptEntries = listObservations(slug, { attemptId: att.id });
  assert.equal(attemptEntries.length, 3, "promote copies; source attempt keeps its log");
  // Project now has the promoted text.
  const projectEntries = listObservations(slug, { project: true });
  assert.equal(projectEntries.length, 1);
  assert.match(projectEntries[0].text, /this one matters/);
});
