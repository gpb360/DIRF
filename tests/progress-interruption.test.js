import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { registerProject, createAttemptInStore, updateAttemptLifecycle, recordProgress, claimAttemptCheckout, storeProjectDir, writeHandoff } from '../src/state.js';
import { parseCurrentHandoff } from '../src/handoff-update.js';

const moduleUrl = pathToFileURL(resolve('src/state.js')).href;
const cli = resolve('src/cli.js');

for (const phase of ['build', 'verify']) {
for (const boundary of ['before-journal', 'before-attempt', 'after-attempt', 'after-canonical', 'after-lifecycle']) {
  if (boundary === 'after-lifecycle' && phase === 'build') continue;
  test(`fresh process preserves completed work after exit ${boundary} in ${phase}`, () => {
    const oldHome = process.env.DIRF_HOME;
    process.env.DIRF_HOME = mkdtempSync(join(tmpdir(), 'dirf-interrupt-home-'));
    try {
      const root = mkdtempSync(join(tmpdir(), 'dirf-interrupt-repo-'));
      execFileSync('git', ['init', '-q'], { cwd: root });
      const { slug } = registerProject(root);
      const attempt = createAttemptInStore(slug, 'interruption');
      writeFileSync(join(attempt.folder, 'workflow.json'), JSON.stringify({ workflow: { phases: ['build', 'verify'] } }));
      updateAttemptLifecycle(slug, attempt.id, 'start');
      claimAttemptCheckout(slug, attempt.id, root);
      recordProgress(slug, { attemptId: attempt.id, phase: 'build', message: 'Completed step one; child result=42', next: 'Continue step two' });
      const attemptPath = join(attempt.folder, 'HANDOFF.md');
      const canonicalPath = join(storeProjectDir(slug), 'HANDOFF.md');
      writeHandoff(slug, readFileSync(canonicalPath, 'utf8') + '\n## Project note\n\nPreserve project context.\n');
      const pendingPath = join(storeProjectDir(slug), '.pending-progress.json');
      const target = boundary === 'before-journal' ? pendingPath
        : boundary === 'after-lifecycle' ? join(attempt.folder, 'attempt.json')
        : boundary === 'after-canonical' ? canonicalPath : attemptPath;
      const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
        import fs from 'node:fs';
        import { syncBuiltinESMExports } from 'node:module';
        const rename = fs.renameSync;
        fs.renameSync = (from, to) => {
          if (to === ${JSON.stringify(target)} && ${JSON.stringify(boundary)}.startsWith('before-')) process.exit(73);
          rename(from, to);
          if (to === ${JSON.stringify(target)}) process.exit(73);
        };
        syncBuiltinESMExports();
        const { recordProgress } = await import(${JSON.stringify(moduleUrl)});
        recordProgress(${JSON.stringify(slug)}, { attemptId: ${JSON.stringify(attempt.id)}, phase: ${JSON.stringify(phase)}, message: 'Step two checkpoint', files: ['feature.js'], next: 'Continue step three' });
      `], { cwd: root, encoding: 'utf8', env: { ...process.env }, timeout: 30000 });
      assert.equal(child.status, 73, child.stderr);
      const active = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', `
        const now = Date.now;
        Date.now = () => now() + 3600000;
        process.argv = [process.execPath, ${JSON.stringify(cli)}, 'state', 'active', '--path', ${JSON.stringify(root)}, '--json'];
        await import(${JSON.stringify(pathToFileURL(cli).href)});
      `], { cwd: root, encoding: 'utf8', env: { ...process.env }, timeout: 30000 }));
      assert.equal(active.attempt.id, attempt.id);
      assert.equal(active.attempt.next_action, boundary === 'before-journal' ? 'Continue step two' : 'Continue step three');
      assert.equal(active.attempt.current_phase, boundary === 'before-journal' ? 'build' : phase);
      assert.equal(existsSync(pendingPath), false);
      assert.match(readFileSync(attemptPath, 'utf8'), /Completed step one; child result=42/);
      // Advance only the test process clock past the dead-lock grace period.
      // No test edits the stored lock or checkpoint to make recovery succeed.
      const recovered = execFileSync(process.execPath, ['--input-type=module', '-e', `
        const now = Date.now;
        Date.now = () => now() + 3600000;
        const { recordProgress } = await import(${JSON.stringify(moduleUrl)});
        console.log(JSON.stringify(recordProgress(${JSON.stringify(slug)}, { attemptId: ${JSON.stringify(attempt.id)}, phase: ${JSON.stringify(phase)}, message: 'Fresh process resumed', next: 'Verify remaining work' })));
      `], { cwd: root, encoding: 'utf8', env: { ...process.env }, timeout: 30000 });
      assert.equal(JSON.parse(recovered).recorded, true);
      const restored = readFileSync(attemptPath, 'utf8');
      assert.match(restored, /Completed step one; child result=42/);
      assert.match(restored, /Fresh process resumed/);
      const canonical = readFileSync(canonicalPath, 'utf8');
      assert.match(canonical, /Preserve project context\./);
      const projectCheckpoint = parseCurrentHandoff(canonical);
      const attemptCheckpoint = parseCurrentHandoff(restored);
      assert.deepEqual(projectCheckpoint.completedSteps, attemptCheckpoint.completedSteps);
      assert.equal(new Set(attemptCheckpoint.completedSteps).size, attemptCheckpoint.completedSteps.length);
      assert.deepEqual(projectCheckpoint.changedFiles, attemptCheckpoint.changedFiles);
      assert.equal(projectCheckpoint.updateNumber, attemptCheckpoint.updateNumber);
      assert.equal(projectCheckpoint.nextAction, attemptCheckpoint.nextAction);
    } finally {
      if (oldHome === undefined) delete process.env.DIRF_HOME;
      else process.env.DIRF_HOME = oldHome;
    }
  });
}
}
