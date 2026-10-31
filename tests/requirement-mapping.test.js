import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  registerProject, createAttemptInStore, recordAttemptArtifact, acceptAttemptArtifact,
  recordProgress, readRequirementMapping, getAttempt, storeProjectDir, attemptSummary,
} from "../src/state.js";
import { parseCurrentHandoff } from "../src/handoff-update.js";

const moduleUrl = pathToFileURL(resolve("src/state.js")).href;
const scratch = resolve(".scratch/ne003-mapping");
mkdirSync(scratch, { recursive: true });
const digest = bytes => createHash("sha256").update(bytes).digest("hex");

function fixture(t, { acceptedPlan = true, planText = "# Plan\n\n## Requirements\n\n| ID | Requirement |\n| --- | --- |\n| R1 | Retain current evidence |\n| R2 | Keep acceptance explicit |\n" } = {}) {
  const oldHome = process.env.DIRF_HOME;
  const home = mkdtempSync(join(scratch, "home-"));
  process.env.DIRF_HOME = home;
  t.after(() => { if (oldHome === undefined) delete process.env.DIRF_HOME; else process.env.DIRF_HOME = oldHome; });
  const root = mkdtempSync(join(scratch, "repo-"));
  const { slug } = registerProject(root);
  const attempt = createAttemptInStore(slug, "mapping");
  writeFileSync(join(attempt.folder, "workflow.json"), JSON.stringify({ workflow: { phases: ["build", "verify", "post"] } }));
  mkdirSync(join(attempt.folder, "artifacts"));
  const addArtifact = (id, content, accepted = true, type = "implementation_evidence", supersedes = []) => {
    const path = `artifacts/${id}.md`;
    writeFileSync(join(attempt.folder, path), content);
    recordAttemptArtifact(slug, attempt.id, { id, type, path, supersedes });
    if (accepted) acceptAttemptArtifact(slug, attempt.id, id);
    return { artifact_id: id, sha256: digest(content) };
  };
  const plan = addArtifact("plan-v1", planText, acceptedPlan, "plan");
  const proof = addArtifact("proof-v1", "Verified first proof\n");
  const update = (overrides = {}) => ({ schema_version: 1, attempt_id: attempt.id, governing_plan: { ...plan },
    expected_revision: getAttempt(slug, attempt.id).requirement_mapping?.revision ?? 0,
    requirements: [{ requirement_id: "R1", decision_ref: { ...plan }, work_state: "complete", proof_refs: [{ ...proof }] }], ...overrides });
  const progress = (requirementUpdate, extra = {}) => recordProgress(slug, { attemptId: attempt.id, phase: "build",
    message: "Recorded requirement update", next: "Verify current proof", requirementUpdate, ...extra });
  return { root, home, slug, attempt, plan, proof, addArtifact, update, progress };
}

function snapshot(f) {
  const project = storeProjectDir(f.slug);
  const paths = [join(project, "HANDOFF.md"), join(project, ".progress-sequence"), join(project, ".pending-progress.json"),
    join(f.attempt.folder, "HANDOFF.md"), join(f.attempt.folder, "attempt.json")];
  const history = join(f.attempt.folder, "requirement-history");
  if (existsSync(history)) paths.push(...readdirSync(history).sort().map(name => join(history, name)));
  return paths.map(path => [path, existsSync(path) ? readFileSync(path, "utf8") : null]);
}

