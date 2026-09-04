import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  bindExecutionAuthority,
  claimAttemptCheckout,
  createAttemptInStore,
  observeAttempt as observeAttemptState,
  projectWorkSnapshot,
  registerProject,
  syncAttemptFromHandoff,
  updateAttemptLifecycle,
  writeHandoff,
} from "../src/state.js";

const CLI = new URL("../src/cli.js", import.meta.url).pathname.replace(/^\/(.:\/)/, "$1");
const AUTHORITY_TOKEN = "test-orchestrator-capability-token-0001";

function observeAttempt(slug, idOrName, options, now) {
  return observeAttemptState(slug, idOrName, { authorityToken: AUTHORITY_TOKEN, ...options }, now);
}

function fixture({ bindAuthority = true } = {}) {
  process.env.DIRF_HOME = mkdtempSync(join(tmpdir(), "dirf-live-work-home-"));
  const root = mkdtempSync(join(tmpdir(), "dirf-live-work-repo-"));
  execFileSync("git", ["init", "-q"], { cwd: root });
  writeFileSync(join(root, "README.md"), "# test\n");
  execFileSync("git", ["add", "."], { cwd: root });
  execFileSync("git", ["commit", "-q", "-m", "init"], {
    cwd: root,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "test",
      GIT_AUTHOR_EMAIL: "test@example.com",
      GIT_COMMITTER_NAME: "test",
      GIT_COMMITTER_EMAIL: "test@example.com",
    },
  });
  const { slug } = registerProject(root);
  if (bindAuthority) bindExecutionAuthority(slug, AUTHORITY_TOKEN);
  return { root, slug };
}

function trackedAttempt(slug, name, now, handoff) {
  const attempt = createAttemptInStore(slug, name, now);
  writeFileSync(join(attempt.folder, "workflow.json"), JSON.stringify({ workflow: { phases: ["work"] } }));
  writeFileSync(join(attempt.folder, "HANDOFF.md"), handoff);
  return updateAttemptLifecycle(slug, attempt.id, "start", {}, now);
}

function runCliAsync(args, { cwd, env }) {
  return new Promise((resolve) => {
    execFile(process.execPath, [CLI, ...args], { cwd, env }, (error, stdout, stderr) => {
      resolve({ code: error?.code || 0, stdout, stderr });
    });
  });
}

test("project work snapshot shows every attempt and only fresh observed work as active", () => {
  const now = new Date("2026-09-03T14:00:00.000Z");
  const { root, slug } = fixture();
  const active = trackedAttempt(slug, "active task", now, "## Exact next action\n\nContinue the active task.\n");
  const completed = trackedAttempt(slug, "completed task", now, "## Status: Complete\n");
  updateAttemptLifecycle(slug, completed.id, "complete", { confirm: true }, now);

  observeAttempt(slug, active.id, {
    harness: "codex",
    sessionId: "thread-123",
    status: "active",
    worktreePath: root,
  }, now);

  const snapshot = projectWorkSnapshot(slug, now);
  assert.equal(snapshot.attempts.length, 2);
  assert.deepEqual(snapshot.summary, { total: 2, active: 1, completed: 1 });
  assert.deepEqual(
    snapshot.attempts.map(({ name, live_state }) => [name, live_state]),
    [["active task", "active"], ["completed task", "completed"]],
  );
  assert.deepEqual(snapshot.attempts[0].execution, {
    harness: "codex",
    session_id: "thread-123",
    status: "active",
    observed_at: now.toISOString(),
    branch: execFileSync("git", ["branch", "--show-current"], { cwd: root, encoding: "utf8" }).trim(),
    fresh: true,
    children: [],
  });
  assert.equal(snapshot.attempts[0].worktree_path.replaceAll("\\", "/").toLowerCase(), root.replaceAll("\\", "/").toLowerCase());
  assert.equal(snapshot.attempts[0].next_action, "Continue the active task.");
  assert.match(snapshot.attempts[0].handoff_path, /HANDOFF\.md$/);
});

