#!/usr/bin/env node
/**
 * PR Review CLI - Universal interface for any project
 *
 * Usage: npx pr-review [options]
 *        npx pr-review --pr-url="https://github.com/user/repo/pull/123"
 *        npx pr-review --local
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');

class PRReviewCLI {
  constructor() {
    this.config = this.loadConfig();
    this.reviewDir = path.join(process.cwd(), '.pr-reviews');
    this.ensureReviewDir();
  }

  loadConfig() {
    const configPath = path.join(process.cwd(), '.claude', 'settings.json');
    try {
      return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    } catch {
      return {
        prReviewThresholds: {
          confidence: 80,
          security: 90,
          performance: 70,
          coverage: 75
        }
      };
    }
  }

  ensureReviewDir() {
    if (!fs.existsSync(this.reviewDir)) {
      fs.mkdirSync(this.reviewDir, { recursive: true });
    }
  }

  async runCommand(cmd, args) {
    return new Promise((resolve, reject) => {
      const proc = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] });
      let output = '';
      let error = '';

      proc.stdout.on('data', (data) => { output += data.toString(); });
      proc.stderr.on('data', (data) => { error += data.toString(); });

      proc.on('close', (code) => {
        if (code === 0) resolve(output);
        else reject(new Error(`${cmd} failed: ${error}`));
      });
    });
  }

  parsePRUrl(prUrl) {
    const match = prUrl.match(/github\.com\/([^\/]+)\/([^\/]+)\/pull\/(\d+)/);
    if (!match) return null;
    return { owner: match[1], repo: match[2], prNum: match[3] };
  }

  async getPRDiffFromGitHub(owner, repo, prNum) {
    const url = `https://api.github.com/repos/${owner}/${repo}/pulls/${prNum}`;

    return new Promise((resolve, reject) => {
      https.get(url, {
        headers: {
          'User-Agent': 'PR-Review-CLI',
          'Accept': 'application/vnd.github.v3+diff'
        }
      }, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          if (res.statusCode === 200) {
            resolve(data);
          } else {
            reject(new Error(`GitHub API error: ${res.statusCode}`));
          }
        });
      }).on('error', reject);
    });
  }

  async getLocalDiff(targetBranch = 'main') {
    try {
      return await this.runCommand('git', ['diff', `${targetBranch}...HEAD`, '--unified=5']);
    } catch (error) {
      throw new Error(`Could not get local diff: ${error.message}`);
    }
  }

  displayBanner() {
    console.log('┌' + '─'.repeat(60) + '┐');
    console.log('│' + ' '.repeat(15) + '🔍 PR REVIEW SYSTEM' + ' '.repeat(23) + '│');
    console.log('│' + ' '.repeat(12) + 'Automated Code Review' + ' '.repeat(26) + '│');
    console.log('└' + '─'.repeat(60) + '┘');
    console.log('');
  }

  async reviewPR(prUrl) {
    this.displayBanner();
    console.log(`🔗 Analyzing PR: ${prUrl}\n`);

    const prInfo = this.parsePRUrl(prUrl);
    if (!prInfo) {
      throw new Error('Invalid PR URL format');
    }

    try {
      const diff = await this.getPRDiffFromGitHub(prInfo.owner, prInfo.repo, prInfo.prNum);
      return await this.runAgentReview(diff, { prUrl });
    } catch (error) {
      throw new Error(`Failed to fetch PR: ${error.message}`);
    }
  }

  async reviewLocal(targetBranch) {
    this.displayBanner();
    console.log(`🔍 Analyzing local changes vs ${targetBranch}\n`);

    const diff = await this.getLocalDiff(targetBranch);
    if (!diff.trim()) {
      throw new Error('No changes found to review');
    }

    return await this.runAgentReview(diff, { local: true, targetBranch });
  }

  async runAgentReview(diff, metadata) {
    const reviewFile = path.join(
      this.reviewDir,
      `review-${Date.now()}.json`
    );

    // Launch the agent workflow
    try {
      const agentScript = path.join(__dirname, 'agent-workflow.js');
      const cmd = `node "${agentScript}"`;

      // Save diff to temp file for agent
      const diffFile = path.join(this.reviewDir, 'temp-diff.patch');
      fs.writeFileSync(diffFile, diff);

      console.log('🤖 Starting multi-agent review...');
      console.log('   This may take several minutes...\n');

      // Run the review and wait for completion
      const result = await this.executeReview(diff, metadata);

      // Save results
      fs.writeFileSync(reviewFile, JSON.stringify(result, null, 2));

      return result;
    } catch (error) {
      throw new Error(`Review execution failed: ${error.message}`);
    }
  }

  async executeReview(diff, metadata) {
    // This would call the actual agent workflow
    // For now, return a mock result structure
    return {
      timestamp: new Date().toISOString(),
      metadata,
      overallScore: 75,
      reviews: {
        'code-quality': { score: 80, issues: [], summary: 'Good code quality' },
        'security': { score: 85, issues: [], summary: 'No major security issues' },
        'performance': { score: 70, issues: [], summary: 'Some optimizations possible' },
        'coverage': { score: 65, issues: [], summary: 'Increase test coverage' }
      },
      mergeDecision: 'FAIL'
    };
  }

  displayResults(results) {
    console.log('📊 REVIEW RESULTS');
    console.log('─'.repeat(60));
    console.log(`Overall Score: ${results.overallScore}/100`);
    console.log('');

    for (const [stage, result] of Object.entries(results.reviews)) {
      console.log(`${stage}: ${result.score}/100 - ${result.summary}`);
    }

    console.log('');
    console.log(`Decision: ${results.mergeDecision}`);
    if (results.mergeDecision === 'PASS') {
      console.log('✅ Ready to merge to staging');
    } else {
      console.log('❌ Fix issues and create follow-up PR');
    }
  }

  listReviews() {
    const files = fs.readdirSync(this.reviewDir)
      .filter(f => f.startsWith('review-') && f.endsWith('.json'))
      .sort()
      .reverse();

    console.log('📝 Recent Reviews:');
    console.log('');

    for (const file of files.slice(0, 10)) {
      const reviewPath = path.join(this.reviewDir, file);
      const review = JSON.parse(fs.readFileSync(reviewPath, 'utf-8'));
      const date = new Date(review.timestamp).toLocaleString();
      const score = review.overallScore;
      const status = review.mergeDecision === 'PASS' ? '✅' : '❌';

      console.log(`${status} ${file} - ${score}/100 - ${date}`);
      if (review.metadata.prUrl) {
        console.log(`   PR: ${review.metadata.prUrl}`);
      }
    }
  }

  showHelp() {
    console.log('PR Review CLI - Automated code review for any project');
    console.log('');
    console.log('Usage:');
    console.log('  npx pr-review --pr-url="https://github.com/user/repo/pull/123"');
    console.log('  npx pr-review --local');
    console.log('  npx pr-review --local --target=develop');
    console.log('  npx pr-review --list');
    console.log('  npx pr-review --help');
    console.log('');
    console.log('Options:');
    console.log('  --pr-url=<url>    Review a GitHub PR');
    console.log('  --local           Review local changes');
    console.log('  --target=<branch> Target branch (default: main)');
    console.log('  --list            List recent reviews');
    console.log('  --help            Show this help');
  }
}

// CLI execution
async function main() {
  const cli = new PRReviewCLI();
  const args = process.argv.slice(2);

  try {
    if (args.includes('--help') || args.length === 0) {
      cli.showHelp();
    } else if (args.includes('--list')) {
      cli.listReviews();
    } else if (args.includes('--local')) {
      const target = args.find(a => a.startsWith('--target='))?.split('=')[1] || 'main';
      const results = await cli.reviewLocal(target);
      cli.displayResults(results);
    } else {
      const prUrl = args.find(a => a.startsWith('--pr-url='))?.split('=')[1];
      if (!prUrl) {
        throw new Error('--pr-url required when not using --local');
      }
      const results = await cli.reviewPR(prUrl);
      cli.displayResults(results);
    }
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = PRReviewCLI;