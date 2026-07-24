// Renders workflow Markdown and its self-contained HTML view.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { AGENTS_DIR, ROOT } from "./paths.js";

const GOVERNANCE_MARKER = "<!-- governance:v1 -->";
const FM_RE = /^([A-Za-z0-9_-]+):\s*(.*)$/;
export const FOCUSED_OUTPUT_RULES = [
  "Lead with the result or current state.",
  "Include concrete validation evidence.",
  "Keep lists to five relevant items or fewer.",
  "State failures plainly and name the affected step.",
  "End with exactly one next action, or `Complete`.",
];

function usesFocusedOutput(workflow) {
  return workflow.focused_output !== false;
}

function assertSnapshot(workflow) {
  if (![2, 3, 4, 5].includes(workflow.schema_version)) throw new Error(`workflow ${workflow.name || "?"}: unsupported schema_version`);
  if (!workflow.skill_flow?.steps) throw new Error(`workflow ${workflow.name || "?"}: missing persisted skill_flow`);
}

function executionHandoff() {
  return "Open the target repository in your current host. Load this README.md as the operating workflow and execute the task.";
}

export function kickoffPrompt(workflow) {
  // A self-contained prompt anyone can paste into the model of their choice to
  // execute this instruction set — including chat models with no file access.
  const wf = workflow.workflow || {};
  const agents = (workflow.agents || []).map((a) => a.name).filter(Boolean);
  const phases = wf.phases || [];
  const repo = workflow.repository;
  const repoLine = repo
    ? `Repository: ${repo.remote || repo.name}${repo.remote && repo.name ? ` (${repo.name})` : ""} — all work happens inside this repository. Clone or open it before starting; if you cannot access it, say so and ask for the relevant files instead of guessing.`
    : "Repository: not recorded — ask which repository this task targets and open it before starting.";
  const lines = [
    `You are executing the "${workflow.name || workflow.playbook || "workflow"}" DIRF workflow.`,
    "",
    `Task: ${workflow.task || "(ask for the task before starting)"}`,
    "",
    repoLine,
    "",
    "Operating rules:",
    "1. The instruction set's README.md is the authoritative router; each agent role has a detail file under agents/. If you can read files, load ONLY the file for the role you are acting as. If you cannot, ask for it to be pasted before acting as that role.",
    `2. Act as one agent at a time${agents.length ? ` (roster: ${agents.join(", ")})` : ""}. Respect each agent's NOT YOUR JOB boundary — hand off instead of expanding scope.${
      (workflow.agents || []).some((a) => a.status === "fallback")
        ? " Roles marked as bundled defaults in the roster had no installed agent on this host — confirm with the user before acting as them."
        : ""}`,
    `3. Work the phases in order${phases.length ? `: ${phases.join(" -> ")}` : ""}. Do not start the next phase until the current one is verifiably done. Validation: ${wf.validation || "state your evidence"}.`,
    `4. Done means: ${wf.output || "the task's outcome is verified"}. Report evidence, not claims.`,
  ];
  let nextRule = 5;
  if (wf.requirements?.length) lines.push(`${nextRule++}. Required acceptance contract: ${wf.requirements.join(" | ")}`);
  lines.push(`${nextRule++}. When your context is nearly exhausted, write a handoff note (completed work, decisions, changed files, validation, blockers, exact next action) and stop.`);
  if (usesFocusedOutput(workflow)) {
    lines.push(`${nextRule}. For status updates, validation summaries, and handoffs: ${FOCUSED_OUTPUT_RULES.join(" ")} This does not constrain task-specific or creative output.`);
  }
  lines.push("", `Begin with phase 1${phases[0] ? `: ${phases[0]}` : ""}.`);
  return lines.join("\n");
}

