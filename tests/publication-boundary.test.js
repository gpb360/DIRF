import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { validatePublicationBoundary } from "../src/publication-boundary.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "dirf-publication-boundary-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function write(root, relativePath, content = "fixture\n") {
  const target = join(root, relativePath);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
}

test("the current repository satisfies the publication boundary", () => {
  assert.deepEqual(validatePublicationBoundary(ROOT), []);
});

test("private names, retired identity, and local user paths are rejected", (t) => {
  const root = fixture(t);
  const privateProject = ["Story", "tellers"].join("");
  const retiredIdentity = ["Agent", "Spec", "Kit"].join(" ");
  const userProfile = ["C:", "Users", "operator", "project"].join("\\");
  write(root, "README.md", `${privateProject}\n${retiredIdentity}\n${userProfile}\n`);

  const errors = validatePublicationBoundary(root).join("\n");
  assert.match(errors, /private project name/);
  assert.match(errors, /retired product identity/);
  assert.match(errors, /local user-profile path/);
});

test("the compatibility package identifier is restricted to package metadata and the changelog", (t) => {
  const root = fixture(t);
  const compatibilityName = ["a", "mf", "-", "dirf"].join("");
  write(root, "package.json", JSON.stringify({ name: compatibilityName }));
  write(root, "package-lock.json", JSON.stringify({ name: compatibilityName }));
  write(root, "CHANGELOG.md", `Compatibility package: ${compatibilityName}\n`);
  assert.deepEqual(validatePublicationBoundary(root), []);

  write(root, "README.md", `Install ${compatibilityName}\n`);
  assert.match(validatePublicationBoundary(root).join("\n"), /legacy package identifier outside its compatibility surfaces/);
});

test("private working-artifact paths and machine inventories are rejected", (t) => {
  const root = fixture(t);
  write(root, ".gsd/workflows/private.yaml");
  write(root, "docs/research/report.md");
  write(root, "HANDOFF.md");
  write(root, "workspace-inventory.json", "{}\n");

  const errors = validatePublicationBoundary(root).join("\n");
  // Deliberately public classes (workflow definitions, research/marketing
  // docs) are allowed; root handoffs, canonical state, attempts, and
  // machine-derived inventories stay denied.
  assert.doesNotMatch(errors, /\.gsd\/workflows\/private\.yaml/);
  assert.doesNotMatch(errors, /docs\/research\/report\.md/);
  assert.match(errors, /HANDOFF\.md: private handoff/);
  assert.match(errors, /workspace-inventory\.json: machine-derived inventory/);
});

test("ignored local state is excluded from the publishable checkout surface", (t) => {
  const root = fixture(t);
  const privateProject = ["Story", "tellers"].join("");
  execFileSync("git", ["init", "-q"], { cwd: root });
  write(root, ".gitignore", ".dirf/\n");
  write(root, ".dirf/HANDOFF.md", `${privateProject}\n`);
  write(root, "README.md", "# DIRF\n");

  assert.deepEqual(validatePublicationBoundary(root), []);
});

test("tracked files deleted from the current tree are not treated as publishable", (t) => {
  const root = fixture(t);
  const privateProject = ["Story", "tellers"].join("");
  execFileSync("git", ["init", "-q"], { cwd: root });
  write(root, "removed.md", `${privateProject}\n`);
  execFileSync("git", ["add", "removed.md"], { cwd: root });
  unlinkSync(join(root, "removed.md"));

  assert.deepEqual(validatePublicationBoundary(root), []);
});

test("extensionless scripts and hooks are inspected as text", (t) => {
  const root = fixture(t);
  const privateProject = ["Story", "tellers"].join("");
  for (const file of ["runner", ".githooks/pre-commit", "nested/script"]) write(root, file, `#!/bin/sh\n# ${privateProject}\n`);
  assert.equal(validatePublicationBoundary(root).length, 3);
});

test("environment and host credentials are blocked while sanitized examples remain usable", (t) => {
  const root = fixture(t);
  for (const file of [".env", "nested/.env.production", ".env.example.local", ".npmrc", ".codex/auth.json"]) write(root, file);
  for (const file of [".env.example", "nested/.env.production.template", ".env.sample"]) write(root, file, "SETTING=replace-me\n");
  const errors = validatePublicationBoundary(root);
  assert.equal(errors.length, 5);
  assert.ok(errors.some((error) => error.includes("private environment file")));
  assert.ok(errors.some((error) => error.includes("private host configuration")));
});

test("package manifests are checked even for files ignored by git", (t) => {
  const root = fixture(t);
  execFileSync("git", ["init", "-q"], { cwd: root });
  write(root, ".gitignore", ".env\n");
  write(root, ".env");
  assert.deepEqual(validatePublicationBoundary(root), []);
  assert.match(validatePublicationBoundary(root, [".env"]).join("\n"), /private environment file/);
});

test("secret patterns are checked independently of product names, including examples", (t) => {
  const root = fixture(t);
  write(root, ".env.example", "TOKEN=" + "ghp_" + "a".repeat(36));
  write(root, "key", ["-----BEGIN ", "PRIVATE KEY-----"].join(""));
  write(root, "config", "AKIA" + "A".repeat(16));
  const errors = validatePublicationBoundary(root).join("\n");
  assert.match(errors, /GitHub token/);
  assert.match(errors, /private key material/);
  assert.match(errors, /AWS access key identifier/);
  assert.doesNotMatch(errors, /ghp_|AKIA|BEGIN/);
});