test("an explicit mapping persists through the core and derives verification from accepted bytes", t => {
  const f = fixture(t);
  const result = f.progress(f.update());
  assert.equal(result.recorded, true);
  assert.equal(result.attempt.requirement_mapping.revision, 1);
  const mapping = readRequirementMapping(f.slug, f.attempt.id);
  assert.equal(mapping.requirements[0].verification, "verified");
  assert.equal(getAttempt(f.slug, f.attempt.id).current_phase, "build");
  assert.equal("verification" in getAttempt(f.slug, f.attempt.id).requirement_mapping.requirements[0], false);
  const child = JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", `
    const { readRequirementMapping } = await import(${JSON.stringify(moduleUrl)});
    console.log(JSON.stringify(readRequirementMapping(${JSON.stringify(f.slug)}, ${JSON.stringify(f.attempt.id)})));
  `], { env: { ...process.env }, encoding: "utf8", timeout: 30000, windowsHide: true }));
  assert.deepEqual(child, mapping);
});

test("plain progress cannot establish mapping or acceptance and legacy reads are mutation-free", t => {
  const f = fixture(t);
  f.progress(undefined, { message: "R1 accepted and verified, all requirements complete" });
  const before = snapshot(f);
  assert.equal(readRequirementMapping(f.slug, f.attempt.id), null);
  assert.equal("requirement_mapping" in getAttempt(f.slug, f.attempt.id), false);
  assert.deepEqual(snapshot(f), before);
});

test("missing or unaccepted proof stays unverified even when work is complete", t => {
  const f = fixture(t);
  const update = f.update(); update.requirements[0].proof_refs = [];
  f.progress(update);
  assert.equal(readRequirementMapping(f.slug, f.attempt.id).requirements[0].verification, "unverified");
  const candidate = f.addArtifact("candidate-proof", "Recorded only\n", false);
  const second = f.update(); second.requirements[0].proof_refs = [candidate];
  f.progress(second);
  const entry = readRequirementMapping(f.slug, f.attempt.id).requirements[0];
  assert.equal(entry.verification, "unverified");
  assert.match(entry.evidence_warnings.join("\n"), /SHA-bound acceptance/);
});

test("new proof supersedes current references while immutable history and acceptance survive 100 checkpoints", t => {
  const f = fixture(t);
  f.progress(f.update());
  const firstHistory = join(f.attempt.folder, "requirement-history/1.json");
  const firstBytes = readFileSync(firstHistory, "utf8");
  const secondProof = f.addArtifact("proof-v2", "Verified replacement proof\n", true, "implementation_evidence", ["proof-v1"]);
  const second = f.update(); second.requirements[0].proof_refs = [secondProof];
  f.progress(second);
  for (let index = 0; index < 100; index++) f.progress(undefined, { message: `Ordinary checkpoint ${index}` });
  const current = readRequirementMapping(f.slug, f.attempt.id);
  assert.equal(current.revision, 2);
  assert.deepEqual(current.requirements[0].proof_refs, [secondProof]);
  assert.equal(current.requirements[0].verification, "verified");
  assert.equal(readFileSync(firstHistory, "utf8"), firstBytes);
  assert.deepEqual(JSON.parse(firstBytes).mapping.requirements[0].proof_refs, [f.proof]);
  assert.equal(getAttempt(f.slug, f.attempt.id).artifacts.find(x => x.id === "proof-v1").accepted_sha256, f.proof.sha256);
});

test("partial updates retain unnamed entries and a new governing plan cannot inherit old requirement states", t => {
  const f = fixture(t);
  f.progress(f.update());
  const second = f.update(); second.requirements = [{ requirement_id: "R2", decision_ref: null, work_state: "blocked", proof_refs: [] }];
  second.governing_plan = { sha256: f.plan.sha256, artifact_id: f.plan.artifact_id };
  f.progress(second);
  assert.deepEqual(readRequirementMapping(f.slug, f.attempt.id).requirements.map(x => x.requirement_id), ["R1", "R2"]);
  const plan2 = f.addArtifact("plan-v2", "# Revised\n\n## Requirements\n| ID | Requirement |\n| --- | --- |\n| R3 | New meaning |\n", true, "plan", ["plan-v1"]);
  assert.equal(readRequirementMapping(f.slug, f.attempt.id).requirements[0].verification, "unverified");
  const third = f.update({ governing_plan: plan2, requirements: [{ requirement_id: "R3", decision_ref: plan2, work_state: "planned", proof_refs: [] }] });
  f.progress(third);
  assert.deepEqual(readRequirementMapping(f.slug, f.attempt.id).requirements.map(x => x.requirement_id), ["R3"]);
  assert.equal(existsSync(join(f.attempt.folder, "requirement-history/1.json")), true);
});

test("invalid updates leave mapping, handoffs, lifecycle, sequence and history byte-identical", t => {
  const f = fixture(t);
  f.progress(f.update());
  const unaccepted = f.addArtifact("unaccepted-decision", "Not accepted\n", false, "research");
  const changes = [u => u.requirements[0].requirement_id = "R99", u => u.governing_plan.artifact_id = "other-plan",
    u => u.governing_plan.sha256 = "f".repeat(64), u => u.attempt_id = "other-attempt", u => u.expected_revision = 0,
    u => u.requirements[0].work_state = "verified", u => u.requirements[0].proof_refs[0].sha256 = "f".repeat(64),
    u => u.requirements[0].proof_refs[0].artifact_id = "missing", u => u.requirements[0].decision_ref = unaccepted,
    u => u.requirements[0].proof_refs = [f.plan]];
  for (const change of changes) {
    const update = f.update(); change(update);
    const before = snapshot(f);
    assert.throws(() => f.progress(update), /Invalid requirement update|artifact|acceptance|implementation_evidence/);
    assert.deepEqual(snapshot(f), before);
  }
});

test("unaccepted plans and prose-only requirement mentions cannot establish source identity", t => {
  const f = fixture(t, { acceptedPlan: false });
  const before = snapshot(f);
  assert.throws(() => f.progress(f.update()), /governing accepted plan/);
  assert.deepEqual(snapshot(f), before);
  acceptAttemptArtifact(f.slug, f.attempt.id, "plan-v1");
  const prosePlan = f.addArtifact("plan-prose", "# Plan\nR99 is mentioned here.\n", true, "plan", ["plan-v1"]);
  const next = f.update({ governing_plan: prosePlan });
  const beforeProse = snapshot(f);
  assert.throws(() => f.progress(next), /explicit Requirements table/);
  assert.deepEqual(snapshot(f), beforeProse);
});

test("HTML comments cannot declare governing requirement identities", async t => {
  const visible = "## Requirements\n| ID | Requirement |\n| --- | --- |\n| R1 | Visible requirement |\n";
  const hidden = "## Requirements\n| ID | Requirement |\n| --- | --- |\n| HIDDEN | Commented example |\n";
  const cases = [
    ["commented section", visible + "\n<!--\n" + hidden + "-->\n"],
    ["comment before visible section", "<!--\n" + hidden + "-->\n\n" + visible],
    ["commented row", visible + "<!-- | HIDDEN | Commented row | -->\n"],
    ["unterminated comment", visible + "\n<!--\n" + hidden],
    ["unmatched literal delimiter", "An unmatched ` marker.\n\n" + visible + "\n<!--\n" + hidden + "-->\n"],
    ["literal delimiter inside comment", "<!-- An unmatched ` marker. -->\n\n" + visible],
  ];
  for (const [name, planText] of cases) await t.test(name, t => {
    const f = fixture(t, { planText });
    f.progress(f.update());
    const summary = attemptSummary(f.slug, f.attempt.id);
    assert.deepEqual(summary.requirements.items.map(entry => entry.source.requirement_id), ["R1"]);
    assert.equal(summary.requirements.items[0].verification, "verified");
    const invalid = f.update(); invalid.requirements[0].requirement_id = "HIDDEN";
    const before = snapshot(f);
    assert.throws(() => f.progress(invalid), /must exist in the governing plan/);
    assert.deepEqual(snapshot(f), before);
  });
});

