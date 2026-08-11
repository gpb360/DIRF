#!/usr/bin/env node
import {
  chmodSync,
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const ANYDOC_PACKAGE = "@firecrawl/anydoc@0.1.8";
export const MAX_SOURCE_BYTES = 25 * 1024 * 1024;
export const MAX_ARTIFACT_BYTES = 5 * 1024 * 1024;
export const CONVERSION_TIMEOUT_MS = 120_000;

const TEXT_EXTENSIONS = new Set([
  ".md", ".markdown", ".txt", ".json", ".xml", ".html", ".htm",
  ".yaml", ".yml", ".rst",
]);
const ANYDOC_EXTENSIONS = new Set([
  ".doc", ".docx", ".docm", ".odt", ".rtf", ".epub", ".pdf",
  ".ppt", ".pps", ".pot", ".pptx", ".pptm", ".ppsx", ".ppsm",
  ".xls", ".xlsx", ".xlsm", ".xlsb", ".ods", ".odp", ".csv",
]);

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || !value) throw new Error("arguments must be --key value pairs");
    values[key.slice(2)] = value;
  }
  return values;
}

async function sha256File(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

export function buildAnydocInvocation(input, output) {
  const anydocArgs = ["-y", ANYDOC_PACKAGE, input, "-o", output];
  if (process.platform === "win32") {
    const npxCli = join(dirname(process.execPath), "node_modules", "npm", "bin", "npx-cli.js");
    if (!existsSync(npxCli)) throw new Error(`npm npx CLI not found beside Node: ${npxCli}`);
    return { command: process.execPath, args: [npxCli, ...anydocArgs] };
  }
  return {
    command: "npx",
    args: anydocArgs,
  };
}

function normalizeText(input, output) {
  const markdown = readFileSync(input, "utf8")
    .replace(/\r\n?/g, "\n")
    .split("\u0000").join("")
    .trim();
  if (!markdown) throw new Error("no meaningful Markdown extracted");
  writeFileSync(output, `${markdown}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
}

function convertWithAnydoc(input, output) {
  const invocation = buildAnydocInvocation(input, output);
  const result = spawnSync(invocation.command, invocation.args, {
    encoding: "utf8",
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    timeout: CONVERSION_TIMEOUT_MS,
    maxBuffer: 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || "conversion failed").trim().slice(0, 500);
    throw new Error(`AnyDoc exited ${result.status}: ${detail}`);
  }
}

export async function normalizeDocument(options, dependencies = {}) {
  const attemptRoot = resolve(String(options.attemptRoot || ""));
  const input = resolve(String(options.input || ""));
  const output = resolve(String(options.output || ""));
  const manifest = resolve(String(options.manifest || ""));
  if (!options.attemptRoot || !options.input || !options.output || !options.manifest) {
    throw new Error("--attempt-root, --input, --output, and --manifest are required");
  }
  if (input === output || input === manifest || output === manifest) {
    throw new Error("input, output, and manifest paths must be distinct");
  }
  if (!existsSync(input) || !statSync(input).isFile()) throw new Error("authorized input must be an existing file");
  if (!existsSync(attemptRoot) || !statSync(attemptRoot).isDirectory()) {
    throw new Error("attempt root must be an existing directory");
  }
  const artifactRoot = resolve(attemptRoot, "artifacts");
  const isArtifactPath = (path) => {
    const rel = relative(artifactRoot, path);
    return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
  };
  if (!isArtifactPath(output) || !isArtifactPath(manifest)) {
    throw new Error("output and manifest must stay inside the attempt artifacts directory");
  }
  if (extname(output).toLowerCase() !== ".md") throw new Error("artifact output must use .md");
  if (extname(manifest).toLowerCase() !== ".json") throw new Error("manifest output must use .json");
  if (existsSync(output) || existsSync(manifest)) throw new Error("refusing to overwrite artifact output");

  const extension = extname(input).toLowerCase();
  if (!TEXT_EXTENSIONS.has(extension) && !ANYDOC_EXTENSIONS.has(extension)) {
    throw new Error(`unsupported document format: ${extension || "none"}`);
  }
  mkdirSync(dirname(output), { recursive: true });
  mkdirSync(dirname(manifest), { recursive: true });

  const sourceStat = statSync(input);
  if (sourceStat.size > MAX_SOURCE_BYTES) throw new Error("source exceeds the 25 MB limit");
  const sourceSha256 = await sha256File(input);
  try {
    if (TEXT_EXTENSIONS.has(extension)) normalizeText(input, output);
    else (dependencies.convertWithAnydoc || convertWithAnydoc)(input, output);
    if (!existsSync(output) || statSync(output).size === 0) throw new Error("converter produced no artifact");
    if (statSync(output).size > MAX_ARTIFACT_BYTES) throw new Error("artifact exceeds the 5 MB limit");
    const sourceSha256After = await sha256File(input);
    if (sourceSha256After !== sourceSha256) {
      throw new Error("source changed during normalization; artifact discarded");
    }
    chmodSync(output, 0o600);

    const record = {
      schema: "dirf.evidence-artifact.v1",
      source: {
        ref: input,
        sha256: sourceSha256,
        sizeBytes: sourceStat.size,
        authorizedBy: "explicit-input",
      },
      artifact: {
        ref: output,
        contentType: "text/markdown",
        sha256: await sha256File(output),
        sizeBytes: statSync(output).size,
      },
      parser: TEXT_EXTENSIONS.has(extension)
        ? { name: "builtin-text", version: "1" }
        : { name: "anydoc", version: "0.1.8", package: ANYDOC_PACKAGE },
      createdAt: new Date().toISOString(),
    };
    writeFileSync(manifest, `${JSON.stringify(record, null, 2)}\n`, {
      encoding: "utf8", flag: "wx", mode: 0o600,
    });
    return record;
  } catch (error) {
    if (existsSync(output)) rmSync(output, { force: true });
    if (existsSync(manifest)) rmSync(manifest, { force: true });
    throw error;
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  normalizeDocument(parseArgs(process.argv.slice(2)))
    .then((record) => process.stdout.write(`${JSON.stringify(record)}\n`))
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
