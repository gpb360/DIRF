import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadUnit, resolveGraph } from "../src/folders.js";
import { ROOT } from "../src/paths.js";
import {
  ANYDOC_PACKAGE,
  buildAnydocInvocation,
  normalizeDocument,
} from "../skills/document-artifact-ingestion/scripts/normalize-document.mjs";

const folder = join(ROOT, "skills", "document-artifact-ingestion");

test("document artifact skill is a valid self-contained DIRF unit", () => {
  const unit = loadUnit(folder);
  assert.equal(unit.meta.name, "document-artifact-ingestion");
  assert.equal(unit.meta.kind, "skill");
  assert.deepEqual(resolveGraph(folder).map((item) => item.meta.name), ["document-artifact-ingestion"]);
});

test("AnyDoc invocation is exact-version pinned and local", () => {
  const invocation = buildAnydocInvocation("policy.docx", "artifact.md");
  assert.equal(ANYDOC_PACKAGE, "@firecrawl/anydoc@0.1.8");
  assert.deepEqual(invocation.args.slice(-5), ["-y", ANYDOC_PACKAGE, "policy.docx", "-o", "artifact.md"]);
});

test("normalizer persists only Markdown and a metadata-only provenance manifest", async () => {
  const root = mkdtempSync(join(tmpdir(), "dirf-anydoc-"));
  const input = join(root, "policy.txt");
  const output = join(root, "artifacts", "policy.md");
  const manifest = join(root, "artifacts", "policy.json");
  const secret = "PRIVATE-SOURCE-CONTENT";
  writeFileSync(input, `${secret}\r\n`);

  const record = await normalizeDocument({ attemptRoot: root, input, output, manifest });
  const manifestText = readFileSync(manifest, "utf8");

  assert.equal(readFileSync(output, "utf8"), `${secret}\n`);
  assert.equal(record.parser.name, "builtin-text");
  assert.equal(manifestText.includes(secret), false);
  assert.equal("bytes" in record.source, false);
  assert.match(record.source.sha256, /^[a-f0-9]{64}$/);
  assert.match(record.artifact.sha256, /^[a-f0-9]{64}$/);
});

test("normalizer rejects outputs outside the current attempt", async () => {
  const root = mkdtempSync(join(tmpdir(), "dirf-anydoc-boundary-"));
  const input = join(root, "policy.txt");
  writeFileSync(input, "policy");
  await assert.rejects(
    () => normalizeDocument({
      attemptRoot: root,
      input,
      output: join(root, "outside.md"),
      manifest: join(root, "outside.json"),
    }),
    /inside the attempt artifacts directory/,
  );
});

test("normalizer discards an artifact when source bytes change during conversion", async () => {
  const root = mkdtempSync(join(tmpdir(), "dirf-anydoc-race-"));
  const input = join(root, "controls.csv");
  const output = join(root, "artifacts", "controls.md");
  const manifest = join(root, "artifacts", "controls.json");
  writeFileSync(input, "control,status\nA,pass\n");

  await assert.rejects(
    () => normalizeDocument(
      { attemptRoot: root, input, output, manifest },
      {
        convertWithAnydoc: (_source, target) => {
          writeFileSync(target, "| control | status |\n| --- | --- |\n| A | pass |\n");
          writeFileSync(input, "control,status\nA,changed\n");
        },
      },
    ),
    /source changed during normalization/,
  );
  assert.equal(readFileSync(input, "utf8").includes("changed"), true);
  assert.equal(existsSync(output), false);
  assert.equal(existsSync(manifest), false);
});

test("real AnyDoc CSV conversion produces a provenance-bound artifact", {
  skip: process.env.RUN_ANYDOC_INTEGRATION !== "1",
}, async () => {
  const root = mkdtempSync(join(tmpdir(), "dirf-anydoc-live-"));
  const input = join(root, "controls.csv");
  const output = join(root, "artifacts", "controls.md");
  const manifest = join(root, "artifacts", "controls.json");
  writeFileSync(input, "control,status\nA,pass\n");

  const record = await normalizeDocument({ attemptRoot: root, input, output, manifest });

  assert.equal(record.parser.package, ANYDOC_PACKAGE);
  assert.match(readFileSync(output, "utf8"), /control|status|pass/i);
  assert.equal(readFileSync(manifest, "utf8").includes("A,pass"), false);
});