const visibleRequirementTable = "## Requirements\n| ID | Requirement |\n| --- | --- |\n| R1 | Visible requirement |\n";
const hiddenRequirementTable = "## Requirements\n| ID | Requirement |\n| --- | --- |\n| HIDDEN | Literal HTML content |\n";

function verifyHtmlRequirementBoundary(t, planText) {
  const f = fixture(t, { planText });
  f.progress(f.update());
  const summary = attemptSummary(f.slug, f.attempt.id);
  assert.deepEqual(summary.requirements.items.map(entry => entry.source.requirement_id), ["R1"]);
  assert.equal(summary.requirements.items[0].verification, "verified");
  assert.equal(summary.evidence_completeness, "verified");
  const invalid = f.update(); invalid.requirements[0].requirement_id = "HIDDEN";
  const before = snapshot(f);
  assert.throws(() => f.progress(invalid), /must exist in the governing plan/);
  assert.deepEqual(snapshot(f), before);
}

test("raw HTML blocks cannot declare governing requirement identities", async t => {
  const cases = [
    ...["pre", "script", "style", "textarea"].map(tag => [tag, `<${tag}>\n${hiddenRequirementTable}</${tag}>\n`]),
    ["mixed case with attributes", `<sCrIpT type='text/plain'>\n${hiddenRequirementTable}</ScRiPt>\n`],
    ["multiline literal opener", `<textarea\nclass='example'>\n${hiddenRequirementTable}</textarea>\n`],
    ["blank lines in literal block", `<pre>\n\n${hiddenRequirementTable}\n</pre>\n`],
    ["unmatched backtick cannot swallow literal block", `An unmatched \` marker.\n<script>\nLiteral \` marker\n${hiddenRequirementTable}</script>\n`],
    ["ordinary block", `<div hidden>\n${hiddenRequirementTable}</div>\n`],
    ["ordinary closed opener still needs blank boundary", `<div></div>\n${hiddenRequirementTable}`],
    ["mixed case table block", `  <TaBlE>\n${hiddenRequirementTable}</TABLE>\n`],
    ["closing block tag", `</section>\n${hiddenRequirementTable}`],
    ["incomplete block opener", `<section\ndata-example=true>\n${hiddenRequirementTable}`],
    ["complete custom tag", `<custom-element data-note='example'>\n${hiddenRequirementTable}</custom-element>\n`],
    ["quoted attribute delimiter", `<span data-note='literal > delimiter'>\n${hiddenRequirementTable}</span>\n`],
    ["complete generic closing tag", `</custom-element>\n${hiddenRequirementTable}`],
    ["processing instruction", `<?example\n${hiddenRequirementTable}?>\n`],
    ["declaration", `<!DOCTYPE\n${hiddenRequirementTable}>\n`],
    ["CDATA", `<![CDATA[\n${hiddenRequirementTable}]]>\n`],
  ];
  for (const [name, block] of cases) await t.test(name, t => {
    verifyHtmlRequirementBoundary(t, visibleRequirementTable + "\n" + block);
  });
});

test("unclosed raw HTML blocks do not regain Markdown authority at EOF", async t => {
  const cases = [
    ...["pre", "script", "style", "textarea"].map(tag => [tag, `<${tag}>\n\n${hiddenRequirementTable}`]),
    ["ordinary block", `<div>\n${hiddenRequirementTable}`],
    ["generic block", `<custom-element>\n${hiddenRequirementTable}`],
    ["processing instruction", `<?example\n\n${hiddenRequirementTable}`],
    ["declaration", `<!DOCTYPE\n${hiddenRequirementTable}`],
    ["CDATA", `<![CDATA[\n\n${hiddenRequirementTable}`],
  ];
  for (const [name, block] of cases) await t.test(name, t => {
    verifyHtmlRequirementBoundary(t, visibleRequirementTable + "\n" + block);
  });
});

