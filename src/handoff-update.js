// Progressive handoff checkpointing - update HANDOFF.md with workflow progress
import { readFileSync, existsSync } from "node:fs";

export function updateProgressSection(handoffMarkdown, { message, timestamp, phase, next, files }) {
  const lines = handoffMarkdown.split(/\r?\n/);
  const updated = [];
  let inCurrentPhase = false;
  let inLastAction = false;
  let inCompleted = false;
  let inChangedFiles = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith("## Current phase")) {
      inCurrentPhase = true;
      updated.push(line);
      if (phase) {
        updated.push("");
        updated.push(phase);
      }
      continue;
    }

    if (inCurrentPhase && line.trim() !== "" && !line.startsWith("##")) {
      // Replace old phase content with new
      if (phase) continue;
      updated.push(line);
      inCurrentPhase = false;
      continue;
    }

    if (inCurrentPhase && line.match(/^_\([^)]+\)_$/)) {
      // Replace placeholder with actual phase
      if (phase) continue;
      updated.push(line);
      inCurrentPhase = false;
      continue;
    }

    if (line.startsWith("## Last action")) {
      inLastAction = true;
      updated.push(line);
      updated.push("");
      const timestampStr = timestamp ? ` (${new Date(timestamp).toLocaleString()})` : "";
      updated.push(`${message}${timestampStr}`);
      continue;
    }

    if (inLastAction && line.trim() === "") {
      // Skip old last action content
      inLastAction = false;
      updated.push(line);
      continue;
    }

    if (inLastAction && !line.startsWith("##")) {
      // Skip old last action lines
      continue;
    }

    if (line.startsWith("## Completed steps")) {
      inCompleted = true;
      updated.push(line);
      updated.push("");
      updated.push(`- ${message}`);
      continue;
    }

    if (inCompleted && line.startsWith("- ")) {
      updated.push(line);
      continue;
    }

    if (inCompleted && line.match(/^_\([^)]+\)_$/)) {
      // Skip placeholder if we have content
      continue;
    }

    if (inCompleted && line.startsWith("##")) {
      inCompleted = false;
    }

    if (line.startsWith("## Changed files")) {
      inChangedFiles = true;
      updated.push(line);
      updated.push("");
      for (const file of files || []) {
        updated.push(`- ${file}`);
      }
      continue;
    }

    if (inChangedFiles && line.startsWith("- ")) {
      // Skip old changed files
      continue;
    }

    if (inChangedFiles && line.match(/^_\([^)]+\)_$/)) {
      // Skip placeholder
      continue;
    }

    if (inChangedFiles && line.startsWith("##")) {
      inChangedFiles = false;
    }

    if (line.startsWith("## Exact next action")) {
      updated.push(line);
      updated.push("");
      updated.push(next);
      continue;
    }

    updated.push(line);
  }

  return updated.join("\n");
}

export function parseCurrentHandoff(handoffMarkdown) {
  const lines = handoffMarkdown.split(/\r?\n/);
  const state = {
    currentPhase: null,
    lastAction: null,
    completedSteps: [],
    changedFiles: [],
    nextAction: null
  };

  let currentSection = null;

  for (const line of lines) {
    if (line.startsWith("## Current phase")) {
      currentSection = "currentPhase";
      continue;
    }
    if (line.startsWith("## Last action")) {
      currentSection = "lastAction";
      continue;
    }
    if (line.startsWith("## Completed steps")) {
      currentSection = "completedSteps";
      continue;
    }
    if (line.startsWith("## Changed files")) {
      currentSection = "changedFiles";
      continue;
    }
    if (line.startsWith("## Exact next action")) {
      currentSection = "nextAction";
      continue;
    }
    if (line.startsWith("## ")) {
      currentSection = null;
      continue;
    }

    if (currentSection === "currentPhase" && line.trim() && !line.match(/^_\([^)]+\)_$/)) {
      state.currentPhase = line.trim();
    }
    if (currentSection === "lastAction" && line.trim() && !line.match(/^_\([^)]+\)_$/)) {
      state.lastAction = line.trim();
    }
    if (currentSection === "completedSteps" && line.startsWith("- ")) {
      state.completedSteps.push(line.slice(2).trim());
    }
    if (currentSection === "changedFiles" && line.startsWith("- ")) {
      state.changedFiles.push(line.slice(2).trim());
    }
    if (currentSection === "nextAction" && line.trim() && !line.match(/^_\([^)]+\)_$/)) {
      state.nextAction = line.trim();
    }
  }

  return state;
}