// --------------------------------------------------------------------------- //
// Agent markdown parsing
// --------------------------------------------------------------------------- //
export function parseAgentMd(path) {
  // Parse an agent .md into { frontmatter, body, governance }.
  // Tolerant: the frontmatter field set varies across agents. Separates the
  // trailing governance boilerplate block so it can be rendered once.
  const text = readFileSync(path, "utf-8");
  const frontmatter = {};
  let body = text;
  if (text.startsWith("---\n")) {
    const end = text.indexOf("\n---", 4);
    if (end !== -1) {
      for (const line of text.slice(4, end).split(/\r?\n/)) {
        const m = FM_RE.exec(line);
        if (m) frontmatter[m[1]] = m[2].trim();
      }
      body = text.slice(end + 4).replace(/^\r?\n/, "");
    }
  }

  let governance = "";
  const marker = body.indexOf(GOVERNANCE_MARKER);
  if (marker !== -1) {
    governance = body.slice(marker).trim();
    body = body.slice(0, marker).replace(/\s+$/, "");
  }

  return { frontmatter, body: body.trim(), governance: governance.trim() };
}

// --------------------------------------------------------------------------- //
// Markdown-lite -> HTML (only what agent markdowns contain)
// --------------------------------------------------------------------------- //
export function renderMarkdownLite(text) {
  // Focused line-based HTML for the subset agent markdowns actually use.
  // Supports: ATX headings, bold, inline code, ordered/unordered lists, fenced
  // code blocks, paragraphs. Strips HTML comments. ~deliberately small.
  const lines = (text || "").split(/\r?\n/);
  const out = [];
  let inCode = false;
  let listOpen = null;

  const closeList = () => {
    if (listOpen) {
      out.push(`</${listOpen}>`);
      listOpen = null;
    }
  };

  for (const line of lines) {
    if (line.trim().startsWith("```")) {
      if (inCode) {
        out.push("</code></pre>");
        inCode = false;
      } else {
        closeList();
        out.push("<pre><code>");
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      out.push(escapeHtml(line));
      continue;
    }

    const stripped = line.trim();
    if (stripped.startsWith("<!--") && stripped.endsWith("-->")) continue;
    if (!stripped) {
      closeList();
      continue;
    }

    const hm = /^(#{1,4})\s+(.*)$/.exec(stripped);
    if (hm) {
      closeList();
      const level = hm[1].length + 1;
      out.push(`<h${level}>${inline(hm[2])}</h${level}>`);
      continue;
    }
    const om = /^(\d+)\.\s+(.*)$/.exec(stripped);
    if (om) {
      if (listOpen !== "ol") {
        closeList();
        out.push("<ol>");
        listOpen = "ol";
      }
      out.push(`<li>${inline(om[2])}</li>`);
      continue;
    }
    const um = /^[-*]\s+(.*)$/.exec(stripped);
    if (um) {
      if (listOpen !== "ul") {
        closeList();
        out.push("<ul>");
        listOpen = "ul";
      }
      out.push(`<li>${inline(um[1])}</li>`);
      continue;
    }
    closeList();
    out.push(`<p>${inline(stripped)}</p>`);
  }

  if (inCode) out.push("</code></pre>");
  closeList();
  return out.join("\n");
}

function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function inline(text) {
  // Inline formatting: bold, inline code. Escapes everything else.
  const placeholders = [];
  const stash = (_m, g1) => {
    placeholders.push(`<code>${escapeHtml(g1)}</code>`);
    return `\x00${placeholders.length - 1}\x00`;
  };
  let safe = escapeHtml(text);
  safe = safe.replace(/`([^`]+)`/g, stash);
  safe = safe.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  safe = safe.replace(/\x00(\d+)\x00/g, (_m, i) => placeholders[Number(i)]);
  return safe;
}

// --------------------------------------------------------------------------- //
// Lean markdown instruction set (router + per-agent detail)
// --------------------------------------------------------------------------- //
export function buildInstructions(workflow, outDir) {
  assertSnapshot(workflow);
  // Write a lean instruction set: README.md router + per-agent detail files.
  // Returns the list of written file paths. Discovery is scoped to the
  // workflow's --path target if set, so skill mapping reflects the target project.
  const agentsSub = join(outDir, "agents");
  mkdirSync(agentsSub, { recursive: true });

  const task = workflow.task || "";
  const playbook = workflow.playbook || "";
  const wf = workflow.workflow || {};
  const agents = workflow.agents || [];
  const flow = workflow.skill_flow;
  const written = [];
  const skillUnits = (flow?.steps || []).map((step, index) => ({
    ...step,
    folder: `${String(index + 1).padStart(2, "0")}-${String(step.skill).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "capability"}`,
  }));

  const lines = [
    "---",
    `name: ${workflow.name || playbook}`,
    "kind: workflow",
    `description: ${JSON.stringify(task)}`,
    'uses: ["playbook"]',
    `details: ${JSON.stringify(agents.map((agent) => `agents/${agent.name}.md`))}`,
    `inputs: ${JSON.stringify(["task", "target repository"])}`,
    `outputs: ${JSON.stringify([wf.output || "verified result"])}`,
    `capabilities: ${JSON.stringify((flow?.steps || []).map((step) => step.capability).filter(Boolean))}`,
    "---",
    "",
    `# Instruction Set — ${workflow.name || playbook}`,
    "",
    "## Objective",
    task,
    "",
    "## Next step",
    executionHandoff(),
    "",
    "## Kickoff prompt (copy into your model of choice)",
    "",
    "```text",
    kickoffPrompt(workflow),
    "```",
    "",
    "## Context reserve",
    `Keep ${workflow.context_reserve_percent ?? 5}% of the model context available for handoff. When the host reports that reserve or less, update HANDOFF.md with completed work, decisions, changed files, validation, blockers, and the exact next action, then stop. If the host does not expose context usage, update HANDOFF.md after every completed phase.`,
  ];
  if (usesFocusedOutput(workflow)) {
    lines.push("", "## Focused output", "", "For status updates, validation summaries, and handoffs:");
    for (const rule of FOCUSED_OUTPUT_RULES) lines.push(`- ${rule}`);
    lines.push("", "Task-specific and creative output is unchanged.");
  }
  lines.push(
    "",
    "Runtime paths belong to this execution only. If isolation is needed, place worktrees beside the target repository or under the user-configured worktree root. Select a scratch directory inside that workspace; do not fall back to another drive or the operating-system temp directory.",
    "",
    "## Definition of Done",
    wf.output || "_(no output contract declared)_",
    "",
  );
  if (wf.requirements?.length) {
    lines.push("## Required acceptance contract", "");
    for (const requirement of wf.requirements) lines.push(`- ${requirement}`);
    lines.push("");
  }
  lines.push("## Phases", "");
  let i = 0;
  for (const phase of wf.phases || []) {
    i += 1;
    lines.push(`${i}. ${phase}`);
  }
  if (workflow.lifecycle) {
    lines.push("", "## Idea to ship", "");
    for (const [stage, guidance] of Object.entries(workflow.lifecycle)) lines.push(`- **${stage}:** ${guidance}`);
  }
  if (workflow.questions?.length) {
    lines.push("", "## Open questions (settle with the user before starting)", "");
    for (const q of workflow.questions) lines.push(`- ${q}`);
  }
  lines.push(
    "",
    `> Do not start the next phase until the current one is verifiably done. Validation: ${wf.validation || "_(none declared)_"}`,
    "",
    "## Agent roster (load a detail file only when you act as that agent)",
    "",
  );
  const fallbackRoles = agents.filter((a) => a.status === "fallback");
  if (fallbackRoles.length) {
    lines.push(
      fallbackRoles.length === agents.length
        ? "> ⚠️ No installed agents were found on this host, so every role below uses a DIRF bundled default. Confirm with the user before acting as them, or swap in the user's own agents."
        : "> ⚠️ Roles marked *bundled default* had no matching installed agent on this host. Confirm with the user before acting as them, or swap in the user's own agents.",
      "",
    );
  }
  for (const a of agents) {
    const slug = a.name || "agent";
    const origin = a.status === "installed"
      ? ` — installed agent \`${a.matched || slug}\``
      : a.status === "fallback" ? " — *bundled default*" : "";
    lines.push(`- [${slug}](agents/${slug}.md) — ${(a.tags || []).join(", ")}${origin}`);
  }
  lines.push(
    "",
    "## Capabilities",
    "DIRF selected the best installed capability for each stage. Resolve each capability by name in the current host; provider values in the snapshot are discovery hints, not runtime requirements. Absent capabilities are never placed in the executable flow.",
    "",
    "## Skill flow",
    "Reach for skills in this order — each has a reason for its place in the sequence:",
    "",
  );
  if (!flow?.steps) throw new Error(`workflow ${workflow.name || "?"}: missing persisted skill_flow`);
  let lastStage = "";
  for (const s of flow.steps) {
    if (s.stage !== lastStage) { lines.push(`**${s.stage}**`); lastStage = s.stage; }
    const mark = s.status === "installed" ? "✅" : "⚠️";
    lines.push(`- ${mark} \`${s.skill}\` — ${s.reason}`);
  }
  if (flow.gaps?.length) {
    lines.push("", "## Capability gaps", "");
    for (const gap of flow.gaps) lines.push(`- **${gap.stage}:** ${gap.question}`);
  }
  lines.push(
    "",
    "## Policy",
    "Read [policy.md](policy.md) before editing.",
    "",
    "## If blocked",
    wf.recovery || "_(no recovery contract declared)_",
  );
  const readme = join(outDir, "README.md");
  writeFileSync(readme, lines.join("\n"), "utf-8");
  written.push(readme);

  const playbookDir = join(outDir, "playbook");
  mkdirSync(playbookDir, { recursive: true });
  const playbookReadme = join(playbookDir, "README.md");
  writeFileSync(playbookReadme, [
    "---", `name: ${playbook || "generated-playbook"}`, "kind: playbook",
    `description: ${JSON.stringify(workflow.playbook_description || task)}`,
    `uses: ${JSON.stringify(skillUnits.map((step) => `../skills/${step.folder}`))}`,
    "details: []", 'inputs: ["task"]', `outputs: ${JSON.stringify([wf.output || "verified result"])}`,
    `capabilities: ${JSON.stringify(skillUnits.map((step) => step.capability).filter(Boolean))}`,
    "---", "", `# ${playbook || "Generated playbook"}`, "", "Execute the ordered capability units, then verify the declared output.",
  ].join("\n"), "utf-8");
  written.push(playbookReadme);

  for (const step of skillUnits) {
    const skillDir = join(outDir, "skills", step.folder);
    mkdirSync(skillDir, { recursive: true });
    const skillReadme = join(skillDir, "README.md");
    writeFileSync(skillReadme, [
      "---", `name: ${JSON.stringify(step.skill)}`, "kind: skill", `description: ${JSON.stringify(step.reason)}`,
      "uses: []", "details: []", `inputs: ${JSON.stringify([step.stage])}`, 'outputs: ["stage result"]',
      `capabilities: ${JSON.stringify(step.capability ? [step.capability] : [])}`, "---", "",
      `# ${step.skill}`, "", step.reason,
    ].join("\n"), "utf-8");
    written.push(skillReadme);
  }

  const policySrc = resolve(ROOT, workflow.policy || "policies/workflow-policy.md");
  const policyDst = join(outDir, "policy.md");
  try {
    writeFileSync(policyDst, readFileSync(policySrc, "utf-8"), "utf-8");
    written.push(policyDst);
  } catch { /* policy missing — non-fatal */ }

  for (const a of agents) {
    written.push(writeAgentDetail(a, agentsSub));
  }
  return written;
}

