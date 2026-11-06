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
  `\\b(?:am|is|are|was|were|be|been|being)\\s+(?:(?:not|never)\\s+)?(?:[a-z]+ly\\s+)?([a-z]+ed|${IRREGULAR_PARTICIPLES.join("|")})\\b(?!-)`, "gi");
const SEQUENCE = /(?:\band then\b|,\s*then\b|;\s*then\b|;)/i;
const ABBREVIATIONS = /\b(e\.g|i\.e|etc|vs|approx|fig|cf)\./gi;
const CODE_TOKEN = "CODE";

/**
 * @typedef {{ line: number, rule: keyof typeof STE_RULES, message: string, text: string }} SteFinding
 * @typedef {{ line: number, text: string, kind: "paragraph" | "procedure" | "item", lines: { line: number, text: string }[] }} Block
 */

// Marks the start of each source line inside a joined paragraph, so that a
// finding can report the line where its sentence starts. It is not a word character.
const LINE_MARK = "\u0001";
const LINE_MARKS = /\u0001/g;

/**
 * The line marks inside text that inline cleanup removes, so that no mark is lost.
 * @param {string} text
 */
const marksOf = (text) => (text.match(LINE_MARKS) || []).join("");

// A link destination, as CommonMark defines it: "<...>" or a run with no
// spaces (one level of parentheses allowed), then an optional title. A line
// wrap (spaces and a line mark) can stand where spaces can.
// Only one part of the pattern can match a given run of spaces and line
// marks. Overlapping repeats here made the match time grow with the cube of
// the line count.
const LINK_PART = String.raw`(?:[^()\s\u0001]|\([^()\s\u0001]*\))+`;
const LINK_DESTINATION = String.raw`\([\s\u0001]*(?:(?:<[^<>]*>|${LINK_PART}(?:\s*\u0001${LINK_PART})*)[\s\u0001]*)?(?:(?:"[^"]*"|'[^']*'|\([^()]*\))[\s\u0001]*)?\)`;

/**
 * Replace inline Markdown with the words a reader sees. Code and URLs count as one word.
 * @param {string} text
 */
