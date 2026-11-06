import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { checkSte, proseBlocks, runSteCheck, sentences, words } from "../src/ste.js";
import { bundledSkills } from "../src/skills.js";
import { buildFlow } from "../src/flow.js";
import { loadPlaybooks } from "../src/router.js";

const rules = (text, options) => checkSte(text, options).map((finding) => finding.rule);
const longSentence = (count) => `${Array.from({ length: count }, (_, i) => `word${i === 0 ? "" : i}`).join(" ")}.`.replace(/^w/, "W");

test("descriptive sentences allow 25 words and procedural steps allow 20", () => {
  assert.deepEqual(rules(longSentence(25)), []);
  assert.deepEqual(rules(longSentence(26)), ["sentence-length"]);
  assert.deepEqual(rules(`1. ${longSentence(20)}`), []);
  assert.deepEqual(rules(`1. ${longSentence(21)}`), ["sentence-length"]);
  assert.deepEqual(rules(`- ${longSentence(21)}`), [], "bullet items are descriptive");
});

test("paragraphs allow six sentences", () => {
  assert.deepEqual(rules("One. Two. Three. Four. Five. Six."), []);
  assert.deepEqual(rules("One. Two. Three. Four. Five. Six. Seven."), ["paragraph-length"]);
});

test("passive voice is flagged, adjectives that end in ed are not", () => {
  assert.deepEqual(rules("The file was written by the tool."), ["passive-voice"]);
  assert.deepEqual(rules("The change is not fully tested."), ["passive-voice"]);
  assert.deepEqual(rules("The tool writes the file."), []);
  assert.deepEqual(rules("The speed is need based."), []);
});

test("a step with more than one instruction is flagged", () => {
  assert.deepEqual(rules("1. Open the file and then save it."), ["one-instruction"]);
  assert.deepEqual(rules("1. Open the file; save it."), ["one-instruction"]);
  assert.deepEqual(rules("1. Open the file."), []);
});

test("code, tables, headings, front matter, and comments are not prose", () => {
  const source = [
    "---", "name: x", "---", "# A heading that is very long but it is a heading and not a sentence at all ok",
    "```", longSentence(40), "```", "| a | b |", "<!-- " + longSentence(40) + " -->", "Short text.",
  ].join("\n");
  assert.deepEqual(proseBlocks(source).map((block) => block.text), ["Short text."]);
});

test("inline code and links count as words a reader sees", () => {
  assert.deepEqual(words(sentences("Run `npm run check:release --verbose` with [the guide](https://x.y/z).")[0]),
    ["Run", "CODE", "with", "the", "guide"]);
  assert.deepEqual(sentences("Use e.g. this. Then stop."), ["Use e.g this.", "Then stop."]);
});

test("approved word list flags other words but accepts names, numbers, and code", () => {
  const approved = new Set(["the", "tool", "write", "writes", "file", "use"]);
  assert.deepEqual(checkSte("The tool writes the file.", { words: approved }), []);
  assert.deepEqual(checkSte("Use the tool on 3 files in GitHub with `x` and API.", { words: approved })
    .map((finding) => finding.message), ["Not in the approved word list: on, in, with, and."]);
});

test("ste check exits 1 with findings, 0 when clean, and 2 for usage", () => {
  const dir = mkdtempSync(join(tmpdir(), "dirf-ste-"));
  writeFileSync(join(dir, "clean.md"), "The tool writes the file.\n");
  const wordsFile = join(mkdtempSync(join(tmpdir(), "dirf-ste-words-")), "words.txt");
  writeFileSync(wordsFile, "# approved\nthe\ntool\n");
  writeFileSync(join(dir, "image.png"), "not prose");
  const lines = [];
  const io = { log: (line) => lines.push(line), error: (line) => lines.push(line) };
  assert.equal(runSteCheck({ _: ["check", join(dir, "clean.md")] }, io), 0);
  assert.equal(runSteCheck({ _: ["check", dir], words: wordsFile, json: true }, io), 1);
  const report = JSON.parse(lines.at(-1));
  assert.equal(report.files, 1, "only Markdown and text files are checked");
  assert.equal(report.results[0].findings[0].rule, "unapproved-word");
  assert.equal(runSteCheck({ _: ["check"] }, io), 2);
  assert.throws(() => runSteCheck({ _: ["check", join(dir, "missing.md")] }, io), /File not found/);
});

test("ste100 is a bundled controlled-language skill that a task can request", () => {
  const skill = bundledSkills().ste100;
  assert.deepEqual(skill.capabilities, ["controlled language"]);
  const selection = { playbook: "audit-remediation", skill_flow: { label: "l", steps: [] } };
  const flow = buildFlow(selection, { task: "read-only audit; use ste100" }, {});
  assert.deepEqual(flow.steps.filter((step) => step.stage === "prose").map((step) => step.skill), ["ste100"]);
});

test("the documentation playbook ends prose work with the controlled-language pass", () => {
  const steps = loadPlaybooks().documentation.skill_flow.steps.map((step) => step.capability);
  assert.deepEqual(steps, ["minimalism", "prose editing", "controlled language", "code review"]);
});