test("harness adapters can observe an attempt and read the reconciled project view through the CLI", () => {
  const now = new Date();
  const { root, slug } = fixture();
  const attempt = trackedAttempt(slug, "adapter task", now, "## Exact next action\n\nContinue through the adapter.\n");
  const executionFile = join(root, "execution.json");
  writeFileSync(executionFile, JSON.stringify({
    children: [{ session_id: "child-1", assignment: "Check the adapter", status: "completed", result: "Adapter checked." }],
  }));
  const env = {
    ...process.env,
    DIRF_HOME: process.env.DIRF_HOME,
    DIRF_HARNESS: "codex",
    DIRF_ORCHESTRATOR_TOKEN: AUTHORITY_TOKEN,
    DIRF_SESSION_ID: "thread-456",
  };

  execFileSync(process.execPath, [
    CLI, "attempt", "observe", attempt.id,
    "--execution-status", "active",
    "--worktree", root,
    "--file", executionFile,
  ], { cwd: root, env });

  const snapshot = JSON.parse(execFileSync(process.execPath, [CLI, "project", "status", "--json"], {
    cwd: root,
    env,
    encoding: "utf8",
  }));
  assert.equal(snapshot.attempts[0].live_state, "active");
  assert.equal(snapshot.attempts[0].execution.session_id, "thread-456");
  assert.equal(snapshot.attempts[0].execution.children[0].result, "Adapter checked.");
  assert.equal(snapshot.attempts[0].next_action, "Continue through the adapter.");

  const text = execFileSync(process.execPath, [CLI, "project", "status"], { cwd: root, env, encoding: "utf8" });
  assert.match(text, /active: 1/);
  assert.match(text, /adapter task/);
  assert.match(text, /codex:thread-456/);
  assert.match(text, /handoff: .*HANDOFF\.md/);
});

test("state active records the current Codex thread through the generic execution contract", () => {
  const now = new Date();
  const { root, slug } = fixture();
  const attempt = trackedAttempt(slug, "codex task", now, "## Exact next action\n\nContinue in Codex.\n");
  claimAttemptCheckout(slug, attempt.id, root, now);
  const env = {
    ...process.env,
    DIRF_HOME: process.env.DIRF_HOME,
    CODEX_THREAD_ID: "codex-thread-789",
    DIRF_ORCHESTRATOR_TOKEN: AUTHORITY_TOKEN,
  };

  execFileSync(process.execPath, [CLI, "state", "active", "--json"], { cwd: root, env });
  const snapshot = projectWorkSnapshot(slug, new Date());
  assert.equal(snapshot.attempts[0].live_state, "active");
  assert.deepEqual(snapshot.attempts[0].execution, {
    harness: "codex",
    session_id: "codex-thread-789",
    status: "active",
    observed_at: snapshot.attempts[0].execution.observed_at,
    branch: execFileSync("git", ["branch", "--show-current"], { cwd: root, encoding: "utf8" }).trim(),
    fresh: true,
    children: [],
  });
});

test("a second attempt cannot steal an owned worktree", () => {
  const firstAt = new Date("2026-09-03T14:00:00.000Z");
  const secondAt = new Date("2026-09-03T14:01:00.000Z");
  const { root, slug } = fixture();
  const first = trackedAttempt(slug, "first task", firstAt, "## Exact next action\n\nResume the first task.\n");
  const second = trackedAttempt(slug, "second task", secondAt, "## Exact next action\n\nResume the second task.\n");
  observeAttempt(slug, first.id, { harness: "codex", sessionId: "shared-thread", status: "active", worktreePath: root }, firstAt);
  assert.throws(
    () => observeAttempt(slug, second.id, { harness: "codex", sessionId: "shared-thread", status: "active", worktreePath: root }, secondAt),
    new RegExp(`owned by ${first.id}`),
  );
});