function plainInline(text) {
  return text
    // A label stops at the next "[" and a destination stops at a space that
    // is not a line wrap. Each scan then ends at the next bracket or space,
    // so unclosed brackets stay fast with no length limit.
    .replace(/\[\^[^[\]\s]+\](?!\()/g, (note) => marksOf(note))
    .replace(new RegExp(`!\\[[^[\\]]*\\]${LINK_DESTINATION}`, "g"), (image) => ` ${marksOf(image)}`)
    .replace(new RegExp(`\\[([^[\\]]*)\\]${LINK_DESTINATION}`, "g"), (link, label) => `${label}${marksOf(link.slice(label.length + 2))}`)
    .replace(/`[^`]*`/g, (code) => CODE_TOKEN + marksOf(code))
    .replace(/<!--[\s\S]*?-->/g, (comment) => ` ${marksOf(comment)}`)
    .replace(/<(?:https?:|mailto:)[^<>\s]*>/g, (link) => CODE_TOKEN + marksOf(link))
    // Only a real tag is markup. A bare "<", as in "count < 5", is text.
    .replace(/<\/?[A-Za-z][\w:-]*(?:\s[^<>]*)?\/?>/g, (tag) => ` ${marksOf(tag)}`)
    .replace(/&(amp|lt|gt|quot|apos|nbsp|#\d{1,7}|#x[0-9a-f]{1,6});/gi, (_, name) => decodeEntity(name))
    // A URL does not take the punctuation that ends its sentence.
    .replace(/https?:\/\/[^\s\u0001]*[^\s\u0001.,;:!?'")\]]/g, CODE_TOKEN)
    .replace(/[*_]{1,3}([^*_]+)[*_]{1,3}/g, "$1")
    // A backslash at the end of a line is a Markdown line break, not text.
    .replace(/\\(?=[\s\u0001]|$)/g, "")
    // Keep each line mark directly before the next word, not before a space,
    // so that a mark never stands between a sentence end and its space.
    // Start only at the first mark of a run, so a long run stays linear.
    .replace(/(?<!\u0001)(\u0001+)(\s+)/g, "$2$1")
    .replace(/\s+/g, " ")
    .trim();
}

/** @type {Record<string, string>} */
const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/**
 * The text of a named or numeric HTML entity.
 * @param {string} name The entity without "&" and ";".
 */
function decodeEntity(name) {
  if (!name.startsWith("#")) return ENTITIES[name.toLowerCase()] ?? " ";
  const code = /^#x/i.test(name) ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
  return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : " ";
}

/**
 * Split Markdown or plain text into prose blocks. Code, tables, headings,
 * front matter, and HTML comments are not prose and are skipped.
 * @param {string} source
 * @returns {Block[]}
 */
export function proseBlocks(source) {
  const lines = String(source).replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").split("\n");
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
    // Quote markers do not change what a line is: code, comment, or prose.
    let body = lines[i].trim().replace(/^(?:>\s?)+/, "").trim();
    // A fence closes only on a line of the same character, at least as long.
    if (fence) { if (body.startsWith(fence) && [...body].every((c) => c === fence[0])) fence = ""; continue; }
    // Text after a comment closes on the same line is still prose.
    if (comment || body.startsWith("<!--")) {
      if (!comment) flush();
      const end = body.indexOf("-->", comment ? 0 : 4);
      comment = end === -1;
      body = comment ? "" : body.slice(end + 3).trim();
      if (!body) continue;
    }
    // A backtick fence has no backtick after it on its line. Otherwise the
    // line starts with an inline code span, as in "```x``` is code".
    const fenceMatch = body.match(/^(`{3,})(?!.*`)|^(~{3,})/);
    if (fenceMatch) { flush(); fence = fenceMatch[1] || fenceMatch[2]; continue; }
    if (body.startsWith("<!--")) { flush(); comment = !body.includes("-->"); continue; }
    if (!body || /^#{1,6}\s/.test(body) || body.startsWith("|") || /^(?:-{3,}|\*{3,}|_{3,})$/.test(body)) { flush(); continue; }
    const ordered = body.match(/^\d+[.)]\s+(.*)$/);
    const bullet = body.match(/^[-*+]\s+(?:\[[ xX]\]\s+)?(.*)$/);
    if (ordered || bullet) {
      flush();
      const itemText = (ordered || bullet)?.[1] || "";
      current = { line: i + 1, text: itemText, kind: ordered ? "procedure" : "item", lines: [{ line: i + 1, text: itemText }] };
      continue;
    }
    if (current) { current.text += ` ${body}`; current.lines.push({ line: i + 1, text: body }); }
    else current = { line: i + 1, text: body, kind: "paragraph", lines: [{ line: i + 1, text: body }] };
  }
  flush();
  return blocks;
}

/**
 * Split text into sentences. Line marks stay in place, and empty pieces stay
 * in the list so that their marks are still counted.
 * @param {string} text
 * @returns {string[]}
 */
function markedSentences(text) {
  const protectedText = plainInline(text).replace(ABBREVIATIONS, "$1");
  return protectedText.split(/(?<=[.!?])["')\]]*\s+(?=[\u0001\s]*["'(\[]?[A-Z0-9])/).map((piece) => piece.trim());
}

/** @param {string} sentence */
const unmarked = (sentence) => sentence.replace(LINE_MARKS, "").replace(/\s+/g, " ").trim();

/** @param {string} text */
export function sentences(text) {
  return markedSentences(text).map(unmarked).filter(Boolean);
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
  const source = readFileSync(resolve(file), "utf-8").replace(/^\uFEFF/, "");
  const list = /^[[{]/.test(source.trim())
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
 * The sentences of a block, each with the source line where it starts.
 * @param {Block} block
 * @returns {{ line: number, text: string }[]}
 */
function blockSentences(block) {
  const pieces = markedSentences(block.lines.map((segment) => LINE_MARK + segment.text).join(" "));
  /** @type {{ line: number, text: string }[]} */
  const result = [];
  let marks = 0;
  for (const piece of pieces) {
    // Count every line mark before the first word. Markup that stood alone on
    // a line leaves spaces and punctuation between the marks.
    const leading = marksOf(piece.match(/^[^A-Za-z0-9]*/)?.[0] || "").length;
    const index = Math.max(0, Math.min(marks + leading, block.lines.length) - 1);
    marks += (piece.match(LINE_MARKS) || []).length;
    const text = unmarked(piece);
    if (text) result.push({ line: block.lines[index].line, text });
  }
  return result;
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
    const procedural = block.kind === "procedure";
    const limit = procedural ? STE_LIMITS.procedural : STE_LIMITS.descriptive;
    const found = blockSentences(block);
    for (const { line, text: sentence } of found) {
      const sentenceWords = words(sentence);
      const add = (/** @type {keyof typeof STE_RULES} */ rule, /** @type {string} */ message) =>
        findings.push({ line, rule, message, text: excerpt(sentence) });
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
    if (block.kind === "paragraph" && found.length > STE_LIMITS.paragraphSentences) {
      findings.push({ line: found[0].line, rule: "paragraph-length",
        message: `${found.length} sentences in a paragraph (maximum ${STE_LIMITS.paragraphSentences}).`,
        text: excerpt(found[0].text) });
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
  if (sub !== "check" || !targets.length || args.words === "") {
    error("usage: dirf ste check <file-or-dir>... [--words FILE] [--json]\n       dirf ste rules");
    return 2;
  }
  /** @type {{ file: string, findings: SteFinding[] }[]} */
  let results;
  try {
    const approved = args.words ? loadApprovedWords(args.words) : undefined;
    results = steFiles(targets).map((file) => ({
      file: relative(process.cwd(), file) || file,
      findings: checkSte(readFileSync(file, "utf-8"), { words: approved }),
    }));
  } catch (cause) {
    // Exit 1 means "findings". An unreadable input is an error, not a finding.
    error(`dirf ste: ${cause instanceof Error ? cause.message : String(cause)}`);
    return 2;
  }
  const total = results.reduce((sum, result) => sum + result.findings.length, 0);
  if (args.json) log(JSON.stringify({ files: results.length, findings: total, results }, null, 2));
  else {
    for (const { file, findings } of results) {
      for (const finding of findings) log(`${file}:${finding.line}: ${finding.rule}: ${finding.message}\n    ${finding.text}`);
    }
    log(total
      ? `STE check: ${total} finding(s) in ${results.length} file(s). Each finding is a heuristic. Review it before you change the text.`
      : `STE check: no findings in ${results.length} file(s).`);
  }
  return total ? 1 : 0;
}
