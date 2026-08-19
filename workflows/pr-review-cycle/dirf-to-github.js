#!/usr/bin/env node
/**
 * DIRF Review to GitHub PR Poster
 * Takes DIRF review results and posts them to GitHub PRs
 */

const { execSync } = require('child_process');
const fs = require('fs');
const https = require('https');

class DIRFToGitHub {
  constructor(prUrl, projectName, attemptName) {
    this.prUrl = prUrl;
    this.projectName = projectName;
    this.attemptName = attemptName;
    this.githubToken = process.env.GITHUB_TOKEN;
  }

  getDIRFHandoff() {
    try {
      const handoff = execSync(
        `node src/cli.js state read-handoff --slug "${this.projectName}"`,
        { encoding: 'utf-8', cwd: '/path/to/amf-dirf' }
      );
      return handoff;
    } catch (error) {
      throw new Error(`Failed to get DIRF handoff: ${error.message}`);
    }
  }

  getDIRFAttempt() {
    try {
      const attempt = execSync(
        `node src/cli.js state get-attempt "${this.attemptName}" --slug "${this.projectName}"`,
        { encoding: 'utf-8', cwd: '/path/to/amf-dirf' }
      );
      return JSON.parse(attempt);
    } catch (error) {
      throw new Error(`Failed to get DIRF attempt: ${error.message}`);
    }
  }

  parsePRUrl(prUrl) {
    const match = prUrl.match(/github\.com\/([^\/]+)\/([^\/]+)\/pull\/(\d+)/);
    if (!match) return null;
    return { owner: match[1], repo: match[2], prNum: match[3] };
  }

  formatDIRFFindingsForGitHub(handoff, attempt) {
    let comment = `## 🔍 DIRF Automated PR Review Results\n\n`;

    // Add attempt info
    comment += `**Review Attempt:** ${this.attemptName}\n`;
    comment += `**Status:** ${attempt.lifecycle || 'In Progress'}\n`;
    comment += `**Reviewed:** ${new Date().toLocaleString()}\n\n`;

    // Parse the handoff for review findings
    const lines = handoff.split('\n');
    let currentSection = null;
    let findings = [];
    let completedSteps = [];

    for (const line of lines) {
      if (line.startsWith('## ')) {
        currentSection = line.replace('## ', '').trim();
        continue;
      }

      if (currentSection === 'Last action' || currentSection === 'Completed steps') {
        if (line.trim() && !line.startsWith('_(')) {
          if (currentSection === 'Completed steps') {
            completedSteps.push(line.replace(/^- /, '').trim());
          }
        }
      }

      // Look for review findings
      if (line.toLowerCase().includes('issue') ||
          line.toLowerCase().includes('found') ||
          line.toLowerCase().includes('concern') ||
          line.toLowerCase().includes('recommend')) {
        findings.push({
          section: currentSection,
          content: line.trim()
        });
      }
    }

    // Add completed steps
    if (completedSteps.length > 0) {
      comment += `### ✅ Review Steps Completed\n\n`;
      for (const step of completedSteps) {
        comment += `- ${step}\n`;
      }
      comment += `\n`;
    }

    // Add findings
    if (findings.length > 0) {
      comment += `### 🔍 Findings\n\n`;
      for (const finding of findings) {
        comment += `- **${finding.section}:** ${finding.content}\n`;
      }
      comment += `\n`;
    }

    // Add current phase
    const currentPhaseMatch = handoff.match(/## Current phase\s*\n([^\n]+)/);
    if (currentPhaseMatch) {
      comment += `### 📋 Current Phase\n\n`;
      comment += `${currentPhaseMatch[1].trim()}\n\n`;
    }

    // Add next action
    const nextActionMatch = handoff.match(/## Exact next action\s*\n([^\n]+)/);
    if (nextActionMatch) {
      comment += `### 🎯 Next Action\n\n`;
      comment += `${nextActionMatch[1].trim()}\n\n`;
    }

    // Add merge recommendation
    if (attempt.lifecycle === 'completed') {
      comment += `### ✅ Merge Recommendation\n\n`;
      comment += `This PR has completed the DIRF review workflow and is ready for merge.\n\n`;
    } else {
      comment += `### ⏳ Review Status\n\n`;
      comment += `This PR is still in review. Please complete the remaining steps before merging.\n\n`;
    }

    // Footer
    comment += `---\n`;
    comment += `*Powered by DIRF Automated Review System*\n`;
    comment += `*Update: ${new Date().toISOString()}*\n`;

    return comment;
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
          'User-Agent': 'DIRF-Review-System'
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

    console.log('🔍 Getting DIRF review findings...');
    const handoff = this.getDIRFHandoff();
    const attempt = this.getDIRFAttempt();

    console.log('📝 Formatting for GitHub...');
    const commentBody = this.formatDIRFFindingsForGitHub(handoff, attempt);

    console.log(`📤 Posting to GitHub PR: ${this.prUrl}`);
    const result = await this.postToGitHub(commentBody);

    console.log(`✅ Review posted successfully! Comment ID: ${result.id}`);
    return result;
  }
}

// CLI interface
async function main() {
  const args = process.argv.slice(2);
  const prUrl = args.find(a => a.startsWith('--pr-url='))?.split('=')[1];
  const project = args.find(a => a.startsWith('--project='))?.split('=')[1];
  const attempt = args.find(a => a.startsWith('--attempt='))?.split('=')[1];

  if (!prUrl || !project || !attempt) {
    console.error('Usage: node dirf-to-github.js --pr-url=<url> --project=<slug> --attempt=<name>');
    console.error('Example: node dirf-to-github.js --pr-url="https://github.com/gpb360/storytellers/pull/1171" --project=storytellers --attempt=pr-review-1171');
    process.exit(1);
  }

  try {
    const poster = new DIRFToGitHub(prUrl, project, attempt);
    await poster.postReview();
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = DIRFToGitHub;