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

export function updateProgressSection(handoffMarkdown, { message, timestamp, updateNumber, phase, next, files, workItem, reviewRevision }) {
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
    updateNumber: Number.parseInt(firstValue(updateNumber) || "", 10) || null,
  };
}
