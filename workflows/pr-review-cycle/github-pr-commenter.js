#!/usr/bin/env node
/**
 * GitHub PR Comment Poster
 * Posts professional PR review findings to GitHub PRs
 */

const { execSync } = require('child_process');
const fs = require('fs');
const https = require('https');

class GitHubPRCommenter {
  constructor(prUrl, reviewData) {
    this.prUrl = prUrl;
    this.reviewData = reviewData;
    this.githubToken = process.env.GITHUB_TOKEN;
  }

  parsePRUrl(prUrl) {
    const match = prUrl.match(/github\.com\/([^\/]+)\/([^\/]+)\/pull\/(\d+)/);
    if (!match) return null;
    return { owner: match[1], repo: match[2], prNum: match[3] };
  }

  formatProfessionalComment(reviewData) {
    const { overallScore, reviews, mergeDecision } = reviewData;

    let comment = `## 🔍 Automated PR Review Results\n\n`;
    comment += `### Overall Confidence Score: **${overallScore}/100**\n\n`;

    // Status badge
    const status = mergeDecision === 'PASS' ? '✅' : '❌';
    comment += `**Status: ${status} ${mergeDecision}**\n\n`;

    // Stage scores
    comment += `### Stage Breakdown\n\n`;
    comment += `| Stage | Score | Status | Notes |\n`;
    comment += `|-------|-------|--------|-------|\n`;

    for (const [stage, result] of Object.entries(reviews)) {
      const icon = result.score >= 80 ? '✅' : (result.score >= 70 ? '⚠️' : '❌');
      comment += `| ${stage} | ${result.score}/100 | ${icon} | ${result.summary} |\n`;
    }

    comment += `\n`;

    // Collect all issues
    const allIssues = [];
    for (const [stage, result] of Object.entries(reviews)) {
      if (result.issues && result.issues.length > 0) {
        for (const issue of result.issues) {
          allIssues.push({ ...issue, stage });
        }
      }
    }

    if (allIssues.length > 0) {
      const critical = allIssues.filter(i =>
        i.severity === 'critical' || i.severity === 'blocking' || i.severity === 'high'
      );
      const suggestions = allIssues.filter(i =>
        i.severity !== 'critical' && i.severity !== 'blocking' && i.severity !== 'high'
      );

      if (critical.length > 0) {
        comment += `### 🚫 Critical Issues (${critical.length})\n\n`;
        for (const issue of critical) {
          comment += `#### ${issue.score}/100 - [${issue.stage.toUpperCase()}] ${issue.message}\n\n`;
          if (issue.file) {
            comment += `**File:** \`${issue.file}${issue.line ? ':' + issue.line : ''}\`\n\n`;
          }
          if (issue.code) {
            comment += `**Code:**\n\`\`\`${this.detectLanguage(issue.file)}\n${issue.code}\n\`\`\`\n\n`;
          }
          if (issue.fix) {
            comment += `**Suggested Fix:** ${issue.fix}\n\n`;
          }
          if (issue.references && issue.references.length > 0) {
            comment += `**References:** ${issue.references.map(r => `[${r}]`).join(', ')}\n\n`;
          }
          comment += `---\n\n`;
        }
      }

      if (suggestions.length > 0) {
        comment += `### 💡 Suggestions (${suggestions.length})\n\n`;
        for (const issue of suggestions) {
          comment += `- **${issue.score}/100** - [${issue.stage.toUpperCase()}] ${issue.message}\n`;
          if (issue.file) comment += `  - 📁 \`${issue.file}${issue.line ? ':' + issue.line : ''}\`\n`;
          if (issue.fix) comment += `  - 💡 ${issue.fix}\n`;
          comment += `\n`;
        }
      }
    }

    // Recommendations
    if (mergeDecision === 'FAIL') {
      comment += `### 📋 Next Steps\n\n`;
      comment += `This PR requires attention before merging:\n\n`;
      comment += `1. Review and address the critical issues above\n`;
      comment += `2. Run the review again to verify fixes\n`;
      comment += `3. Ensure all scores meet the thresholds:\n`;
      comment += `   - Overall: ≥80/100\n`;
      comment += `   - Security: ≥90/100\n`;
      comment += `   - Performance: ≥70/100\n`;
      comment += `   - Coverage: ≥75/100\n\n`;
      comment += `When ready, the review will automatically pass and this PR can be merged.\n\n`;
    } else {
      comment += `### ✅ Ready to Merge\n\n`;
      comment += `This PR has passed all automated quality checks and is ready for merge!\n\n`;
    }

    // Footer
    comment += `---\n`;
    comment += `*Automated review by PR Review Cycle System*\n`;
    comment += `*Scores updated: ${new Date().toISOString()}*\n`;

    return comment;
  }

  detectLanguage(filename) {
    if (!filename) return 'javascript';
    const ext = filename.split('.').pop().toLowerCase();
    const languages = {
      'js': 'javascript', 'jsx': 'javascript',
      'ts': 'typescript', 'tsx': 'typescript',
      'py': 'python', 'rb': 'ruby',
      'go': 'go', 'rs': 'rust',
      'java': 'java', 'cpp': 'cpp', 'c': 'c',
      'cs': 'csharp', 'php': 'php',
      'sql': 'sql', 'sh': 'bash',
      'html': 'html', 'css': 'css',
      'json': 'json', 'yaml': 'yaml', 'yml': 'yaml'
    };
    return languages[ext] || 'javascript';
  }

  async postToGitHub(commentBody) {
    const prInfo = this.parsePRUrl(this.prUrl);
    if (!prInfo) {
      throw new Error('Invalid PR URL format');
    }

    const { owner, repo, prNum } = prInfo;
    const url = `https://api.github.com/repos/${owner}/${repo}/issues/${prNum}/comments`;

    return new Promise((resolve, reject) => {
      const postData = JSON.stringify({ body: commentBody });

      const options = {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.githubToken}`,
          'Content-Type': 'application/json',
          'User-Agent': 'PR-Review-System'
        }
      };

      const req = https.request(url, options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(JSON.parse(data));
          } else {
            reject(new Error(`GitHub API error: ${res.statusCode} - ${data}`));
          }
        });
      });

      req.on('error', reject);
      req.write(postData);
      req.end();
    });
  }

  async postReview() {
    if (!this.githubToken) {
      throw new Error('GITHUB_TOKEN environment variable required');
    }

    const commentBody = this.formatProfessionalComment(this.reviewData);
    console.log('Posting review to GitHub PR...');
    console.log(`PR: ${this.prUrl}`);

    const result = await this.postToGitHub(commentBody);
    console.log(`✅ Review posted successfully! Comment ID: ${result.id}`);
    return result;
  }
}

// CLI interface
async function main() {
  const args = process.argv.slice(2);
  const prUrl = args.find(a => a.startsWith('--pr-url='))?.split('=')[1];
  const reportFile = args.find(a => a.startsWith('--report='))?.split('=')[1];

  if (!prUrl || !reportFile) {
    console.error('Usage: node github-pr-commenter.js --pr-url=<url> --report=<json-file>');
    console.error('Example: node github-pr-commenter.js --pr-url="https://github.com/user/repo/pull/123" --report=.pr-review-report.json');
    process.exit(1);
  }

  try {
    const reviewData = JSON.parse(fs.readFileSync(reportFile, 'utf-8'));
    const commenter = new GitHubPRCommenter(prUrl, reviewData);
    await commenter.postReview();
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = GitHubPRCommenter;