test("visible requirements resume only after the raw HTML block boundary", async t => {
  const cases = [
    ...["pre", "script", "style", "textarea"].map(tag => [tag, `<${tag}>\n${hiddenRequirementTable}</${tag}>\n`]),
    ["literal same-line close", "<pre>Example</PRE>\n"],
    ["literal closing condition need not match opener", `<pre>\n${hiddenRequirementTable}</STYLE>\n`],
    ["ordinary blank-line boundary", `<div>\n${hiddenRequirementTable}</div>\n\n`],
    ["unclosed ordinary blank-line boundary", `<section>\n${hiddenRequirementTable}\n`],
    ["nested literal opener does not change ordinary boundary", "<div>\n<pre>\n\n"],
    ["generic blank-line boundary", `<custom-element>\n${hiddenRequirementTable}\n`],
    ["processing instruction", `<?example\n${hiddenRequirementTable}?>\n`],
    ["processing same-line close", "<?example?>\n"],
    ["declaration", `<!DOCTYPE\n${hiddenRequirementTable}>\n`],
    ["declaration same-line close", "<!DOCTYPE html>\n"],
    ["CDATA", `<![CDATA[\n${hiddenRequirementTable}]]>\n`],
    ["CDATA same-line close", "<![CDATA[example]]>\n"],
  ];
  for (const [name, prefix] of cases) await t.test(name, t => {
    verifyHtmlRequirementBoundary(t, prefix + visibleRequirementTable);
  });
});

test("escaped and inline-code tag literals cannot hide visible requirements", async t => {
  const prefixes = [
    "\\<pre>\n", "\\<div>\n", "`<pre>`\n", "``<script>``\n", "Use <pre> as an inline tag.\n",
    "Wrapped paragraph\n<custom-element>\n", "Literal `<pre>\ncontinued` span.\n\n",
    "Literal `example\ncontinued <pre>\ncontinued` span.\n\n", "<!-- <pre> -->\n",
    "```html\n<pre>\n```\n", "    <pre>\n\n",
  ];
  for (const prefix of prefixes) await t.test(prefix, t => {
    verifyHtmlRequirementBoundary(t, prefix + visibleRequirementTable);
  });
});

test("nonparagraph Markdown boundaries cannot expose raw HTML requirement identities", async t => {
  const boundaries = [
    ["dash thematic break", "---"], ["asterisk thematic break", "***"], ["underscore thematic break", "___"],
    ["spaced dash break", " - - -"], ["spaced asterisk break", "  * * *"], ["spaced underscore break", "   _ _ _"],
    ["setext equals", "A heading\n==="], ["setext dashes", "A heading\n--"], ["short setext", "A heading\n="],
    ["short dash setext", "A heading\n-"],
    ["ATX heading", "## Narrative"], ["empty ATX heading", "#"], ["indented ATX heading", "   ## Narrative"],
    ["link reference", "[docs]: https://example.invalid/source"],
    ["angle destination and title", "  [with space]: <some path> 'Title'"],
    ["balanced destination", "[nested]: /a(b(c)) (Title)"],
    ["escaped destination", "[escaped]: /a\\(b\\)"],
    ["literal trailing backslash destination", "[slash]: /path\\"],
    ["empty blockquote", ">"], ["blockquote heading", "> # Narrative"], ["blockquote break", "> ---"],
    ["empty list", "-"], ["nested empty list", "- -"], ["list heading", "- # Narrative"], ["empty ordered list", "1."],
    ["ordered list heading", "1. ## Narrative"], ["indented code", "    Example"],
    ["tab-indented code", " \tExample"], ["spaces and tab code", "  \tExample"],
    ["fenced code", "```text\nExample\n```"],
  ];
  for (const [name, boundary] of boundaries) await t.test(name, t => {
    verifyHtmlRequirementBoundary(t, visibleRequirementTable + "\n" + boundary
      + "\n<custom-element>\n" + hiddenRequirementTable + "</custom-element>\n");
  });
});

test("paragraph continuation before a generic HTML tag preserves visible requirement identities", async t => {
  const paragraphs = [
    "Wrapped prose\nMore prose", "-x -", "****text", "=", "--", "#not-a-heading", "####### Too many hashes",
    "Wrapped prose\n    # Indented continuation", "Wrapped prose\n  \t# Indented continuation",
    "Wrapped prose\n[docs]: https://example.invalid/source",
    "[docs]: /url 'Title' trailing prose", "[docs]: /unbalanced(destination", "[]: /url",
    "Wrapped prose\n*", "Wrapped prose\n1.",
    "> Quoted paragraph", "- List paragraph", "2. List paragraph", "Wrapped prose\n2. ## Paragraph continuation",
    "`---`", "---<!-- inline annotation -->",
  ];
  for (const paragraph of paragraphs) await t.test(paragraph, t => {
    verifyHtmlRequirementBoundary(t, paragraph + "\n<custom-element>\n" + visibleRequirementTable);
  });
});

test("root ATX requirement headings allow up to three spaces of indentation", async t => {
  for (const indentation of [" ", "  ", "   "]) await t.test(`${indentation.length} spaces`, t => {
    verifyHtmlRequirementBoundary(t, indentation + visibleRequirementTable);
  });
});

test("multiline reference and container boundaries keep raw HTML requirements opaque", async t => {
  const boundaries = [
    ["next-line destination", "[docs]:\n /link"],
    ["next-line title", "[docs]: /link\n \"Title\""],
    ["next-line destination and title", "[docs]:\n /link\n 'Title'"],
    ["multiline label", "[label\n continued]: /link"],
    ["multiline same-line title", "[docs]: /link \"A\n multiline title\""],
    ["multiline next-line title", "[docs]: /link\n (A\n multiline title)"],
    ["next-line angle destination", "[docs]:\n <a path>\n \"Title\""],
    ["Markdown-looking title content", "[docs]: /link \"Title\n" + hiddenRequirementTable + "end\""],
    ["blockquote literal HTML leaf", "> <pre>"], ["list literal HTML leaf", "- <pre>"],
    ["blockquote ordinary HTML leaf", "> <div>"], ["blockquote indented code leaf", ">     Example"],
    ["list indented code leaf", "-     Example"], ["list tab-stop code leaf", "-   \tExample"],
  ];
  for (const [name, boundary] of boundaries) await t.test(name, t => {
    verifyHtmlRequirementBoundary(t, visibleRequirementTable + "\n" + boundary
      + "\n<custom-element>\n" + hiddenRequirementTable + "</custom-element>\n");
  });
});