function writeAgentDetail(agentRef, agentsSub) {
  const name = agentRef.name || "agent";
  const path = join(agentsSub, `${name}.md`);
  const agentMdPath = join(AGENTS_DIR, `${name}.md`);
  let parsed;
  try {
    parsed = parseAgentMd(agentMdPath);
  } catch {
    parsed = { body: "_(agent markdown missing)_", frontmatter: {} };
  }
  const fm = parsed.frontmatter;
  const tags = agentRef.tags || [];
  const resolved = agentRef.skills || [];

  const lines = [`# ${name}`, ""];
  if (tags.length) lines.push(`**Tags:** ${tags.join(", ")}`, "");
  // The bundled definition's tool list belongs to the fallback agent only —
  // for installed roles the host agent's own definition governs.
  if (fm.tools && agentRef.status !== "installed") lines.push(`**Tools:** ${fm.tools}`, "");

  lines.push("## Skills", "");
  lines.push("You can discover and invoke any installed skill (the host provides global skill lookup). These are relevance hints for your role — a starting point, not a limit:");
  lines.push("");
  if (resolved.length) {
    for (const s of resolved) {
      const mark = s.status === "installed" ? "✅" : "⚠️";
      const note = s.status === "installed" ? "" : " (recommended — not installed)";
      const summ = s.summary ? ` — ${s.summary}` : "";
      lines.push(`- ${mark} \`${s.name}\`${summ}${note}`);
    }
  } else {
    lines.push("_(no role-specific hints — use global skill discovery as needed)_");
  }
  if (agentRef.status === "installed") {
    // The host has its own agent for this role — point at it instead of
    // shipping the kit's bundled definition as if it were the user's.
    lines.push(
      "", "## Your job", "",
      `This role is filled by the installed agent \`${agentRef.matched || name}\`. Load its definition from the host's agent setup and act as it.`,
      ...(agentRef.matched_description ? ["", `> ${agentRef.matched_description}`] : []),
      "",
    );
  } else {
    if (agentRef.status === "fallback") {
      lines.push("", "> ⚠️ DIRF bundled default — no matching agent was installed on this host. Confirm with the user before acting as this agent, or swap in their own.");
    }
    lines.push("", "## Your job", "", parsed.body.trim() || "_(empty)_", "");
  }

  lines.push(
    "## Not your job",
    "",
    "Hand off to the matching agent rather than expanding scope. See the roster in [README.md](../README.md).",
    "",
  );
  lines.push(
    "## Done when",
    "",
    "- [ ] Your phase output is produced",
    "- [ ] Validation command passes",
    "- [ ] No scope creep into another agent's lane",
    "",
  );
  writeFileSync(path, lines.join("\n"), "utf-8");
  return path;
}

