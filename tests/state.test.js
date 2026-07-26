import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listProjects, storeHome } from "../src/state.js";

function freshHome() {
  const home = mkdtempSync(join(tmpdir(), "dirf-state-"));
  process.env.DIRF_HOME = home;
  return home;
}

test("storeHome honors DIRF_HOME override", () => {
  const home = freshHome();
  assert.equal(storeHome(), home);
});

test("listProjects returns empty array when no registry exists", () => {
  freshHome();
  assert.deepEqual(listProjects(), []);
});

test("listProjects reads an existing registry without mutating it", async () => {
  const home = freshHome();
  const { writeFileSync } = await import("node:fs");
  const reg = { schema_version: 1, projects: {} };
  writeFileSync(join(home, "projects.json"), JSON.stringify(reg));
  assert.deepEqual(listProjects(), []);
});
