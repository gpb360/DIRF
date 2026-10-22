import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { registerProject, createAttemptInStore, updateAttemptLifecycle, recordProgress, storeProjectDir } from '../src/state.js';

for (const scenario of ['planned skipped phase', 'skipped phase', 'unsatisfied gate', 'invalid timestamp', 'invalid files']) {
  test(`rejected checkpoint preserves persisted state: ${scenario}`, () => {
    const previousHome = process.env.DIRF_HOME;
    process.env.DIRF_HOME = mkdtempSync(join(tmpdir(), 'dirf-rejection-home-'));
    try {
      const root = mkdtempSync(join(tmpdir(), 'dirf-rejection-repo-'));
      execFileSync('git', ['init', '-q'], { cwd: root });
      const { slug } = registerProject(root);
      const attempt = createAttemptInStore(slug, 'rejection');
      writeFileSync(join(attempt.folder, 'workflow.json'), JSON.stringify({
        workflow: { phases: ['build', 'approve', 'post'], gates: scenario === 'unsatisfied gate' ? { build: { kind: 'decision' } } : {} },
      }));
      if (scenario !== 'planned skipped phase') {
        updateAttemptLifecycle(slug, attempt.id, 'start');
        recordProgress(slug, { attemptId: attempt.id, message: 'Verified checkpoint', phase: 'build', next: 'Continue build' });
      }
      const paths = [join(attempt.folder, 'HANDOFF.md'), join(attempt.folder, 'attempt.json'), join(storeProjectDir(slug), 'HANDOFF.md'), join(storeProjectDir(slug), '.progress-sequence')];
      const snapshot = () => paths.map(path => existsSync(path) ? readFileSync(path, 'utf8') : null);
      const before = snapshot();
      assert.throws(() => recordProgress(slug, {
        attemptId: attempt.id, message: 'Rejected progress', next: 'Incorrect next step',
        phase: scenario.includes('skipped phase') ? 'post' : 'approve',
        ...(scenario === 'invalid timestamp' ? { timestamp: 'not-a-date' } : {}),
        ...(scenario === 'invalid files' ? { files: 'not-an-array' } : {}),
      }), /cannot be backfilled|unsatisfied|Invalid time value|map is not a function/);
      assert.equal(existsSync(join(storeProjectDir(slug), '.pending-progress.json')), false);
      assert.deepEqual(snapshot(), before);
    } finally {
      if (previousHome === undefined) delete process.env.DIRF_HOME;
      else process.env.DIRF_HOME = previousHome;
    }
  });
}
