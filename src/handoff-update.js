// Progressive handoff checkpointing - update HANDOFF.md with workflow progress.

function splitSections(markdown) {
  const lines = String(markdown || "").split(/\r?\n/);
  const firstHeading = lines.findIndex((line) => line.startsWith("## "));
  const preamble = firstHeading === -1 ? lines : lines.slice(0, firstHeading);
  const sections = [];

  for (let i = firstHeading === -1 ? lines.length : firstHeading; i < lines.length;) {
    const heading = lines[i];
    let end = i + 1;
    while (end < lines.length && !lines[end].startsWith("## ")) end += 1;
    sections.push({ heading, content: lines.slice(i + 1, end) });
    i = end;
  }
  return { preamble, sections };
}

function sectionName(section) {
  return section.heading.slice(3).trim().toLowerCase();
}

function findSection(sections, names) {
  const wanted = new Set(names.map((name) => name.toLowerCase()));
  return sections.find((section) => wanted.has(sectionName(section))) || null;
}

function ensureSection(sections, heading) {
  const existing = findSection(sections, [heading]);
  if (existing) return existing;
  const created = { heading: `## ${heading}`, content: [] };
  sections.push(created);
  return created;
}

function sectionContent(lines) {
  return ["", ...lines, ""];
}

function renderSections({ preamble, sections }) {
  const lines = [...preamble];
  for (const section of sections) lines.push(section.heading, ...section.content);
  return `${lines.join("\n").replace(/\n+$/, "")}\n`;
}

function meaningfulLines(section) {
  return section.content
    .map((line) => line.trim())
    .filter((line) => line && !/^(?:-\s+)?_\([^)]+\)_$/.test(line));
}

export function updateProgressSection(handoffMarkdown, { message, timestamp, updateNumber, phase, next, files, workItem, reviewRevision, attemptId }) {
  const parsed = splitSections(handoffMarkdown);

  if (timestamp) {
    ensureSection(parsed.sections, "Last updated").content = sectionContent([
      new Date(timestamp).toISOString(),
    ]);
  }

  if (Number.isSafeInteger(updateNumber) && updateNumber > 0) {
    ensureSection(parsed.sections, "Update number").content = sectionContent([String(updateNumber)]);
  }

  if (phase) {
    ensureSection(parsed.sections, "Current phase").content = sectionContent([phase]);
  }

  if (workItem) ensureSection(parsed.sections, "Work item").content = sectionContent([workItem]);
  if (reviewRevision) ensureSection(parsed.sections, "Review revision").content = sectionContent([reviewRevision]);
  if (attemptId) ensureSection(parsed.sections, "Attempt ID").content = sectionContent([attemptId]);

  const lastAction = findSection(parsed.sections, ["Last action"]);
  if (lastAction) {
    const timestampStr = timestamp ? ` (${new Date(timestamp).toLocaleString()})` : "";
    lastAction.content = sectionContent([`${message}${timestampStr}`]);
  }

  let completed = findSection(parsed.sections, ["Completed", "Completed steps"]);
  if (!completed) completed = ensureSection(parsed.sections, "Completed");
  const completedItems = meaningfulLines(completed)
    .filter((line) => line.startsWith("- "));
  const completedEntry = `- ${message}`;
  if (!completedItems.includes(completedEntry)) completedItems.push(completedEntry);
  completed.content = sectionContent(completedItems);

  const changedFiles = (files || []).map((file) => String(file).trim()).filter(Boolean);
  if (changedFiles.length) {
    let changed = findSection(parsed.sections, ["Changed files"]);
    if (!changed) changed = ensureSection(parsed.sections, "Changed files");
    const existing = meaningfulLines(changed)
      .filter((line) => line.startsWith("- "))
      .map((line) => line.slice(2).trim());
    const merged = [...new Set([...existing, ...changedFiles])];
    changed.content = sectionContent(merged.map((file) => `- ${file}`));
  }

  if (next) {
    ensureSection(parsed.sections, "Exact next action").content = sectionContent([next]);
  }

  return renderSections(parsed);
}

export function parseCurrentHandoff(handoffMarkdown) {
  const { sections } = splitSections(handoffMarkdown);
  const currentPhase = findSection(sections, ["Current phase"]);
  const objective = findSection(sections, ["Objective"]);
  const lastAction = findSection(sections, ["Last action"]);
  const completed = findSection(sections, ["Completed", "Completed steps"]);
  const changed = findSection(sections, ["Changed files"]);
  const next = findSection(sections, ["Exact next action"]);
  const lastUpdated = findSection(sections, ["Last updated"]);
  const workItem = findSection(sections, ["Work item"]);
  const reviewRevision = findSection(sections, ["Review revision"]);
  const updateNumber = findSection(sections, ["Update number"]);
  const firstValue = (section) => section ? meaningfulLines(section)[0] || null : null;
  const bulletValues = (section) => section
    ? meaningfulLines(section).filter((line) => line.startsWith("- ")).map((line) => line.slice(2).trim())
    : [];

  return {
    objective: firstValue(objective),
    currentPhase: firstValue(currentPhase),
    lastAction: firstValue(lastAction),
    completedSteps: bulletValues(completed),
    changedFiles: bulletValues(changed),
    nextAction: firstValue(next),
    lastUpdated: firstValue(lastUpdated),
    workItem: firstValue(workItem),
    reviewRevision: firstValue(reviewRevision),
    attemptId: firstValue(findSection(sections, ["Attempt ID"])),
    updateNumber: Number.parseInt(firstValue(updateNumber) || "", 10) || null,
  };
}

// The canonical handoff is read first by every session, so record-progress
// keeps only the newest entries of its growing lists. Trimmed entries are
// returned for the append-only history file; nothing is discarded.
export const CANONICAL_LIST_LIMIT = 10;
const COMPACTED_LISTS = [["Completed", "Completed steps"], ["Changed files"]];

export function compactProgressLists(handoffMarkdown, historyPath, limit = CANONICAL_LIST_LIMIT) {
  const parsed = splitSections(handoffMarkdown);
  const archived = {};
  for (const names of COMPACTED_LISTS) {
    const section = findSection(parsed.sections, names);
    if (!section) continue;
    const items = meaningfulLines(section).filter((line) => line.startsWith("- "));
    if (items.length <= limit) continue;
    archived[names[0]] = items.slice(0, items.length - limit);
    section.content = sectionContent(items.slice(-limit));
  }
  if (!Object.keys(archived).length) return { markdown: handoffMarkdown, archived };
  ensureSection(parsed.sections, "History").content = sectionContent([
    `Older entries are kept in full, oldest first: ${historyPath}`,
  ]);
  return { markdown: renderSections(parsed), archived };
}

// Appends archived entries to the history file, skipping any it already holds
// so a replayed checkpoint cannot duplicate them.
export function mergeProgressHistory(historyMarkdown, archived) {
  const parsed = splitSections(historyMarkdown || "# DIRF handoff history\n\nEntries trimmed from the canonical HANDOFF.md, oldest first.\n");
  for (const [name, entries] of Object.entries(archived)) {
    const section = ensureSection(parsed.sections, name);
    const items = meaningfulLines(section).filter((line) => line.startsWith("- "));
    const seen = new Set(items);
    for (const entry of entries) if (!seen.has(entry)) { items.push(entry); seen.add(entry); }
    section.content = sectionContent(items);
  }
  return renderSections(parsed);
}

export function historyEntries(historyMarkdown, name) {
  const section = findSection(splitSections(historyMarkdown || "").sections, [name]);
  return section ? meaningfulLines(section).filter((line) => line.startsWith("- ")).map((line) => line.slice(2).trim()) : [];
}