// --------------------------------------------------------------------------- //
// HTML render (same lean structure, collapsible for humans)
// --------------------------------------------------------------------------- //
const CSS = `
:root{--bg:#0f1115;--card:#171a21;--ink:#e6e8eb;--mute:#8b94a1;--accent:#7c5cff;--ok:#3fb950;--warn:#d29922;--line:#2a2f3a}
*{box-sizing:border-box}body{font:15px/1.55 -apple-system,Segoe UI,Roboto,sans-serif;background:var(--bg);color:var(--ink);margin:0;padding:32px 20px}
.wrap{max-width:920px;margin:0 auto}h1{font-size:26px;font-weight:600;margin:0 0 4px}
h2{font-size:18px;font-weight:600;margin:28px 0 10px;border-bottom:1px solid var(--line);padding-bottom:4px}
h3{font-size:15px;font-weight:600;color:var(--accent);margin:18px 0 6px}
p,li{color:#cdd2da}code{background:#0b0d12;border:1px solid var(--line);padding:1px 5px;border-radius:4px;font-size:13px}
pre{background:#0b0d12;border:1px solid var(--line);border-radius:6px;padding:12px;overflow:auto}
pre code{background:none;border:0;padding:0}.mute{color:var(--mute)}
.gate{border-left:3px solid var(--warn);background:rgba(210,153,34,.08);padding:8px 12px;margin:10px 0;border-radius:0 4px 4px 0}
.chip{display:inline-block;font-size:12px;padding:2px 8px;border-radius:10px;margin:0 4px 4px 0;border:1px solid var(--line)}
.chip.installed{color:var(--ok);border-color:rgba(63,185,80,.4)}.chip.recommended{color:var(--warn);border-color:rgba(210,153,34,.4)}
.chip.design{color:#a371f7}.chip.quality{color:#3fb950}.chip.security{color:#f85149}.chip.minimalism{color:#58a6ff}
details{background:var(--card);border:1px solid var(--line);border-radius:6px;padding:12px 16px;margin:8px 0}
summary{cursor:pointer;font-weight:600;font-size:16px}summary h3{display:inline;margin:0;color:var(--ink)}
.roster{list-style:none;padding:0}.roster li{padding:6px 0;border-bottom:1px solid var(--line)}
footer{margin-top:40px;padding-top:16px;border-top:1px solid var(--line);font-size:13px;color:var(--mute)}
`;

