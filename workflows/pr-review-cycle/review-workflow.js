#!/usr/bin/env node
/**
 * PR Review Cycle Workflow
 *
 * Automated PR review with confidence scoring and iterative improvement
 * Usage: node review-workflow.js [options]
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { evaluateFixedPoint } = require('./fixed-point-gate');

// Configuration
const CONFIG = {
  confidenceThreshold: 80,
  securityThreshold: 90,
  performanceThreshold: 70,
  coverageThreshold: 75,
  stages: ['code-quality', 'security', 'performance', 'coverage']
};

// Parse command line arguments
function parseArgs(args) {
  const options = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      if (key.includes('=')) {
        const [k, v] = key.split('=');
        options[k] = v;
      } else {
        options[key] = true;
      }
    }
  }
  return options;
}

// Get PR diff
function getPRDiff(prUrl) {
  try {
    if (prUrl) {
      // Parse PR URL and get diff via GitHub CLI
      const match = prUrl.match(/github\.com\/([^\/]+)\/([^\/]+)\/pull\/(\d+)/);
      if (match) {
        const [, owner, repo, prNum] = match;
        const diff = execSync(`gh pr diff ${prNum} --repo ${owner}/${repo}`, {
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe']
        });
        return diff;
      }
    }
    // Fallback to local git diff
    return execSync('git diff main...HEAD', { encoding: 'utf-8' });
  } catch (error) {
    console.error('Error getting PR diff:', error.message);
    return '';
  }
}

// Analyze changes with AI agent
function analyzeWithAgent(stage, diff, options = {}) {
  const prompts = {
    'code-quality': `Review this code diff for quality issues:
    - Architecture & design patterns
    - Code organization & readability
    - Error handling & edge cases
    - Documentation completeness
    - Performance considerations

Return JSON with:
{
  "score": 0-100,
  "issues": [{"severity": "blocking|suggestion", "line": number, "message": string, "score": number}],
  "summary": string
}

Diff:
${diff}`,

    'security': `Review this code diff for security vulnerabilities:
    - Input validation & sanitization
    - Authentication & authorization
    - Secret/credential handling
    - SQL injection, XSS, CSRF
    - Dependency vulnerabilities
    - Access controls

Return JSON with:
{
  "score": 0-100,
  "issues": [{"severity": "critical|high|medium|low", "line": number, "message": string, "score": number, "cve": string}],
  "summary": string
}

Diff:
${diff}`,

    'performance': `Review this code diff for performance issues:
    - Algorithm efficiency
    - Resource usage (memory, CPU)
    - Database query optimization (N+1 problems)
    - Caching opportunities
    - Scalability concerns

Return JSON with:
{
  "score": 0-100,
  "issues": [{"severity": "blocking|suggestion", "line": number, "message": string, "score": number}],
  "summary": string
}

Diff:
${diff}`,

    'coverage': `Review this code diff for test coverage:
    - Unit test coverage percentage
    - Missing edge cases
    - Integration test presence
    - Mock/stub appropriateness
    - Test clarity

Return JSON with:
{
  "score": 0-100,
  "issues": [{"severity": "blocking|suggestion", "file": string, "message": string, "score": number}],
  "coverage": number,
  "summary": string
}

Diff:
${diff}`
  };

  const prompt = prompts[stage];
  if (!prompt) {
    throw new Error(`Unknown stage: ${stage}`);
  }

  // Call Claude Code agent for analysis
  try {
    const result = execSync(`claude-agent --prompt="${encodeURIComponent(prompt)}"`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    });
    return JSON.parse(result);
  } catch (error) {
    console.error(`Error in ${stage} analysis:`, error.message);
    return { score: 0, issues: [], summary: 'Analysis failed' };
  }
}

// Run complete review cycle
async function runReviewCycle(options) {
  console.log('🔍 Starting PR Review Cycle...\n');

  // Get the diff
  const diff = getPRDiff(options.prUrl);
  if (!diff) {
    console.error('❌ No diff found to review');
    return false;
  }

  console.log(`📊 Analyzing ${diff.split('\n').length} lines of changes...\n`);

  // Run all review stages
  const results = {};
  for (const stage of CONFIG.stages) {
    console.log(`Running ${stage} review...`);
    results[stage] = analyzeWithAgent(stage, diff, options);
  }

  // Calculate overall confidence score
  const scores = Object.values(results).map(r => r.score);
  const overallScore = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);

  // Display results
  console.log('\n' + '━'.repeat(60));
  console.log(`📊 PR Review Results`);
  console.log('━'.repeat(60));
  console.log(`Overall Confidence Score: ${overallScore}/100`);
  console.log('');

  console.log('Stage Scores:');
  for (const [stage, result] of Object.entries(results)) {
    const icon = result.score >= (CONFIG[`${stage.split('-')[0]}Threshold`] || 80) ? '✅' : '❌';
    console.log(`  ${icon} ${stage}: ${result.score}/100`);
  }
  console.log('');

  // Collect all issues
  const allIssues = [];
  for (const [stage, result] of Object.entries(results)) {
    for (const issue of result.issues) {
      allIssues.push({ ...issue, stage });
    }
  }

  const blockingIssues = allIssues.filter(i => i.severity === 'blocking' || i.severity === 'critical' || i.severity === 'high');
  const suggestions = allIssues.filter(i => i.severity === 'suggestion' || i.severity === 'medium' || i.severity === 'low');

  if (blockingIssues.length > 0) {
    console.log(`🚫 BLOCKING ISSUES (${blockingIssues.length}):`);
    for (const issue of blockingIssues) {
      console.log(`  ${issue.score}. [${issue.stage.toUpperCase()}] ${issue.message}`);
      if (issue.line) console.log(`     Line: ${issue.line}`);
    }
    console.log('');
  }

  if (suggestions.length > 0) {
    console.log(`💡 SUGGESTIONS (${suggestions.length}):`);
    for (const issue of suggestions) {
      console.log(`  ${issue.score}. [${issue.stage.toUpperCase()}] ${issue.message}`);
    }
    console.log('');
  }

  // Merge decision
  const passesThreshold = overallScore >= CONFIG.confidenceThreshold;
  const passesSecurity = results.security?.score >= CONFIG.securityThreshold;
  const noBlocking = blockingIssues.length === 0;

  const localReviewPass = passesThreshold && passesSecurity && noBlocking;
  const fixedPointState = options.fixedPointState
    ? JSON.parse(fs.readFileSync(path.resolve(options.fixedPointState), 'utf8'))
    : null;
  const fixedPoint = fixedPointState
    ? evaluateFixedPoint(fixedPointState)
    : {
        state: 'continue_review_loop',
        mergeApprovalAllowed: false,
        reasons: ['missing_exact_head_fixed_point_state'],
        nextAction: 'wait_ingest_fix_reply_resolve_rereview'
      };
  const mergePass = localReviewPass && fixedPoint.mergeApprovalAllowed;

  console.log('━'.repeat(60));
  if (mergePass) {
    console.log('✅ Review Result: PASS');
    console.log('🎉 Exact-head fixed point reached; merge approval may be requested.');
  } else {
    console.log('❌ Review Result: FAIL');
    console.log(`🔄 Confidence: ${overallScore}/100 (need ${CONFIG.confidenceThreshold})`);
    if (!passesSecurity) {
      console.log(`   Security: ${results.security?.score}/100 (need ${CONFIG.securityThreshold})`);
    }
    if (!noBlocking) {
      console.log(`   Blocking issues: ${blockingIssues.length}`);
    }
    for (const reason of fixedPoint.reasons) {
      console.log(`   Fixed-point gate: ${reason}`);
    }
    console.log('🔧 Next Action: Continue wait → ingest → fix → reply → resolve → re-review');
  }
  console.log('━'.repeat(60));

  // Save results
  const reportPath = path.join(process.cwd(), '.pr-review-report.json');
  fs.writeFileSync(reportPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    overallScore,
    results,
    issues: allIssues,
    mergeDecision: mergePass ? 'PASS' : 'CONTINUE',
    fixedPoint
  }, null, 2));

  console.log(`\n📝 Report saved to: ${reportPath}`);

  return mergePass;
}

// CLI interface
async function main() {
  const options = parseArgs(process.argv.slice(2));

  try {
    const passed = await runReviewCycle(options);
    process.exit(passed ? 0 : 1);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { runReviewCycle, CONFIG };