test("invalid multiline references and lazy paragraphs do not hide visible requirements", async t => {
  const paragraphs = [
    "[docs]:\n\n /link", "[docs]: /link\n \"Title\" trailing", "[docs]: /link\n \"Unclosed title",
    "[docs]: /link \"Title\" trailing", "Wrapped prose\n[docs]:\n /link",
    "> Quoted paragraph\n>     Continued paragraph", "- List paragraph\n  continued paragraph",
  ];
  for (const paragraph of paragraphs) await t.test(paragraph, t => {
    verifyHtmlRequirementBoundary(t, paragraph + "\n<custom-element>\n" + visibleRequirementTable);
  });
});

test("wrapped container references cannot expose raw HTML requirement identities", async t => {
  const boundaries = [
    ["blockquote destination", "> [docs]:\n> /link"],
    ["blockquote title", "> [docs]: /link\n> \"Title\""],
    ["blockquote multiline title", "> [docs]: /link\n> \"A\n> multiline title\""],
    ["list destination", "- [docs]:\n  /link"],
    ["list title", "- [docs]: /link\n  \"Title\""],
    ["list multiline label", "- [label\n  continued]: /link"],
    ["quote containing list", "> - [docs]:\n>   /link"],
    ["list containing quote", "- > [docs]:\n  > /link"],
    ["nested quote", ">> [docs]:\n>> /link"],
    ["new quote interrupts outer prose", "Outer prose\n> [docs]:\n> /link"],
  ];
  for (const [name, boundary] of boundaries) await t.test(name, t => {
    verifyHtmlRequirementBoundary(t, visibleRequirementTable + "\n" + boundary
      + "\n<custom-element>\n" + hiddenRequirementTable + "</custom-element>\n");
  });
});

test("malformed container references and lazy paragraph leaves preserve visible requirements", async t => {
  const paragraphs = [
    "> []:\n> /link", "> [broken:\n> /link", "> [docs]: /unbalanced(destination",
    "> [docs]: /link \"Title\" trailing", "> [docs]: /link\n> \"Title\" trailing",
    "- [docs]: /link\n  \"Unclosed title", "> Paragraph\n> [docs]:\n> /link",
    "> Paragraph\nlazy continuation\n> [docs]: /link", "Wrapped prose\n2. [docs]:\n   /link",
  ];
  for (const paragraph of paragraphs) await t.test(paragraph, t => {
    verifyHtmlRequirementBoundary(t, paragraph + "\n<custom-element>\n" + visibleRequirementTable);
  });
});

test("GFM table leaves outside Requirements keep following raw HTML opaque", async t => {
  const tables = [
    ["ordinary table", "| A | B |\n| --- | --- |\n| x | y |"],
    ["no outer pipes", "A | B\n--- | ---\nx | y"],
    ["short aligned delimiters", "A | B\n:- | -:\nx | y"],
    ["no body", "| A | B |\n| --- | --- |"],
    ["body without pipes", "| A | B |\n| --- | --- |\nplain body row"],
    ["unequal body columns", "| A | B |\n| --- | --- |\n| x |\n| x | y | z |"],
    ["escaped header pipe", "| A\\|B | C |\n| --- | --- |\n| x | y |"],
    ["single column", "| A |\n| --- |\nplain row"],
    ["quote table", "> | A | B |\n> | --- | --- |\n> x | y"],
    ["list table", "- | A | B |\n  | --- | --- |\n  x | y"],
    ["mixed container table", "> - | A | B |\n>   | --- | --- |\n>   x | y"],
    ["unmatched backtick cannot swallow table", "Unmatched ` marker\nA | B\n--- | ---\nx | `y"],
  ];
  for (const [name, table] of tables) await t.test(name, t => {
    verifyHtmlRequirementBoundary(t, visibleRequirementTable + "\n## Other\n" + table
      + "\n<custom-element>\n" + hiddenRequirementTable + "</custom-element>\n");
  });
});

test("malformed table rows remain prose and do not hide visible requirements", async t => {
  const prose = [
    "| A | B |\n| x | y |", "| A | B |\n| --- |\nx | y", "| A | B |\n| --- | text |\nx | y",
    "| A\\|B |\n| --- | --- |\nx | y", "| A | B |\n| - - - | --- |", "| A | B |\n| `---` | --- |",
    "| A | B |\n| ---<!-- note --> | --- |",
    "| A | B |\n| --- | --- |\nx | y\n\nA new paragraph",
    "| A | B |\n| --- | --- |\nx | y\n> A quoted paragraph",
  ];
  for (const paragraph of prose) await t.test(paragraph, t => {
    verifyHtmlRequirementBoundary(t, "## Other\n" + paragraph + "\n<custom-element>\n" + visibleRequirementTable);
  });
  await t.test("invalid Requirements delimiter cannot create an identity", t => {
    verifyHtmlRequirementBoundary(t, visibleRequirementTable + "\n## Requirements\n| ID | Requirement |\n| --- |\n| HIDDEN | Ordinary prose |\n");
  });
});

