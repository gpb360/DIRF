// Deterministic public-tree checks. Keep private project context and local
// workstation state out of the publishable repository and package surfaces.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT } from "./paths.js";

const SKIPPED_DIRECTORIES = new Set([".git", "node_modules"]);
const TEXT_EXTENSIONS = new Set([
  ".cjs", ".css", ".html", ".js", ".json", ".md", ".mjs", ".ps1",
  ".sh", ".ts", ".txt", ".yaml", ".yml",
]);
const TEXT_FILES = new Set([".gitignore", ".npmignore", "LICENSE"]);
const COMPATIBILITY_FILES = new Set(["CHANGELOG.md", "npm-shrinkwrap.json", "package-lock.json", "package.json"]);

const joinedPattern = (parts, flags = "i") => new RegExp(parts.join(""), flags);

const LEGACY_PACKAGE_PATTERN = joinedPattern(["a", "mf", "-", "dirf"]);
const DENIED_CONTENT = [
  // Deliberately public references (FlowStack integration docs, research
  // reviews of external systems, test fixtures) are not private leaks; the
  // gate protects personal/private context, not documented partners.
  { pattern: joinedPattern(["story", "tellers"]), reason: "private project name" },
  { pattern: joinedPattern(["agent", "\\s+", "spec", "\\s+", "kit"]), reason: "retired product identity" },
  { pattern: joinedPattern(["agent", "\\s+", "marketing", "\\s+", "factory"]), reason: "retired product identity" },
  { pattern: joinedPattern(["\\b", "AM", "F", "\\b(?!-dirf)"]), reason: "retired product identity" },
  { pattern: joinedPattern(["gar", "yp"]), reason: "local workstation identity" },
  {
    pattern: joinedPattern(["[A-Za-z]:[\\\\/]+", "Users", "[\\\\/]+[^\\s\\\"'`]+"]),
    reason: "local user-profile path",
  },
  {
    pattern: joinedPattern(["(?:/", "Users", "/|/", "home", "/)[^/\\s\\\"'`]+/"]),
    reason: "local user-profile path",
  },
  {
    pattern: joinedPattern(["[A-Za-z]:[\\\\/]+", "s7s", "-", "projects", "[\\\\/]"]),
    reason: "local checkout path",
  },
];

const DENIED_PATHS = [
  { pattern: /(?:^|\/)\.dirf(?:\/|$)/i, reason: "canonical DIRF state" },
  { pattern: /(?:^|\/)attempts(?:\/|$)/i, reason: "private attempt state" },
  { pattern: /^HANDOFF\.md$/i, reason: "private handoff" },
  { pattern: /(?:^|\/)(?:installed-skills|skills-inventory|workspace-inventory)(?:[._-]|$)/i, reason: "machine-derived inventory" },
];

function lineNumber(text, index) {
  return text.slice(0, index).split(/\r?\n/).length;
}

function isTextFile(name) {
  return TEXT_FILES.has(name) || TEXT_EXTENSIONS.has(extname(name).toLowerCase());
}

function listPublicationFiles(root) {
  if (existsSync(join(root, ".git"))) {
    try {
      return execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
        cwd: root,
        encoding: "utf8",
      }).split("\0").filter(Boolean).sort();
    } catch {
      // Fail strict if checkout metadata is present but unreadable: the
      // filesystem walk may inspect more than Git would, never less.
    }
  }

  // Installed packages and isolated fixtures have no Git metadata.
  const files = [];
  function walk(directory, prefix = "") {
    const entries = readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      if (entry.isDirectory() && SKIPPED_DIRECTORIES.has(entry.name)) continue;
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolutePath = join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(absolutePath, relativePath);
        continue;
      }
      if (!entry.isSymbolicLink() && entry.isFile()) files.push(relativePath);
    }
  }
  walk(root);
  return files;
}

export function validatePublicationBoundary(root = ROOT) {
  const errors = [];

  for (const relativePath of listPublicationFiles(root)) {
    const absolutePath = join(root, relativePath);
    if (!existsSync(absolutePath)) continue;

    const deniedPath = DENIED_PATHS.find((rule) => rule.pattern.test(relativePath));
    if (deniedPath) {
      errors.push(`publication boundary: ${relativePath}: ${deniedPath.reason}`);
      continue;
    }
    if (!isTextFile(relativePath)) continue;

    const text = readFileSync(absolutePath, "utf8");
    const contentRules = COMPATIBILITY_FILES.has(relativePath)
      ? DENIED_CONTENT
      : [{ pattern: LEGACY_PACKAGE_PATTERN, reason: "legacy package identifier outside its compatibility surfaces" }, ...DENIED_CONTENT];

    for (const rule of contentRules) {
      const match = rule.pattern.exec(text);
      if (match) {
        errors.push(`publication boundary: ${relativePath}:${lineNumber(text, match.index)}: ${rule.reason}`);
      }
    }
  }
  return errors;
}

export function main(root = ROOT) {
  const errors = validatePublicationBoundary(root);
  if (errors.length) {
    console.log("Publication boundary failed:");
    for (const error of errors) console.log(`  - ${error}`);
    process.exitCode = 1;
    return;
  }
  console.log("Publication boundary passed");
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main();
}
