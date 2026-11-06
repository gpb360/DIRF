// @ts-check
// ASD-STE100 (Simplified Technical English) writing-rule checker.
//
// Checks only the STE writing rules that a program can test without the STE
// dictionary: sentence length, paragraph length, passive voice, and one
// instruction per sentence. The STE dictionary belongs to ASD and is not
// bundled. A project can supply its own approved-word list with --words.
//
// The checks are heuristics. A finding is a prompt for a writer to look again,
// not proof of a rule violation.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";

/** Word and sentence limits from the STE writing rules. */
export const STE_LIMITS = Object.freeze({ procedural: 20, descriptive: 25, paragraphSentences: 6 });

export const STE_RULES = Object.freeze({
  "sentence-length": "Procedural sentences: 20 words maximum. Descriptive sentences: 25 words maximum.",
  "paragraph-length": "A descriptive paragraph has 6 sentences maximum.",
  "passive-voice": "Use the active voice.",
  "one-instruction": "Write one instruction in each sentence.",
  "unapproved-word": "Use only words from the approved word list.",
});

const IRREGULAR_PARTICIPLES = [
  "built", "bought", "brought", "caught", "chosen", "done", "drawn", "driven", "found", "forgotten",
  "given", "held", "hidden", "kept", "known", "laid", "left", "lost", "made", "meant", "paid", "put",
  "read", "run", "said", "seen", "sent", "set", "shown", "shut", "sold", "spent", "split", "taken",
  "taught", "thrown", "told", "understood", "won", "written",
];
// Words that end in "ed" but are not past participles.
const NOT_PARTICIPLES = new Set(["bed", "embed", "feed", "hundred", "indeed", "need", "red", "seed", "shed", "sled", "speed", "wed"]);
const PASSIVE = new RegExp(
  `\\b(?:am|is|are|was|were|be|been|being)\\s+(?:not\\s+)?(?:[a-z]+ly\\s+)?([a-z]+ed|${IRREGULAR_PARTICIPLES.join("|")})\\b`, "gi");
const SEQUENCE = /(?:\band then\b|,\s*then\b|;\s*then\b|;)/i;
const ABBREVIATIONS = /\b(e\.g|i\.e|etc|vs|approx|fig|cf)\./gi;
const CODE_TOKEN = "CODE";

/**
 * @typedef {{ line: number, rule: keyof typeof STE_RULES, message: string, text: string }} SteFinding
 * @typedef {{ line: number, text: string, kind: "paragraph" | "procedure" | "item" }} Block
 */

/**
 * Replace inline Markdown with the words a reader sees. Code and URLs count as one word.
 * @param {string} text
 */
function plainInline(text) {
  return text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/`[^`]*`/g, CODE_TOKEN)
    .replace(/<[^>]+>/g, " ")
    .replace(/https?:\/\/\S+/g, CODE_TOKEN)
    .replace(/[*_]{1,3}([^*_]+)[*_]{1,3}/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Split Markdown or plain text into prose blocks. Code, tables, headings,
 * front matter, and HTML comments are not prose and are skipped.
 * @param {string} source
 * @returns {Block[]}
 */
export function proseBlocks(source) {
  const lines = String(source).replace(/\r\n?/g, "\n").split("\n");
  /** @type {Block[]} */
  const blocks = [];
  /** @type {Block | null} */
  let current = null;
  let fence = "";
  let comment = false;
  let start = 0;
  if (lines[0] === "---") {
    const end = lines.indexOf("---", 1);
    if (end > 0) start = end + 1;
  }
  const flush = () => { if (current && current.text.trim()) blocks.push(current); current = null; };
  for (let i = start; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trim();
    const fenceMatch = line.match(/^(```|~~~)/);
    if (fence) { if (fenceMatch && line.startsWith(fence)) fence = ""; continue; }
    if (fenceMatch) { flush(); fence = fenceMatch[1]; continue; }
    if (comment) { if (line.includes("-->")) comment = false; continue; }
    if (line.startsWith("<!--")) { flush(); comment = !line.includes("-->"); continue; }
    if (!line || /^#{1,6}\s/.test(line) || line.startsWith("|") || /^(?:-{3,}|\*{3,}|_{3,})$/.test(line)) { flush(); continue; }
    const text = line.replace(/^>\s?/, "");
    const ordered = text.match(/^\d+[.)]\s+(.*)$/);
    const bullet = text.match(/^[-*+]\s+(?:\[[ xX]\]\s+)?(.*)$/);
    if (ordered || bullet) {
      flush();
      current = { line: i + 1, text: (ordered || bullet)?.[1] || "", kind: ordered ? "procedure" : "item" };
      continue;
    }
    if (current) current.text += ` ${text}`;
    else current = { line: i + 1, text, kind: "paragraph" };
  }
  flush();
  return blocks;
}

