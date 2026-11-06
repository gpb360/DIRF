import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// End-to-end coverage for --providers: the advisory provider filter over the
// host model catalog. Isolated DIRF_HOME + throwaway target; no canonical
// state is touched.

const CLI = join(resolve(dirname(fileURLToPath(import.meta.url)), ".."), "src", "cli.js");
const TIMEOUT = 30_000;

const CATALOG = {
  models: [
    { name: "claude-haiku", cost_tier: "low", capabilities: ["*"], provider: "anthropic" },
    { name: "gpt-mini", cost_tier: "low", capabilities: ["*"], provider: "openai" },
  ],
};

function makeEnv() {
  const home = mkdtempSync(join(tmpdir(), "dirf-providers-home-"));
  const target = mkdtempSync(join(tmpdir(), "dirf-providers-target-"));
  const catalogPath = join(home, "models.json");
  writeFileSync(catalogPath, JSON.stringify(CATALOG), "utf8");
  return { home, target, catalogPath };
}

function run(args, env, cwd) {
  return execFileSync(process.execPath, [CLI, ...args], {
    cwd, encoding: "utf8", timeout: TIMEOUT, env: { ...process.env, ...env },
  });
}

test("dirf flow --providers restricts advisory picks to the declared set", () => {
  const { home, target, catalogPath } = makeEnv();
  const out = run(["flow", "fix the checkout timeout", "--path", target,
    "--models", catalogPath, "--providers", "anthropic"], { DIRF_HOME: home }, target);
  assert.match(out, /\[model advice — diagnostic preflight\]/);
  assert.match(out, /claude-haiku/);
  assert.doesNotMatch(out, /gpt-mini/);
});

test("dirf flow --providers without --models is a usage error", () => {
  const { home, target } = makeEnv();
  assert.throws(
    () => run(["flow", "fix the checkout timeout", "--path", target,
      "--providers", "anthropic"], { DIRF_HOME: home }, target),
    (error) => /--providers requires --models FILE/.test(String(error.stderr || error.message)),
  );
});

test("providers outside the catalog set still produce advice via fallback", () => {
  const { home, target, catalogPath } = makeEnv();
  const out = run(["flow", "fix the checkout timeout", "--path", target,
    "--models", catalogPath, "--providers", "z.ai"], { DIRF_HOME: home }, target);
  assert.match(out, /fell back to models outside the set/);
  assert.match(out, /claude-haiku|gpt-mini/);
});