test("literal comment markers in code examples do not hide later requirement declarations", t => {
  const f = fixture(t, { planText: "# Plan\n\n```markdown\n<!--\n```\n\n    <!--\n\n## Requirements\n| ID | Requirement |\n| --- | --- |\n| R1 | Visible requirement |\n" });
  f.progress(f.update());
  assert.equal(readRequirementMapping(f.slug, f.attempt.id).requirements[0].verification, "verified");
});

test("inline code and escaped comment markers preserve every visible requirement", async t => {
  const rows = [
    ["one backtick", "Document the `<!--` opener."],
    ["matching delimiter runs", "Document ``the `<!--` marker``."],
    ["escaped opener", "Document the \\<!-- literal opener."],
  ];
  for (const [name, description] of rows) await t.test(name, t => {
    const f = fixture(t, { planText: "## Requirements\n| ID | Requirement |\n| --- | --- |\n| R1 | " + description + " |\n| R2 | Remain visible |\n" });
    f.progress(f.update());
    const incomplete = attemptSummary(f.slug, f.attempt.id);
    assert.deepEqual(incomplete.requirements.items.map(entry => entry.source.requirement_id), ["R1", "R2"]);
    assert.equal(incomplete.evidence_completeness, "unverified");
    const update = f.update(); update.requirements[0].requirement_id = "R2";
    f.progress(update);
    assert.equal(attemptSummary(f.slug, f.attempt.id).evidence_completeness, "verified");
  });
  for (const prose of ["Use `<!--` as the comment opener.", "Use `<!--\ncontinued` as a literal opener.", "Use ``a `<!--`\ncontinued`` literal opener.", "Use `<!--\n2. continued` as a literal opener."]) await t.test(prose, t => {
    const f = fixture(t, { planText: prose + "\n\n## Requirements\n| ID | Requirement |\n| --- | --- |\n| R1 | Visible declaration |\n" });
    f.progress(f.update());
    assert.equal(attemptSummary(f.slug, f.attempt.id).evidence_completeness, "verified");
  });
});

test("masking cannot manufacture a governing heading or table prefix", async t => {
  const visible = "## Requirements\n| ID | Requirement |\n| --- | --- |\n| R1 | Visible requirement |\n";
  const hiddenRows = "| --- | --- |\n| HIDDEN | Not a source declaration |\n";
  const cases = [
    ["heading separator", "##<!-- note --> Requirements\n| ID | Requirement |\n" + hiddenRows],
    ["comment continuation", "## Requirements\n\n<!-- hidden\n-->| ID | Requirement |\n" + hiddenRows],
    ["code continuation", "## Requirements\n\nProse `literal\n`| ID | Requirement |\n" + hiddenRows],
  ];
  for (const [name, prefix] of cases) await t.test(name, t => {
    const f = fixture(t, { planText: prefix + "\n" + visible });
    f.progress(f.update());
    assert.deepEqual(attemptSummary(f.slug, f.attempt.id).requirements.items.map(entry => entry.source.requirement_id), ["R1"]);
    const invalid = f.update(); invalid.requirements[0].requirement_id = "HIDDEN";
    const before = snapshot(f);
    assert.throws(() => f.progress(invalid), /must exist in the governing plan/);
    assert.deepEqual(snapshot(f), before);
  });
});

test("changed accepted bytes invalidate reads and writes until explicitly replaced", t => {
  const f = fixture(t);
  f.progress(f.update());
  writeFileSync(join(f.attempt.folder, "artifacts/proof-v1.md"), "Changed after acceptance\n");
  const before = snapshot(f);
  const current = readRequirementMapping(f.slug, f.attempt.id);
  assert.equal(current.requirements[0].verification, "unverified");
  assert.match(current.requirements[0].evidence_warnings.join("\n"), /changed after acceptance/);
  assert.throws(() => f.progress(f.update()), /changed after acceptance/);
  assert.deepEqual(snapshot(f), before);
  const replacement = f.addArtifact("replacement", "New accepted proof\n");
  const update = f.update(); update.requirements[0].proof_refs = [replacement];
  f.progress(update);
  assert.equal(readRequirementMapping(f.slug, f.attempt.id).requirements[0].verification, "verified");
  rmSync(join(f.attempt.folder, "artifacts/replacement.md"));
  assert.equal(readRequirementMapping(f.slug, f.attempt.id).requirements[0].verification, "unverified");
});

test("changed plan bytes invalidate every requirement without rewriting stored acceptance", t => {
  const f = fixture(t); f.progress(f.update());
  writeFileSync(join(f.attempt.folder, "artifacts/plan-v1.md"), "# Changed plan\n");
  const before = snapshot(f);
  const mapping = readRequirementMapping(f.slug, f.attempt.id);
  assert.equal(mapping.requirements[0].verification, "unverified");
  assert.match(mapping.warnings.join("\n"), /changed after acceptance/);
  assert.throws(() => f.progress(f.update()), /changed after acceptance/);
  assert.deepEqual(snapshot(f), before);
});

test("rejected phase movement writes no mapping revision or counter", t => {
  const f = fixture(t); f.progress(f.update());
  const before = snapshot(f);
  assert.throws(() => f.progress(f.update(), { phase: "post" }), /cannot be backfilled/);
  assert.deepEqual(snapshot(f), before);
});

