import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { registerProject, bindExecutionAuthority, createAttemptInStore, updateAttemptLifecycle, recordProgress, storeProjectDir, getAttempt } from '../src/state.js';

test('abandon preserves history and rejects late progress until explicit reopen', () => {
  const oldHome = process.env.DIRF_HOME;
  process.env.DIRF_HOME = mkdtempSync(join(tmpdir(), 'dirf-stop-home-'));
  try {
    const root = mkdtempSync(join(tmpdir(), 'dirf-stop-repo-'));
    execFileSync('git', ['init', '-q'], { cwd: root });
    const { slug } = registerProject(root);
    const token = 'fixture-only-stop-authority-0123456789';
    bindExecutionAuthority(slug, token);
    const attempt = createAttemptInStore(slug, 'obsolete');
    writeFileSync(join(attempt.folder, 'workflow.json'), JSON.stringify({ workflow: { phases: ['work'] } }));
    recordProgress(slug, { attemptId: attempt.id, message: 'Verified prior work', phase: 'work', next: 'Review work' });
    assert.throws(() => updateAttemptLifecycle(slug, attempt.id, 'abandon', { reason: 'Missing authority' }), /authority/);
    assert.equal(getAttempt(slug, attempt.id).status, 'in_progress');
    updateAttemptLifecycle(slug, attempt.id, 'abandon', { reason: 'Obsolete work explicitly stopped', authorityToken: token });
    const paths = [join(attempt.folder, 'HANDOFF.md'), join(attempt.folder, 'attempt.json'), join(storeProjectDir(slug), 'HANDOFF.md'), join(storeProjectDir(slug), '.progress-sequence')];
    const before = paths.map(path => readFileSync(path, 'utf8'));
    const rejected = recordProgress(slug, { attemptId: attempt.id, message: 'Delayed worker overwrite', phase: 'work', next: 'Run obsolete work again' });
    assert.equal(rejected.recorded, false);
    assert.equal(rejected.reason, 'attempt_abandoned');
    assert.deepEqual(paths.map(path => readFileSync(path, 'utf8')), before);
    assert.match(before[0], /Verified prior work/);
    updateAttemptLifecycle(slug, attempt.id, 'reopen');
    assert.equal(recordProgress(slug, { attemptId: attempt.id, message: 'Explicitly resumed', next: 'Continue' }).recorded, true);
  } finally {
    if (oldHome === undefined) delete process.env.DIRF_HOME;
    else process.env.DIRF_HOME = oldHome;
  }
});
