import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const KEBAB = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

function names(directory, type) {
  return readdirSync(join(ROOT, directory), { withFileTypes: true })
    .filter((entry) => type === "file" ? entry.isFile() : entry.isDirectory())
    .map((entry) => entry.name);
}

test("repository names follow the documented conventions", () => {
  for (const file of names("src", "file")) assert.match(file, /^[a-z][a-z0-9-]*(?:\.js|\.d\.ts)$/);
  for (const file of names("tests", "file")) assert.match(file, /^[a-z][a-z0-9-]*\.test\.js$/);
  for (const file of names("scripts", "file")) assert.match(file, /^[a-z][a-z0-9-]*\.js$/);
  for (const file of names("agents", "file")) assert.match(file, /^[a-z][a-z0-9-]*\.md$/);
  for (const root of ["playbooks", "skills", "tools", "workflows"]) {
    for (const directory of names(root, "directory")) assert.match(directory, KEBAB);
  }
});