/** @param {string} text */
export function sentences(text) {
  const protectedText = plainInline(text).replace(ABBREVIATIONS, "$1");
  return protectedText.split(/(?<=[.!?])["')\]]?\s+(?=["'(\[]?[A-Z0-9])/).map((/** @type {string} */ s) => s.trim()).filter(Boolean);
}

/** @param {string} sentence */
export function words(sentence) {
  return sentence.match(/[A-Za-z0-9][A-Za-z0-9'’-]*/g) || [];
}

/** @param {string} text */
const excerpt = (text) => (text.length > 80 ? `${text.slice(0, 77)}...` : text);

/**
 * Load a project approved-word list: one word per line, or a JSON array.
 * Lines that start with # are comments.
 * @param {string} file
 * @returns {Set<string>}
 */
export function loadApprovedWords(file) {
  const source = readFileSync(resolve(file), "utf-8");
  const list = source.trim().startsWith("[")
    ? JSON.parse(source)
    : source.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith("#"));
  if (!Array.isArray(list)) throw new Error(`Approved word list must be a JSON array or one word per line: ${file}`);
  return new Set(list.map((word) => String(word).toLowerCase()));
}

/**
 * True when a word needs no dictionary check: numbers, code, acronyms, and
 * capitalized names in the middle of a sentence (technical names).
 * @param {string} word
 * @param {number} index
 */
function isTechnicalName(word, index) {
  if (word === CODE_TOKEN || /\d/.test(word)) return true;
  if (/^[A-Z][A-Z0-9-]+$/.test(word)) return true;
  return index > 0 && /^[A-Z]/.test(word);
}

/**
 * Check text against the testable STE writing rules.
 * @param {string} source Markdown or plain text.
 * @param {{ words?: Set<string> }} [options]
 * @returns {SteFinding[]}
 */
export function checkSte(source, options = {}) {
  /** @type {SteFinding[]} */
  const findings = [];
  const approved = options.words;
  for (const block of proseBlocks(source)) {
    const blockSentences = sentences(block.text);
    const procedural = block.kind === "procedure";
    const limit = procedural ? STE_LIMITS.procedural : STE_LIMITS.descriptive;
    for (const sentence of blockSentences) {
      const sentenceWords = words(sentence);
      const add = (/** @type {keyof typeof STE_RULES} */ rule, /** @type {string} */ message) =>
        findings.push({ line: block.line, rule, message, text: excerpt(sentence) });
      if (sentenceWords.length > limit) {
        add("sentence-length", `${sentenceWords.length} words in a ${procedural ? "procedural" : "descriptive"} sentence (maximum ${limit}).`);
      }
      for (const match of sentence.matchAll(PASSIVE)) {
        if (NOT_PARTICIPLES.has(match[1].toLowerCase())) continue;
        add("passive-voice", `Possible passive voice: "${match[0]}". Name who or what does the action.`);
        break;
      }
      if (procedural && SEQUENCE.test(sentence)) {
        add("one-instruction", "This step has more than one instruction. Put each instruction in its own step.");
      }
      if (approved) {
        const unknown = [...new Set(sentenceWords.filter((word, index) => {
          if (isTechnicalName(word, index)) return false;
          const lower = word.toLowerCase().replace(/[’']s$/, "");
          return !approved.has(lower) && !(lower.endsWith("s") && approved.has(lower.slice(0, -1)));
        }))];
        if (unknown.length) add("unapproved-word", `Not in the approved word list: ${unknown.join(", ")}.`);
      }
    }
    if (block.kind === "paragraph" && blockSentences.length > STE_LIMITS.paragraphSentences) {
      findings.push({ line: block.line, rule: "paragraph-length",
        message: `${blockSentences.length} sentences in a paragraph (maximum ${STE_LIMITS.paragraphSentences}).`,
        text: excerpt(blockSentences[0]) });
    }
  }
  return findings;
}

const TEXT_EXTENSIONS = new Set([".md", ".markdown", ".txt"]);
const SKIPPED_DIRS = new Set([".git", "node_modules", ".dirf"]);

/**
 * Expand file and directory arguments to the Markdown and text files they contain.
 * @param {string[]} targets
 * @returns {string[]}
 */
export function steFiles(targets) {
  /** @type {string[]} */
  const files = [];
  /** @param {string} path */
  const visit = (path) => {
    if (statSync(path).isDirectory()) {
      for (const entry of readdirSync(path, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        if (entry.isDirectory() && SKIPPED_DIRS.has(entry.name)) continue;
        if (entry.isDirectory() || TEXT_EXTENSIONS.has(extname(entry.name).toLowerCase())) visit(join(path, entry.name));
      }
    } else files.push(path);
  };
  for (const target of targets) {
    const path = resolve(target);
    if (!existsSync(path)) throw new Error(`File not found: ${target}`);
    visit(path);
  }
  return files;
}

/**
 * Run `dirf ste check`. Returns the exit code: 0 = no findings, 1 = findings, 2 = usage.
 * @param {{ _: string[], words?: string, json?: boolean }} args
 * @param {{ log?: (line: string) => void, error?: (line: string) => void }} [io]
 */
export function runSteCheck(args, io = {}) {
  const log = io.log || ((line) => console.log(line));
  const error = io.error || ((line) => console.error(line));
  const [sub, ...targets] = args._;
  if (sub === "rules") {
    for (const [rule, text] of Object.entries(STE_RULES)) log(`${rule}: ${text}`);
    return 0;
  }
  if (sub !== "check" || !targets.length) {
    error("usage: dirf ste check <file-or-dir>... [--words FILE] [--json]\n       dirf ste rules");
    return 2;
  }
  const approved = args.words ? loadApprovedWords(args.words) : undefined;
  const results = steFiles(targets).map((file) => ({
    file: relative(process.cwd(), file) || file,
    findings: checkSte(readFileSync(file, "utf-8"), { words: approved }),
  }));
  const total = results.reduce((sum, result) => sum + result.findings.length, 0);
  if (args.json) log(JSON.stringify({ files: results.length, findings: total, results }, null, 2));
  else {
    for (const { file, findings } of results) {
      for (const finding of findings) log(`${file}:${finding.line}: ${finding.rule}: ${finding.message}\n    ${finding.text}`);
    }
    log(total
      ? `STE check: ${total} finding(s) in ${results.length} file(s). Each finding is a heuristic; review it before you change the text.`
      : `STE check: no findings in ${results.length} file(s).`);
  }
  return total ? 1 : 0;
}