test("a dormant attempt keeps its worktree until it is explicitly abandoned", () => {
  const observedAt = new Date("2026-09-03T14:00:00.000Z");
  const afterExpiry = new Date(observedAt.getTime() + 6 * 60_000);
  const { root, slug } = fixture();
  const first = trackedAttempt(slug, "dormant first task", observedAt, "## Exact next action\n\nResume the first task.\n");
  const second = trackedAttempt(slug, "replacement task", afterExpiry, "## Exact next action\n\nStart the replacement.\n");
  observeAttempt(slug, first.id, { harness: "codex", sessionId: "old-thread", status: "active", worktreePath: root }, observedAt);

  assert.throws(
    () => observeAttempt(slug, second.id, {
      harness: "codex",
      sessionId: "new-thread",
      status: "active",
      worktreePath: root,
      transferReason: "Replace the dormant attempt.",
    }, afterExpiry),
    new RegExp(`owned by ${first.id}`),
  );

  updateAttemptLifecycle(slug, first.id, "abandon", { reason: "Superseded by the replacement task.", authorityToken: AUTHORITY_TOKEN }, afterExpiry);
  const claimed = observeAttempt(slug, second.id, {
    harness: "codex",
    sessionId: "new-thread",
    status: "active",
    worktreePath: root,
  }, afterExpiry);
  assert.equal(claimed.current_execution.session_id, "new-thread");
});

test("old observations become stale and abandonment must be explicit", () => {
  const observedAt = new Date("2026-08-01T00:00:00.000Z");
  const now = new Date("2026-09-03T14:00:00.000Z");
  const { root, slug } = fixture();
  const stale = trackedAttempt(slug, "stale task", observedAt, "## Exact next action\n\nRecheck before continuing.\n");
  const abandoned = trackedAttempt(slug, "abandoned task", now, "## Exact next action\n\nConfirm abandonment.\n");
  observeAttempt(slug, stale.id, { harness: "codex", sessionId: "old-thread", status: "active", worktreePath: root }, observedAt);
  updateAttemptLifecycle(slug, abandoned.id, "abandon", { reason: "Superseded by the approved replacement.", authorityToken: AUTHORITY_TOKEN }, now);

  const snapshot = projectWorkSnapshot(slug, now);
  assert.deepEqual(
    Object.fromEntries(snapshot.attempts.map(({ name, live_state }) => [name, live_state])),
    { "stale task": "stale", "abandoned task": "abandoned" },
  );
  writeFileSync(join(abandoned.folder, "HANDOFF.md"), "## Status: Complete\n");
  const unchanged = syncAttemptFromHandoff(slug, abandoned.id);
  assert.equal(unchanged.status, "abandoned");
  assert.equal(unchanged.changed, false);
  const statusText = execFileSync(process.execPath, [CLI, "project", "status"], {
    cwd: root,
    env: { ...process.env, DIRF_HOME: process.env.DIRF_HOME },
    encoding: "utf8",
  });
  assert.match(statusText, /abandoned: Superseded by the approved replacement\./);
  assert.match(statusText, /handoff: .*HANDOFF\.md/);
  assert.throws(
    () => observeAttempt(slug, stale.id, { harness: "codex", sessionId: "bad", status: "abandoned" }, now),
    /Invalid execution status/,
  );
  assert.throws(
    () => observeAttempt(slug, stale.id, { harness: "codex", sessionId: "bad", status: "active", worktreePath: tmpdir() }, now),
    /must belong to the attempt's registered project/,
  );

  const reopened = updateAttemptLifecycle(slug, abandoned.id, "reopen", {}, now);
  assert.equal(reopened.status, "in_progress");
  assert.equal(reopened.abandonment_reason, null);
});

test("a fresh orchestrator owner cannot be overwritten by another session", () => {
  const now = new Date("2026-09-03T14:00:00.000Z");
  const { root, slug } = fixture();
  const attempt = trackedAttempt(slug, "owned task", now, "## Exact next action\n\nContinue owned work.\n");
  observeAttempt(slug, attempt.id, { harness: "codex", sessionId: "owner", status: "active", worktreePath: root }, now);

  assert.throws(
    () => observeAttempt(slug, attempt.id, { harness: "codex", sessionId: "rogue-child", status: "active", worktreePath: root }, now),
    /active orchestrator codex:owner/,
  );
  assert.throws(
    () => observeAttempt(slug, attempt.id, {
      harness: "codex",
      sessionId: "reasoned-rogue-child",
      status: "active",
      worktreePath: root,
      transferReason: "Try to replace the live owner.",
    }, now),
    /fresh owner cannot be transferred/,
  );

  const afterExpiry = new Date(now.getTime() + 6 * 60_000);
  assert.throws(
    () => observeAttempt(slug, attempt.id, {
      harness: "other-harness",
      sessionId: "new-owner",
      status: "active",
      worktreePath: root,
    }, afterExpiry),
    /pass an explicit transfer reason/,
  );
  const resumed = observeAttempt(slug, attempt.id, {
    harness: "other-harness",
    sessionId: "new-owner",
    status: "active",
    worktreePath: root,
    transferReason: "Resume the stale owner in a new harness session.",
  }, afterExpiry);
  assert.equal(resumed.current_execution.session_id, "new-owner");
  assert.equal(resumed.current_execution.previous_owner.reason, "Resume the stale owner in a new harness session.");
  const refreshed = observeAttempt(slug, attempt.id, {
    harness: "other-harness",
    sessionId: "new-owner",
    status: "active",
    worktreePath: root,
  }, new Date(afterExpiry.getTime() + 1_000));
  assert.equal(refreshed.current_execution.previous_owner.reason, "Resume the stale owner in a new harness session.");
  const publicExecution = projectWorkSnapshot(slug, new Date(afterExpiry.getTime() + 1_000)).attempts[0].execution;
  assert.equal(publicExecution.previous_owner.reason, "Resume the stale owner in a new harness session.");
  assert.equal("authority_hash" in publicExecution, false);
});