test("explicit identity and checkpoint ownership remain mandatory for mapping updates", t => {
  const f = fixture(t);
  f.progress(f.update(), { workItem: "ticket:one", reviewRevision: "a".repeat(40) });
  const before = snapshot(f);
  const result = f.progress(f.update(), { workItem: "ticket:two", reviewRevision: "b".repeat(40) });
  assert.equal(result.recorded, false);
  assert.equal(result.reason, "work_item_mismatch");
  assert.deepEqual(snapshot(f), before);
  assert.throws(() => recordProgress(f.slug, { message: "Unscoped mapping", requirementUpdate: f.update() }), /explicitly selected/);
  assert.deepEqual(snapshot(f), before);
});

test("conflicting history is rejected before consuming sequence or saving a journal", t => {
  const f = fixture(t); f.progress(f.update());
  writeFileSync(join(f.attempt.folder, "requirement-history/2.json"), "Conflicting saved revision\n");
  const before = snapshot(f);
  assert.throws(() => f.progress(f.update()), /history revision already exists with different bytes/);
  assert.deepEqual(snapshot(f), before);
});

test("duplicate plan identities and tables inside fenced examples are not requirement declarations", t => {
  const f = fixture(t, { planText: "# Plan\n\n## Requirements\n| ID | Requirement |\n| --- | --- |\n| R1 | First |\n| R1 | Duplicate |\n" });
  const before = snapshot(f);
  assert.throws(() => f.progress(f.update()), /unique stable requirement IDs/);
  assert.deepEqual(snapshot(f), before);
  const codeOnly = f.addArtifact("code-plan", "# Plan\n````markdown\n```\n## Requirements\n| ID | Requirement |\n| --- | --- |\n| R1 | Example only |\n````\n", true, "plan", ["plan-v1"]);
  const beforeCode = snapshot(f);
  assert.throws(() => f.progress(f.update({ governing_plan: codeOnly })), /explicit Requirements table/);
  assert.deepEqual(snapshot(f), beforeCode);
});

test("repeated table headers, indented examples and escaped prose cannot invent source IDs", t => {
  const f = fixture(t, { planText: "# Plan\n\n## Requirements\n| ID | Requirement |\n| --- | --- |\n| R1 | First |\n\n| Requirement | ID |\n| --- | --- |\n| One \\| Two | R2 |\n\n    | ID | Requirement |\n    | --- | --- |\n    | EXAMPLE | Indented example |\n" });
  const update = f.update();
  update.requirements.push({ requirement_id: "R2", decision_ref: f.plan, work_state: "planned", proof_refs: [] });
  f.progress(update);
  assert.deepEqual(readRequirementMapping(f.slug, f.attempt.id).requirements.map(x => x.requirement_id), ["R1", "R2"]);
  for (const invented of ["ID", "Requirement", "Two", "EXAMPLE"]) {
    const invalid = f.update(); invalid.requirements[0].requirement_id = invented;
    const before = snapshot(f);
    assert.throws(() => f.progress(invalid), /must exist in the governing plan/);
    assert.deepEqual(snapshot(f), before);
  }
});

test("new mapping reads reject ambiguous identities instead of choosing a newer attempt", t => {
  const f = fixture(t); f.progress(f.update());
  const other = createAttemptInStore(f.slug, "mapping");
  const before = snapshot(f);
  assert.throws(() => readRequirementMapping(f.slug, "mapping"), /ambiguous/);
  assert.throws(() => readRequirementMapping(f.slug), /required/);
  assert.equal(readRequirementMapping(f.slug, other.id), null);
  assert.equal(readRequirementMapping(f.slug, f.attempt.id).revision, 1);
  assert.deepEqual(snapshot(f), before);
});

test("ordinary requirement prose containing ID remains a data cell", t => {
  const f = fixture(t, { planText: "# Plan\n\n## Requirements\n| ID | Requirement |\n| --- | --- |\n| R1 | ID |\n| R2 | Requirement ID |\n" });
  const update = f.update();
  update.requirements.push({ requirement_id: "R2", decision_ref: null, work_state: "planned", proof_refs: [] });
  f.progress(update);
  assert.deepEqual(readRequirementMapping(f.slug, f.attempt.id).requirements.map(x => x.requirement_id), ["R1", "R2"]);
});

