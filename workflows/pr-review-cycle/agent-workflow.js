#!/usr/bin/env node
/**
 * Multi-Agent PR Review System
 *
 * Uses specialized agents for comprehensive PR review with confidence scoring
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

class AgentReviewSystem {
  constructor(options = {}) {
    this.projectPath = options.projectPath || process.cwd();
    this.prUrl = options.prUrl;
    this.branch = options.branch || 'HEAD';
    this.targetBranch = options.targetBranch || 'main';
    this.thresholds = options.thresholds || {
      confidence: 80,
      security: 90,
      performance: 70,
      coverage: 75
    };
    this.agents = {
      'code-quality': {
        name: 'Code Quality Agent',
        model: 'claude-opus-5',
        expertise: ['architecture', 'clean-code', 'design-patterns', 'error-handling']
      },
      'security': {
        name: 'Security Agent',
        model: 'claude-opus-5',
        expertise: ['owasp-top-10', 'authentication', 'authorization', 'input-validation', 'secrets-management']
      },
      'performance': {
        name: 'Performance Agent',
        model: 'claude-opus-5',
        expertise: ['algorithm-optimization', 'database-queries', 'caching', 'resource-usage']
      },
      'coverage': {
        name: 'Test Coverage Agent',
        model: 'claude-sonnet-5',
        expertise: ['unit-testing', 'integration-testing', 'edge-cases', 'test-quality']
      }
    };
  }

  // Get PR diff
  async getDiff() {
    return new Promise((resolve, reject) => {
      const git = spawn('git', ['diff', `${this.targetBranch}...${this.branch}`, '--unified=5'], {
        cwd: this.projectPath,
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let output = '';
      let error = '';

      git.stdout.on('data', (data) => { output += data.toString(); });
      git.stderr.on('data', (data) => { error += data.toString(); });

      git.on('close', (code) => {
        if (code === 0 && output) {
          resolve(output);
        } else {
          reject(new Error(`Git diff failed: ${error || 'No diff found'}`));
        }
      });
    });
  }

  // Spawn a specialized review agent
  async spawnAgent(stage, diff) {
    const agent = this.agents[stage];
    const prompts = {
      'code-quality': this.getQualityPrompt(diff),
      'security': this.getSecurityPrompt(diff),
      'performance': this.getPerformancePrompt(diff),
      'coverage': this.getCoveragePrompt(diff)
    };

    return new Promise((resolve, reject) => {
      const claude = spawn('claude', ['agent', '--model', agent.model, '--agent', agent.name.toLowerCase().replace(' ', '-')], {
        cwd: this.projectPath,
        stdio: ['pipe', 'pipe', 'pipe']
      });

      const prompt = prompts[stage];
      claude.stdin.write(prompt);
      claude.stdin.end();

      let output = '';
      let error = '';

      claude.stdout.on('data', (data) => { output += data.toString(); });
      claude.stderr.on('data', (data) => { error += data.toString(); });

      claude.on('close', (code) => {
        if (code === 0) {
          try {
            const result = this.parseAgentResponse(output, stage);
            resolve(result);
          } catch (e) {
            reject(new Error(`Failed to parse ${stage} agent response: ${e.message}`));
          }
        } else {
          reject(new Error(`${stage} agent failed: ${error}`));
        }
      });

      // Timeout after 5 minutes
      setTimeout(() => {
        claude.kill();
        reject(new Error(`${stage} agent timeout after 5 minutes`));
      }, 5 * 60 * 1000);
    });
  }

  getQualityPrompt(diff) {
    return `You are a code quality expert. Review this diff for:

1. Architecture & design patterns
2. Code organization & readability
3. Error handling & edge cases
4. Documentation completeness
5. Performance considerations

Analyze this diff:
${diff}

Return ONLY valid JSON:
{
  "score": number (0-100),
  "issues": [
    {
      "severity": "blocking|suggestion",
      "file": string,
      "line": number,
      "message": string (50 chars max),
      "code": string (relevant snippet),
      "score": number (0-100),
      "fix": string (suggested fix)
    }
  ],
  "summary": string (100 chars max),
  "strengths": string[],
  "concerns": string[]
}`;
  }

  getSecurityPrompt(diff) {
    return `You are a security expert. Review this diff for vulnerabilities:

1. OWASP Top 10 (injection, broken auth, XSS, etc.)
2. Input validation & sanitization
3. Authentication & authorization flaws
4. Secret/credential exposure
5. Dependency vulnerabilities
6. Access control issues

Analyze this diff:
${diff}

Return ONLY valid JSON:
{
  "score": number (0-100),
  "issues": [
    {
      "severity": "critical|high|medium|low",
      "cve": string (if applicable),
      "file": string,
      "line": number,
      "message": string (50 chars max),
      "code": string (relevant snippet),
      "score": number (0-100),
      "fix": string (suggested fix),
      "references": string[] (security standards, OWASP, etc.)
    }
  ],
  "summary": string (100 chars max),
  "compliance": boolean (meets security standards)
}`;
  }

  getPerformancePrompt(diff) {
    return `You are a performance expert. Review this diff for issues:

1. Algorithm efficiency (Big O)
2. Resource usage (memory, CPU, I/O)
3. Database query optimization (N+1 problems)
4. Caching opportunities
5. Scalability concerns

Analyze this diff:
${diff}

Return ONLY valid JSON:
{
  "score": number (0-100),
  "issues": [
    {
      "severity": "blocking|suggestion",
      "file": string,
      "line": number,
      "message": string (50 chars max),
      "code": string (relevant snippet),
      "score": number (0-100),
      "impact": string (performance impact),
      "fix": string (optimization suggestion)
    }
  ],
  "summary": string (100 chars max),
  "optimizations": string[]
}`;
  }

  getCoveragePrompt(diff) {
    return `You are a test coverage expert. Review this diff for:

1. Unit test coverage percentage
2. Missing edge cases
3. Integration test presence
4. Mock/stub appropriateness
5. Test clarity and maintainability

Analyze this diff:
${diff}

Return ONLY valid JSON:
{
  "score": number (0-100),
  "coverage": number (estimated percentage),
  "issues": [
    {
      "severity": "blocking|suggestion",
      "file": string,
      "function": string,
      "message": string (50 chars max),
      "score": number (0-100),
      "test": string (suggested test case)
    }
  ],
  "summary": string (100 chars max),
  "missingTests": string[]
}`;
  }

  parseAgentResponse(response, stage) {
    try {
      // Extract JSON from response
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in agent response');
      }
      return JSON.parse(jsonMatch[0]);
    } catch (error) {
      // Fallback response if parsing fails
      return {
        score: 50,
        issues: [],
        summary: `Agent response parsing failed: ${error.message}`,
        stage
      };
    }
  }

  // Run all review agents in parallel
  async runAllReviews(diff) {
    const stages = Object.keys(this.agents);
    const reviews = {};

    // Run agents in parallel
    const promises = stages.map(stage =>
      this.spawnAgent(stage, diff)
        .then(result => { reviews[stage] = result; })
        .catch(error => {
          console.error(`❌ ${stage} agent failed:`, error.message);
          reviews[stage] = { score: 0, issues: [], summary: 'Agent failed' };
        })
    );

    await Promise.all(promises);
    return reviews;
  }

  // Calculate overall confidence score
  calculateOverallScore(reviews) {
    const weights = {
      'security': 0.3,      // Security is most important
      'code-quality': 0.3,  // Code quality is equally important
      'performance': 0.2,   // Performance matters
      'coverage': 0.2       // Test coverage validates the rest
    };

    let weightedSum = 0;
    let totalWeight = 0;

    for (const [stage, result] of Object.entries(reviews)) {
      const weight = weights[stage] || 0.25;
      weightedSum += result.score * weight;
      totalWeight += weight;
    }

    return Math.round(weightedSum / totalWeight);
  }

  // Format review results
  formatResults(reviews, overallScore) {
    const lines = [];

    lines.push('┌' + '─'.repeat(60) + '┐');
    lines.push('│' + ' '.repeat(20) + 'PR REVIEW RESULTS' + ' '.repeat(22) + '│');
    lines.push('└' + '─'.repeat(60) + '┘');
    lines.push('');
    lines.push(`Overall Confidence Score: ${overallScore}/100`);
    lines.push('');

    // Stage scores
    lines.push('Stage Scores:');
    for (const [stage, result] of Object.entries(reviews)) {
      const threshold = this.thresholds[stage.split('-')[0]] || 80;
      const status = result.score >= threshold ? '✅' : '❌';
      lines.push(`  ${status} ${stage}: ${result.score}/100 (threshold: ${threshold})`);
    }
    lines.push('');

    // Collect and categorize issues
    const allIssues = [];
    for (const [stage, result] of Object.entries(reviews)) {
      for (const issue of (result.issues || [])) {
        allIssues.push({ ...issue, stage });
      }
    }

    const critical = allIssues.filter(i => i.severity === 'critical' || i.severity === 'blocking');
    const suggestions = allIssues.filter(i => i.severity !== 'critical' && i.severity !== 'blocking');

    if (critical.length > 0) {
      lines.push(`🚫 CRITICAL ISSUES (${critical.length}):`);
      for (const issue of critical.slice(0, 10)) {
        lines.push(`  [${issue.stage.toUpperCase()}] ${issue.message} (${issue.score}/100)`);
        if (issue.file) lines.push(`    📁 ${issue.file}:${issue.line || '?'}`);
        if (issue.code) lines.push(`    Code: ${issue.code.substring(0, 50)}...`);
      }
      lines.push('');
    }

    if (suggestions.length > 0) {
      lines.push(`💡 SUGGESTIONS (${suggestions.length}):`);
      for (const issue of suggestions.slice(0, 10)) {
        lines.push(`  [${issue.stage.toUpperCase()}] ${issue.message} (${issue.score}/100)`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  // Run complete review cycle
  async runReview() {
    console.log('🚀 Starting Multi-Agent PR Review...\n');

    try {
      // Get the diff
      console.log('📊 Fetching PR diff...');
      const diff = await this.getDiff();
      console.log(`   Found ${diff.split('\n').length} lines of changes\n`);

      // Run all reviews
      console.log('🤖 Running review agents...');
      const reviews = await this.runAllReviews(diff);
      console.log('✅ All agents completed\n');

      // Calculate overall score
      const overallScore = this.calculateOverallScore(reviews);

      // Format and display results
      const results = this.formatResults(reviews, overallScore);
      console.log(results);

      // Determine merge decision
      const passesThreshold = overallScore >= this.thresholds.confidence;
      const passesSecurity = reviews.security?.score >= this.thresholds.security;
      const noCritical = !Object.values(reviews).some(r =>
        r.issues?.some(i => i.severity === 'critical' || i.severity === 'blocking')
      );

      const mergePass = passesThreshold && passesSecurity && noCritical;

      console.log('─'.repeat(60));
      if (mergePass) {
        console.log('✅ Review Result: PASS');
        console.log('🎉 PR is ready to merge to staging!');
      } else {
        console.log('❌ Review Result: FAIL');
        console.log(`   Confidence: ${overallScore}/${this.thresholds.confidence}`);
        console.log(`   Security: ${reviews.security?.score}/${this.thresholds.security}`);
        console.log('🔧 Next Action: Fix issues and create follow-up PR');
      }
      console.log('─'.repeat(60));

      // Save report
      const report = {
        timestamp: new Date().toISOString(),
        prUrl: this.prUrl,
        overallScore,
        reviews,
        mergeDecision: mergePass ? 'PASS' : 'FAIL',
        thresholds: this.thresholds
      };

      const reportPath = path.join(this.projectPath, '.pr-review-report.json');
      fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
      console.log(`\n📝 Report saved to: ${reportPath}`);

      return mergePass;

    } catch (error) {
      console.error('❌ Review failed:', error.message);
      throw error;
    }
  }
}

// CLI interface
async function main() {
  const args = process.argv.slice(2);
  const options = {
    projectPath: process.cwd(),
    prUrl: args.find(a => a.startsWith('--pr-url='))?.split('=')[1],
    branch: args.find(a => a.startsWith('--branch='))?.split('=')[1],
    targetBranch: args.find(a => a.startsWith('--target='))?.split('=')[1] || 'main'
  };

  const system = new AgentReviewSystem(options);

  try {
    const passed = await system.runReview();
    process.exit(passed ? 0 : 1);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = AgentReviewSystem;