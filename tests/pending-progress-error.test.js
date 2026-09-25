import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  registerProject,
  createAttemptInStore,
  updateAttemptLifecycle,
  claimAttemptCheckout,
  recordProgress,
  readHandoff,
  listAttempts,
  storeProjectDir,
} from '../src/state.js';

const moduleUrl = pathToFileURL(resolve('src/state.js')).href;
const TIMEOUT = 30000;

function freshRepo(prefix) {
  const root = mkdtempSync(join(tmpdir(), prefix));
  execFileSync('git', ['init', '-q'], { cwd: root, timeout: TIMEOUT });
  execFileSync('git', ['config', 'user.email', 'dirf@example.invalid'], { cwd: root, timeout: TIMEOUT });
  execFileSync('git', ['config', 'user.name', 'DIRF Test'], { cwd: root, timeout: TIMEOUT });
  return root;
}

function commitAll(root, message, content) {
  writeFileSync(join(root, 'commits.txt'), `${content}\n`);
  execFileSync('git', ['add', '-A'], { cwd: root, timeout: TIMEOUT });
  execFileSync('git', ['commit', '-qm', message], { cwd: root, timeout: TIMEOUT });
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', timeout: TIMEOUT }).trim();
}

test('a replay that can never succeed names the pending progress journal', () => {
  const oldHome = process.env.DIRF_HOME;
  process.env.DIRF_HOME = mkdtempSync(join(tmpdir(), 'dirf-pending-home-'));
  try {
    const root = freshRepo('dirf-pending-repo-');
    commitAll(root, 'base', 'base');
    const { slug } = registerProject(root);
    const attempt = createAttemptInStore(slug, 'pending-error');
    writeFileSync(join(attempt.folder, 'workflow.json'), JSON.stringify({ workflow: { phases: ['build', 'verify'] } }));
    updateAttemptLifecycle(slug, attempt.id, 'start');
    claimAttemptCheckout(slug, attempt.id, root);
    const recordedRevision = commitAll(root, 'recorded revision', 'recorded');
    recordProgress(slug, {
      attemptId: attempt.id, phase: 'build',
      message: 'Recorded base checkpoint', next: 'Continue step two',
      workItem: 'pr:21', reviewRevision: recordedRevision,
    });
    const crashedRevision = commitAll(root, 'crashed revision', 'crashed');
    const pendingPath = join(storeProjectDir(slug), '.pending-progress.json');
    const attemptPath = join(attempt.folder, 'HANDOFF.md');
    // Crash after the journal is saved but before the attempt handoff is
    // updated, so the checkpoint survives for recovery. No test edits the
    // stored journal to craft this state.
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
      import fs from 'node:fs';
      import { syncBuiltinESMExports } from 'node:module';
      const rename = fs.renameSync;
      fs.renameSync = (from, to) => {
        if (to === ${JSON.stringify(attemptPath)}) process.exit(73);
        rename(from, to);
      };
      syncBuiltinESMExports();
      const { recordProgress } = await import(${JSON.stringify(moduleUrl)});
      recordProgress(${JSON.stringify(slug)}, { attemptId: ${JSON.stringify(attempt.id)}, phase: 'build', message: 'Crashed checkpoint', files: ['feature.js'], next: 'Continue step three', workItem: 'pr:21', reviewRevision: ${JSON.stringify(crashedRevision)} });
    `], { cwd: root, encoding: 'utf8', env: { ...process.env }, timeout: TIMEOUT });
    assert.equal(child.status, 73, child.stderr);
    assert.equal(existsSync(pendingPath), true);
    // The journaled revision stops resolving in the repository, so replay can
    // never succeed until an operator intervenes.
    execFileSync('git', ['reset', '--hard', recordedRevision], { cwd: root, timeout: TIMEOUT });
    execFileSync('git', ['reflog', 'expire', '--expire=now', '--all'], { cwd: root, timeout: TIMEOUT });
    execFileSync('git', ['gc', '--prune=now'], { cwd: root, timeout: TIMEOUT });

    // Advance past the dead-lock grace period for the recovering process only.
    const realNow = Date.now;
    Date.now = () => realNow() + 3_600_000;
    const errors = new Map();
    try {
      for (const operation of [readHandoff, listAttempts]) {
        try {
          operation(slug);
        } catch (error) {
          errors.set(operation.name, error);
        }
      }
    } finally {
      Date.now = realNow;
    }
    assert.deepEqual([...errors.keys()], ['readHandoff', 'listAttempts']);
    for (const error of errors.values()) {
      assert.match(error.message, /unverified_review_revision/);
      assert.ok(error.message.includes(pendingPath), `error should name the journal: ${error.message}`);
      assert.match(error.message, /remove/i);
    }
    assert.equal(existsSync(pendingPath), true, 'journal survives so the operator can inspect it');
  } finally {
    if (oldHome === undefined) delete process.env.DIRF_HOME;
    else process.env.DIRF_HOME = oldHome;
  }
});

test('an invalid pending checkpoint error names the journal file', () => {
  const oldHome = process.env.DIRF_HOME;
  process.env.DIRF_HOME = mkdtempSync(join(tmpdir(), 'dirf-pending-home-'));
  try {
    const root = freshRepo('dirf-pending-invalid-repo-');
    const { slug } = registerProject(root);
    // Simulate a truncated/corrupt crash artifact: an unknown schema version.
    const pendingPath = join(storeProjectDir(slug), '.pending-progress.json');
    writeFileSync(pendingPath, `${JSON.stringify({ schema_version: 999, update: {} })}\n`);
    let error = null;
    try {
      readHandoff(slug);
    } catch (caught) {
      error = caught;
    }
    assert.ok(error, 'readHandoff should throw on an invalid pending checkpoint');
    assert.match(error.message, /Invalid pending progress checkpoint/);
    assert.ok(error.message.includes(pendingPath), `error should name the journal: ${error.message}`);
    assert.match(error.message, /remove/i);
    assert.equal(existsSync(pendingPath), true);
  } finally {
    if (oldHome === undefined) delete process.env.DIRF_HOME;
    else process.env.DIRF_HOME = oldHome;
  }
});