test("execution mutation requires the harness-held orchestrator capability", () => {
  const now = new Date("2026-09-03T14:00:00.000Z");
  const { root, slug } = fixture();
  const attempt = trackedAttempt(slug, "protected task", now, "## Exact next action\n\nContinue protected work.\n");

  assert.throws(
    () => observeAttemptState(slug, attempt.id, {
      harness: "codex",
      sessionId: "rogue-child",
      status: "active",
      worktreePath: root,
    }, now),
    /execution authority token is required/,
  );

  observeAttempt(slug, attempt.id, { harness: "codex", sessionId: "owner", status: "active", worktreePath: root }, now);
  const authorityText = readFileSync(join(process.env.DIRF_HOME, "projects", slug, "execution-authority.json"), "utf8");
  const authority = JSON.parse(authorityText);
  assert.match(authority.authority_hash, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(authorityText, new RegExp(AUTHORITY_TOKEN));
  assert.throws(
    () => observeAttemptState(slug, attempt.id, {
      harness: "codex",
      sessionId: "rogue-child",
      status: "active",
      worktreePath: root,
      authorityToken: "different-orchestrator-token-00000001",
    }, new Date(now.getTime() + 6 * 60_000)),
    /execution authority rejected/,
  );

  const other = trackedAttempt(slug, "other protected task", new Date(now.getTime() + 7 * 60_000), "## Exact next action\n\nContinue other work.\n");
  assert.throws(
    () => observeAttemptState(slug, other.id, {
      harness: "codex",
      sessionId: "rogue-child",
      status: "active",
      worktreePath: root,
      authorityToken: "different-orchestrator-token-00000001",
    }, new Date(now.getTime() + 7 * 60_000)),
    /execution authority rejected for project/,
  );
});

test("an observer cannot bootstrap its own project authority", () => {
  const now = new Date("2026-09-03T14:00:00.000Z");
  const { root, slug } = fixture({ bindAuthority: false });
  const attempt = trackedAttempt(slug, "uninitialized task", now, "## Exact next action\n\nInitialize through the host.\n");

  assert.throws(
    () => observeAttemptState(slug, attempt.id, {
      harness: "rogue",
      sessionId: "first-writer",
      status: "active",
      worktreePath: root,
      authorityToken: "invented-first-writer-token-0000001",
    }, now),
    /trusted harness must bind .* during setup before agents run/,
  );
});

test("abandonment requires the pre-bound project capability", () => {
  const now = new Date("2026-09-03T14:00:00.000Z");
  const { slug } = fixture();
  const attempt = trackedAttempt(slug, "protected abandonment", now, "## Exact next action\n\nContinue protected work.\n");

  assert.throws(
    () => updateAttemptLifecycle(slug, attempt.id, "abandon", { reason: "Rogue child request." }, now),
    /execution authority token is required/,
  );
  assert.equal(projectWorkSnapshot(slug, now).attempts[0].lifecycle_status, "in_progress");
});

test("one orchestrator snapshot owns child reports without giving children write authority", () => {
  const now = new Date("2026-09-03T14:00:00.000Z");
  const { root, slug } = fixture();
  const attempt = trackedAttempt(slug, "delegated task", now, "## Exact next action\n\nIntegrate the child result.\n");
  observeAttempt(slug, attempt.id, {
    harness: "codex",
    sessionId: "orchestrator",
    status: "idle",
    worktreePath: root,
    children: [
      { sessionId: "child-a", assignment: "Inspect state", status: "active" },
      { sessionId: "child-b", assignment: "Check docs", status: "completed", result: "No gaps found." },
    ],
  }, now);

  let snapshot = projectWorkSnapshot(slug, now);
  assert.equal(snapshot.attempts[0].live_state, "active");
  assert.equal(snapshot.attempts[0].execution.children.length, 2);
  assert.equal(snapshot.attempts[0].lifecycle_status, "in_progress");

  const later = new Date(now.getTime() + 60_000);
  observeAttempt(slug, attempt.id, {
    harness: "codex",
    sessionId: "orchestrator",
    status: "idle",
    worktreePath: root,
    children: [
      { sessionId: "child-a", assignment: "Inspect state", status: "completed", result: "Inspection complete." },
      { sessionId: "child-b", assignment: "Check docs", status: "completed", result: "No gaps found." },
    ],
  }, later);
  snapshot = projectWorkSnapshot(slug, later);
  assert.equal(snapshot.attempts[0].live_state, "resumable");
  assert.equal(snapshot.attempts[0].lifecycle_status, "in_progress");
});

test("a blocked child affects the parent view only when the orchestrator marks it blocking", () => {
  const now = new Date("2026-09-03T14:00:00.000Z");
  const { root, slug } = fixture();
  const attempt = trackedAttempt(slug, "blocked delegation", now, "## Exact next action\n\nResolve the delegated blocker.\n");
  const base = {
    harness: "codex",
    sessionId: "orchestrator",
    status: "idle",
    worktreePath: root,
  };

  observeAttempt(slug, attempt.id, {
    ...base,
    children: [{ sessionId: "child-a", assignment: "Inspect API", status: "blocked", blocker: "Missing fixture" }],
  }, now);
  assert.equal(projectWorkSnapshot(slug, now).attempts[0].live_state, "resumable");

  observeAttempt(slug, attempt.id, {
    ...base,
    children: [{ sessionId: "child-a", assignment: "Inspect API", status: "blocked", blocker: "Missing fixture", blocksParent: true }],
  }, new Date(now.getTime() + 1_000));
  assert.equal(projectWorkSnapshot(slug, new Date(now.getTime() + 1_000)).attempts[0].live_state, "blocked");
});

test("malformed child reports fail closed without replacing the current snapshot", () => {
  const now = new Date("2026-09-03T14:00:00.000Z");
  const { root, slug } = fixture();
  const attempt = trackedAttempt(slug, "bounded reports", now, "## Exact next action\n\nCorrect the child report.\n");
  const owner = { harness: "codex", sessionId: "orchestrator", status: "active", worktreePath: root };
  observeAttempt(slug, attempt.id, owner, now);

  assert.throws(
    () => observeAttempt(slug, attempt.id, {
      ...owner,
      children: [{ sessionId: "child-a", assignment: "Inspect", status: "blocked" }],
    }, new Date(now.getTime() + 1_000)),
    /blocker is required/,
  );
  assert.throws(
    () => observeAttempt(slug, attempt.id, {
      ...owner,
      children: Array.from({ length: 65 }, (_, index) => ({ sessionId: `child-${index}`, assignment: "Inspect", status: "idle" })),
    }, new Date(now.getTime() + 1_000)),
    /cannot exceed 64/,
  );

  const stored = projectWorkSnapshot(slug, new Date(now.getTime() + 1_000)).attempts[0];
  assert.equal(stored.execution.observed_at, now.toISOString());
  assert.deepEqual(stored.execution.children, []);
});

test("an expired execution observation is explicitly stale, not resumable", () => {
  const observedAt = new Date("2026-09-03T14:00:00.000Z");
  const now = new Date(observedAt.getTime() + 6 * 60_000);
  const { root, slug } = fixture();
  const attempt = trackedAttempt(slug, "expired owner", observedAt, "## Exact next action\n\nResume carefully.\n");
  observeAttempt(slug, attempt.id, { harness: "codex", sessionId: "old-owner", status: "active", worktreePath: root }, observedAt);

  const item = projectWorkSnapshot(slug, now).attempts[0];
  assert.equal(item.live_state, "stale");
  assert.equal(item.execution.fresh, false);
});

test("project continuation reconciles the canonical and scoped handoffs", () => {
  const now = new Date("2026-09-03T14:00:00.000Z");
  const { slug } = fixture();
  const attempt = trackedAttempt(slug, "handoff owner", now, "## Exact next action\n\nUse the scoped handoff.\n");
  writeHandoff(slug, "# Project handoff\n\n## Exact next action\n\nUse the canonical handoff.\n");

  const snapshot = projectWorkSnapshot(slug, now);
  assert.equal(snapshot.attempts[0].next_action, "Use the scoped handoff.");
  assert.equal(snapshot.continuation.source, "project");
  assert.equal(snapshot.continuation.attempt_id, null);
  assert.equal(snapshot.continuation.next_action, "Use the canonical handoff.");
  assert.equal(snapshot.project.handoff_path, snapshot.continuation.handoff_path);
});

test("concurrent worktree claims serialize and exactly one owner wins", async () => {
  const now = new Date();
  const { root, slug } = fixture();
  const first = trackedAttempt(slug, "concurrent first", now, "## Exact next action\n\nContinue first.\n");
  const second = trackedAttempt(slug, "concurrent second", new Date(now.getTime() + 1), "## Exact next action\n\nContinue second.\n");
  const baseEnv = {
    ...process.env,
    DIRF_HOME: process.env.DIRF_HOME,
    DIRF_HARNESS: "test",
    DIRF_ORCHESTRATOR_TOKEN: AUTHORITY_TOKEN,
  };

  const results = await Promise.all([
    runCliAsync(["attempt", "observe", first.id, "--execution-status", "active"], {
      cwd: root,
      env: { ...baseEnv, DIRF_SESSION_ID: "owner-a" },
    }),
    runCliAsync(["attempt", "observe", second.id, "--execution-status", "active"], {
      cwd: root,
      env: { ...baseEnv, DIRF_SESSION_ID: "owner-b" },
    }),
  ]);

  assert.equal(results.filter(({ code }) => code === 0).length, 1);
  assert.equal(results.filter(({ code }) => code !== 0).length, 1);
  assert.match(results.find(({ code }) => code !== 0).stderr, /worktree or branch is owned by/);
  const snapshot = projectWorkSnapshot(slug, new Date());
  assert.equal(snapshot.summary.active, 1);
});

test("concurrent abandonment cannot be undone by an execution observation", async () => {
  const now = new Date();
  const { root, slug } = fixture();
  const attempt = trackedAttempt(slug, "concurrent abandonment", now, "## Exact next action\n\nContinue unless abandoned.\n");
  const env = {
    ...process.env,
    DIRF_HOME: process.env.DIRF_HOME,
    DIRF_HARNESS: "test",
    DIRF_SESSION_ID: "owner",
    DIRF_ORCHESTRATOR_TOKEN: AUTHORITY_TOKEN,
  };

  const [observation, abandonment] = await Promise.all([
    runCliAsync(["attempt", "observe", attempt.id, "--execution-status", "active"], { cwd: root, env }),
    runCliAsync(["attempt", "abandon", attempt.id, "--reason", "Explicit concurrent stop."], { cwd: root, env }),
  ]);

  assert.equal(abandonment.code, 0, abandonment.stderr);
  assert.ok(observation.code === 0 || /is abandoned and cannot be observed/.test(observation.stderr));
  const final = projectWorkSnapshot(slug, new Date()).attempts[0];
  assert.equal(final.lifecycle_status, "abandoned");
  assert.equal(final.execution, null);
});

test("concurrent completion cannot be undone by an execution observation", async () => {
  const now = new Date();
  const { root, slug } = fixture();
  const attempt = trackedAttempt(slug, "concurrent completion", now, "## Exact next action\n\nComplete the work.\n");
  const env = {
    ...process.env,
    DIRF_HOME: process.env.DIRF_HOME,
    DIRF_HARNESS: "test",
    DIRF_SESSION_ID: "owner",
    DIRF_ORCHESTRATOR_TOKEN: AUTHORITY_TOKEN,
  };

  const [observation, completion] = await Promise.all([
    runCliAsync(["attempt", "observe", attempt.id, "--execution-status", "active"], { cwd: root, env }),
    runCliAsync(["attempt", "complete", attempt.id, "--confirm"], { cwd: root, env }),
  ]);

  assert.equal(completion.code, 0, completion.stderr);
  assert.ok(observation.code === 0 || /is done and cannot be observed/.test(observation.stderr));
  assert.equal(projectWorkSnapshot(slug, new Date()).attempts[0].lifecycle_status, "done");
});

test("concurrent advance and observation preserve both lifecycle and ownership", async () => {
  const now = new Date();
  const { root, slug } = fixture();
  const created = createAttemptInStore(slug, "concurrent advance", now);
  writeFileSync(join(created.folder, "workflow.json"), JSON.stringify({ workflow: { phases: ["build", "verify"] } }));
  writeFileSync(join(created.folder, "HANDOFF.md"), "## Exact next action\n\nAdvance and observe.\n");
  const attempt = updateAttemptLifecycle(slug, created.id, "start", {}, now);
  const env = {
    ...process.env,
    DIRF_HOME: process.env.DIRF_HOME,
    DIRF_HARNESS: "test",
    DIRF_SESSION_ID: "owner",
    DIRF_ORCHESTRATOR_TOKEN: AUTHORITY_TOKEN,
  };

  const [observation, advance] = await Promise.all([
    runCliAsync(["attempt", "observe", attempt.id, "--execution-status", "active"], { cwd: root, env }),
    runCliAsync(["attempt", "advance", attempt.id], { cwd: root, env }),
  ]);

  assert.equal(observation.code, 0, observation.stderr);
  assert.equal(advance.code, 0, advance.stderr);
  const final = projectWorkSnapshot(slug, new Date()).attempts[0];
  assert.equal(final.current_phase, "verify");
  assert.equal(final.execution.session_id, "owner");
});

test("setup stays idempotent when the orchestrator token rotates", () => {
  const { root, slug } = fixture({ bindAuthority: false });
  const env = {
    ...process.env,
    DIRF_HOME: process.env.DIRF_HOME,
    DIRF_ORCHESTRATOR_TOKEN: AUTHORITY_TOKEN,
  };
  const first = execFileSync(process.execPath, [CLI, "setup", root], { cwd: root, env, encoding: "utf8" });
  assert.match(first, /Execution authority initialized/);
  const again = execFileSync(process.execPath, [CLI, "setup", root], { cwd: root, env, encoding: "utf8" });
  assert.match(again, /Already configured/);
  assert.match(again, /Execution authority already initialized/);

  const rotated = execFileSync(process.execPath, [CLI, "setup", root], {
    cwd: root,
    env: { ...env, DIRF_ORCHESTRATOR_TOKEN: "rotated-orchestrator-token-0123456789abcdef" },
    encoding: "utf8",
  });
  assert.match(rotated, /Execution authority note: execution authority is already initialized/);

  const now = new Date();
  const attempt = trackedAttempt(slug, "token guard task", now, "## Exact next action\n\nStay guarded.\n");
  const kept = observeAttempt(slug, attempt.id, { harness: "codex", sessionId: "kept-thread", status: "active", worktreePath: root }, now);
  assert.equal(kept.current_execution.session_id, "kept-thread");
  assert.throws(
    () => observeAttempt(slug, attempt.id, {
      authorityToken: "rotated-orchestrator-token-0123456789abcdef",
      harness: "codex",
      sessionId: "rotated-thread",
      status: "active",
      worktreePath: root,
    }, now),
    /authority/,
  );
});

test("observations with a future observed time are rejected", () => {
  const now = new Date("2026-09-03T15:00:00.000Z");
  const { root, slug } = fixture();
  const attempt = trackedAttempt(slug, "future clock task", now, "## Exact next action\n\nContinue later.\n");
  assert.throws(
    () => observeAttempt(slug, attempt.id, {
      harness: "codex",
      sessionId: "future-thread",
      status: "active",
      worktreePath: root,
      observedAt: new Date(now.getTime() + 60_000).toISOString(),
    }, now),
    /cannot be in the future/,
  );
});