test("competing processes cannot apply two updates against one source revision", async t => {
  const f = fixture(t); f.progress(f.update());
  const proof2 = f.addArtifact("proof-v2", "Candidate two\n");
  const proof3 = f.addArtifact("proof-v3", "Candidate three\n");
  const beforeSequence = Number(readFileSync(join(storeProjectDir(f.slug), ".progress-sequence"), "utf8"));
  const sourceUpdate = f.update();
  const run = proof => new Promise((resolveRun, rejectRun) => {
    const update = structuredClone(sourceUpdate); update.requirements[0].proof_refs = [proof];
    const child = spawn(process.execPath, ["--input-type=module", "-e", `
      const { recordProgress } = await import(${JSON.stringify(moduleUrl)});
      try { recordProgress(${JSON.stringify(f.slug)}, { attemptId: ${JSON.stringify(f.attempt.id)}, phase: 'build',
        message: ${JSON.stringify(proof.artifact_id)}, next: 'Read winner', requirementUpdate: ${JSON.stringify(update)} });
        console.log(JSON.stringify({ recorded: true })); }
      catch (error) { console.log(JSON.stringify({ error: error.message })); }
    `], { env: { ...process.env }, timeout: 30000, windowsHide: true });
    let stdout = "", stderr = "";
    child.stdout.on("data", chunk => stdout += chunk);
    child.stderr.on("data", chunk => stderr += chunk);
    child.on("error", rejectRun);
    child.on("close", status => { try { assert.equal(status, 0, stderr); resolveRun(JSON.parse(stdout)); } catch (error) { rejectRun(error); } });
  });
  const results = await Promise.all([run(proof2), run(proof3)]);
  assert.equal(results.filter(result => result.recorded).length, 1);
  assert.match(results.find(result => result.error).error, /expected_revision/);
  const mapping = readRequirementMapping(f.slug, f.attempt.id);
  assert.equal(mapping.revision, 2);
  assert.equal(mapping.requirements[0].verification, "verified");
  assert.deepEqual(readdirSync(join(f.attempt.folder, "requirement-history")).sort(), ["1.json", "2.json"]);
  assert.equal(Number(readFileSync(join(storeProjectDir(f.slug), ".progress-sequence"), "utf8")), beforeSequence + 1);
});

for (const boundary of ["before-journal", "before-history", "after-history", "after-mapping", "after-handoff", "after-canonical", "after-lifecycle"]) {
  test(`fresh-process recovery keeps one mapping revision after exit ${boundary}`, t => {
    const f = fixture(t); f.progress(f.update(), { message: "First checkpoint" });
    const proof2 = f.addArtifact("proof-v2", "Second accepted proof\n");
    const update = f.update(); update.requirements[0].proof_refs = [proof2];
    const target = boundary === "before-journal" ? join(storeProjectDir(f.slug), ".pending-progress.json")
      : boundary.includes("history") ? join(f.attempt.folder, "requirement-history/2.json")
      : ["after-mapping", "after-lifecycle"].includes(boundary) ? join(f.attempt.folder, "attempt.json")
      : boundary === "after-canonical" ? join(storeProjectDir(f.slug), "HANDOFF.md") : join(f.attempt.folder, "HANDOFF.md");
    const child = spawnSync(process.execPath, ["--input-type=module", "-e", `
      import fs from 'node:fs';
      import { syncBuiltinESMExports } from 'node:module';
      const rename = fs.renameSync;
      fs.renameSync = (from, to) => {
        if (to === ${JSON.stringify(target)} && ${JSON.stringify(boundary)}.startsWith('before-')) process.exit(73);
        rename(from, to);
        if (to === ${JSON.stringify(target)} && (${JSON.stringify(boundary)} !== 'after-lifecycle' || JSON.parse(fs.readFileSync(to, 'utf8')).current_phase === 'verify')) process.exit(73);
      };
      syncBuiltinESMExports();
      const { recordProgress } = await import(${JSON.stringify(moduleUrl)});
      recordProgress(${JSON.stringify(f.slug)}, { attemptId: ${JSON.stringify(f.attempt.id)}, phase: 'verify',
        message: 'Second checkpoint', next: 'Check recovered result', requirementUpdate: ${JSON.stringify(update)} });
    `], { env: { ...process.env }, encoding: "utf8", timeout: 30000, windowsHide: true });
    assert.equal(child.status, 73, child.stderr);
    const recovered = JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", `
      const now = Date.now; Date.now = () => now() + 3600000;
      const { readRequirementMapping, getAttempt } = await import(${JSON.stringify(moduleUrl)});
      console.log(JSON.stringify({ mapping: readRequirementMapping(${JSON.stringify(f.slug)}, ${JSON.stringify(f.attempt.id)}),
        attempt: getAttempt(${JSON.stringify(f.slug)}, ${JSON.stringify(f.attempt.id)}) }));
    `], { env: { ...process.env }, encoding: "utf8", timeout: 30000, windowsHide: true }));
    const expectedRevision = boundary === "before-journal" ? 1 : 2;
    assert.equal(recovered.mapping.revision, expectedRevision);
    assert.deepEqual(recovered.mapping.requirements[0].proof_refs, [expectedRevision === 1 ? f.proof : proof2]);
    assert.equal(recovered.mapping.requirements[0].verification, "verified");
    assert.equal(recovered.attempt.current_phase, expectedRevision === 1 ? "build" : "verify");
    assert.equal(existsSync(join(storeProjectDir(f.slug), ".pending-progress.json")), false);
    assert.deepEqual(readdirSync(join(f.attempt.folder, "requirement-history")).filter(name => /^[1-9]\d*\.json$/.test(name)).sort(),
      expectedRevision === 1 ? ["1.json"] : ["1.json", "2.json"]);
    const attemptHandoff = parseCurrentHandoff(readFileSync(join(f.attempt.folder, "HANDOFF.md"), "utf8"));
    const canonicalHandoff = parseCurrentHandoff(readFileSync(join(storeProjectDir(f.slug), "HANDOFF.md"), "utf8"));
    assert.deepEqual(attemptHandoff.completedSteps, canonicalHandoff.completedSteps);
    assert.equal(new Set(attemptHandoff.completedSteps).size, attemptHandoff.completedSteps.length);
  });
}