function chip(skill) {
  const status = skill.status || "recommended";
  const cat = skill.category || "";
  const classes = ["chip", status, cat].filter(Boolean).join(" ");
  const note = status === "installed" ? "" : " ⚠";
  return `<span class="${classes}">${escapeHtml(skill.name)}${note}</span>`;
}

export function buildHtml(workflow) {
  assertSnapshot(workflow);
  const wf = workflow.workflow || {};
  const agents = workflow.agents || [];
  const handoff = executionHandoff();

  const parts = [
    "<!doctype html><html><head><meta charset='utf-8'>",
    `<title>${escapeHtml(workflow.name || "")} — instruction set</title>`,
    `<style>${CSS}</style></head><body><div class='wrap'>`,
  ];

  parts.push(`<h1>${escapeHtml(workflow.name || "")}</h1>`);
  parts.push(`<p class='mute'>${escapeHtml(workflow.task || "")}</p>`);

  parts.push("<h2>Next step</h2>");
  parts.push(`<p>${escapeHtml(handoff)}</p>`);
  parts.push("<h2>Kickoff prompt</h2>");
  parts.push("<p class='mute'>Copy this into your model of choice to run the workflow. <button class='chip' onclick=\"navigator.clipboard.writeText(document.getElementById('kickoff').textContent).then(()=>{this.textContent='Copied ✓';})\">Copy prompt</button></p>");
  parts.push(`<pre id='kickoff'>${escapeHtml(kickoffPrompt(workflow))}</pre>`);
  parts.push("<p class='mute'>Runtime paths stay local to the current execution. Keep worktrees beside the target repository or in the configured worktree root, and select scratch space inside that workspace.</p>");
  if (usesFocusedOutput(workflow)) {
    parts.push("<h2>Focused output</h2><p>For status updates, validation summaries, and handoffs:</p><ul>");
    for (const rule of FOCUSED_OUTPUT_RULES) parts.push(`<li>${inline(rule)}</li>`);
    parts.push("</ul><p class='mute'>Task-specific and creative output is unchanged.</p>");
  }

  parts.push("<h2>Objective &amp; Definition of Done</h2>");
  parts.push(`<p>${escapeHtml(workflow.task || "")}</p>`);
  parts.push(`<p><strong>Done looks like:</strong> ${escapeHtml(wf.output || "—")}</p>`);

  if (wf.requirements?.length) {
    parts.push("<h2>Required acceptance contract</h2><ul>");
    for (const requirement of wf.requirements) parts.push(`<li>${escapeHtml(requirement)}</li>`);
    parts.push("</ul>");
  }

  parts.push("<h2>Phases</h2><ol>");
  for (const phase of wf.phases || []) parts.push(`<li>${escapeHtml(phase)}</li>`);
  parts.push("</ol>");

  if (workflow.lifecycle) {
    parts.push("<h2>Idea to ship</h2><ul>");
    for (const [stage, guidance] of Object.entries(workflow.lifecycle)) {
      parts.push(`<li><strong>${escapeHtml(stage)}:</strong> ${escapeHtml(guidance)}</li>`);
    }
    parts.push("</ul>");
  }

  if (workflow.questions?.length) {
    parts.push("<h2>Open questions</h2><p class='mute'>Settle these with the user before starting.</p><ul>");
    for (const q of workflow.questions) parts.push(`<li>${escapeHtml(q)}</li>`);
    parts.push("</ul>");
  }

  if (workflow.skill_flow.gaps?.length) {
    parts.push("<h2>Capability gaps</h2><ul>");
    for (const gap of workflow.skill_flow.gaps) parts.push(`<li><strong>${escapeHtml(gap.stage)}:</strong> ${escapeHtml(gap.question)}</li>`);
    parts.push("</ul>");
  }
  parts.push(`<div class='gate'>⛔ Do not start the next phase until the current is verifiably done. Validation: ${escapeHtml(wf.validation || "—")}</div>`);

  parts.push("<h2>Skill flow</h2><ol>");
  for (const step of workflow.skill_flow.steps) {
    const status = step.status === "installed" ? "installed" : "recommended";
    parts.push(`<li><span class='chip ${status}'>${escapeHtml(step.skill)}</span> ${escapeHtml(step.reason)}</li>`);
  }
  parts.push("</ol>");

  if (workflow.routing_facts?.length) {
    parts.push("<h2>Routing context</h2><ul>");
    for (const fact of workflow.routing_facts) parts.push(`<li>${escapeHtml(fact)}</li>`);
    parts.push("</ul>");
  }

  parts.push("<h2>Agent roster</h2>");
  parts.push("<p class='mute'>Click an agent to expand its detail, skills, and boundary.</p>");
  if (agents.some((a) => a.status === "fallback")) {
    parts.push("<p>⚠️ Roles marked <em>bundled default</em> had no matching installed agent on this host. DIRF uses its bundled definitions only as a backup — confirm before running them, or swap in your own agents.</p>");
  }
  for (const a of agents) {
    const name = a.name || "agent";
    let parsed;
    try {
      parsed = parseAgentMd(join(AGENTS_DIR, `${name}.md`));
    } catch {
      parsed = { body: "_(missing)_", frontmatter: {} };
    }
    const resolved = a.skills || [];
    const tags = (a.tags || []).join(", ");
    const origin = a.status === "installed"
      ? ` <span class='chip installed'>installed: ${escapeHtml(a.matched || name)}</span>`
      : a.status === "fallback" ? " <span class='chip recommended'>bundled default</span>" : "";
    parts.push("<details><summary>");
    parts.push(`${escapeHtml(name)} <span class='mute'>— ${escapeHtml(tags)}</span>${origin}`);
    parts.push("</summary>");
    parts.push("<h3>Skills</h3>");
    parts.push("<p class='mute'>Global skill discovery is available — these are relevance hints for this role, not a limit.</p><p>");
    parts.push(resolved.length ? resolved.map(chip).join("") : "<span class='mute'>no role-specific hints — use global discovery</span>");
    parts.push("</p>");
    parts.push("<h3>Your job</h3>");
    if (a.status === "installed") {
      parts.push(`<p>This role is filled by the installed agent <code>${escapeHtml(a.matched || name)}</code>. Load its definition from the host's agent setup.</p>`);
      if (a.matched_description) parts.push(`<p class='mute'>${escapeHtml(a.matched_description)}</p>`);
    } else {
      parts.push(renderMarkdownLite(parsed.body));
    }
    parts.push("<h3>Not your job</h3><p>Hand off to the matching agent rather than expanding scope.</p>");
    parts.push("</details>");
  }

  parts.push("<h2>If blocked</h2>");
  parts.push(`<div class='gate'>${escapeHtml(wf.recovery || "—")}</div>`);

  const sh = workflow.source_hashes || {};
  parts.push("<footer>");
  parts.push(`<p>schema_version ${workflow.schema_version || 1} · generated ${workflow.created_at || ""}</p>`);
  if (Object.keys(sh).length) {
    parts.push("<p><strong>Drift guard.</strong> If these no longer match the authoritative sources, rebuild the workflow to refresh routing and skills:</p>");
    parts.push("<pre><code>" + escapeHtml(Object.entries(sh).map(([k, v]) => `${k}: ${v}`).join("\n")) + "</code></pre>");
    parts.push("<p>Rebuild locally to refresh routing and capabilities.</p>");
  }
  parts.push("</footer></div></body></html>");
  return parts.join("");
}
