import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CLI = join(process.cwd(), "src", "cli.js");
const NOW = "2026-08-10T12:00:00.000Z";

function run(args) {
  return spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", timeout: 30_000 });
}

function writeJson(root, name, value) {
  const path = join(root, name);
  writeFileSync(path, JSON.stringify(value));
  return path;
}

test("govern digest and evaluate expose deterministic JSON decisions", () => {
  const root = mkdtempSync(join(tmpdir(), "dirf-govern-"));
  const request = writeJson(root, "request.json", {
    id: "request-1",
    organizationId: "org-1",
    actor: { id: "agent-1", type: "agent", organizationId: "org-1" },
    action: { kind: "inspect", operation: "read status", target: { id: "repo" } },
  });

  const digest = run(["govern", "digest", request]);
  assert.equal(digest.status, 0, digest.stderr);
  assert.match(JSON.parse(digest.stdout).actionDigest, /^sha256:[0-9a-f]{64}$/);

  const evaluated = run(["govern", "evaluate", request, "--now", NOW]);
  assert.equal(evaluated.status, 0, evaluated.stderr);
  assert.equal(JSON.parse(evaluated.stdout).decision, "allow");
});

test("govern evaluate has machine-readable approval and deny exit codes", () => {
  const root = mkdtempSync(join(tmpdir(), "dirf-govern-"));
  const hash = `sha256:${"a".repeat(64)}`;
  const approvalRequired = writeJson(root, "approval-required.json", {
    id: "request-2",
    organizationId: "org-1",
    actor: { id: "agent-1", type: "agent", organizationId: "org-1" },
    action: {
      kind: "external_send",
      operation: "send report",
      target: { id: "recipient@example.invalid", organizationId: "org-1" },
      payloadDigest: hash,
    },
    mandate: {
      id: "mandate-1",
      grantedBy: "gary",
      issuedAt: "2026-08-10T10:00:00.000Z",
      expiresAt: "2026-08-11T10:00:00.000Z",
      scope: { organizationId: "org-1", actionKinds: ["external_send"], targets: ["recipient@example.invalid"] },
    },
    evidence: [
      { id: "scope", type: "scope", organizationId: "org-1", digest: hash },
      { id: "verification", type: "verification", organizationId: "org-1", digest: hash },
    ],
  });
  const pending = run(["govern", "evaluate", approvalRequired, "--now", NOW]);
  assert.equal(pending.status, 3, pending.stderr);
  assert.equal(JSON.parse(pending.stdout).decision, "require_approval");

  const deniedRequest = writeJson(root, "denied.json", {
    id: "request-3",
    organizationId: "org-1",
    actor: { id: "agent-1", type: "agent" },
    action: { kind: "unknown", operation: "unknown", target: { id: "x" } },
  });
  const denied = run(["govern", "evaluate", deniedRequest, "--now", NOW]);
  assert.equal(denied.status, 4, denied.stderr);
  assert.equal(JSON.parse(denied.stdout).decision, "deny");
});

test("govern append and verify expose the tamper-evident ledger contract", () => {
  const root = mkdtempSync(join(tmpdir(), "dirf-govern-"));
  const event = writeJson(root, "event.json", { type: "decision", requestId: "request-1", decision: "allow" });
  const appended = run(["govern", "append", event, "--now", NOW]);
  assert.equal(appended.status, 0, appended.stderr);
  const ledger = JSON.parse(appended.stdout);
  const ledgerPath = writeJson(root, "ledger.json", ledger);

  const valid = run(["govern", "verify", ledgerPath]);
  assert.equal(valid.status, 0, valid.stderr);
  assert.equal(JSON.parse(valid.stdout).valid, true);

  ledger[0].event.decision = "deny";
  const tamperedPath = writeJson(root, "tampered.json", ledger);
  const tampered = run(["govern", "verify", tamperedPath]);
  assert.equal(tampered.status, 1, tampered.stderr);
  assert.equal(JSON.parse(tampered.stdout).valid, false);
});
