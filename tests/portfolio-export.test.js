import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAttemptInStore, portfolioSnapshot, registerProject, setProjectStatus, startTrackingAttempt } from "../src/state.js";
import { exportGraphify, exportObsidian } from "../src/exports.js";

function fixture(attemptNames = ["alpha", "beta"]) {
  const home = mkdtempSync(join(tmpdir(), "dirf-portfolio-export-"));
  process.env.DIRF_HOME = home;
  const root = mkdtempSync(join(tmpdir(), "dirf-portfolio-export-repo-"));
  execFileSync("git", ["init", "-q"], { cwd: root });
  const { slug } = registerProject(root);
  const attempts = attemptNames.map((name, i) => {
    const date = new Date(2026, 7, 1 + i);
    const attempt = createAttemptInStore(slug, name, date);
    writeFileSync(join(attempt.folder, "HANDOFF.md"), "## Exact next action\n\nShip it.\n");
    return startTrackingAttempt(slug, attempt.id, date);
  });
  return { home, root, slug, attempts };
}

test("obsidian export writes notes, readme and a valid canvas", () => {
  const { slug, attempts } = fixture();
  const outDir = mkdtempSync(join(tmpdir(), "dirf-obs-out-"));
  const written = exportObsidian(portfolioSnapshot(), { outDir });
  const root = join(outDir, "DIRF Portfolio");

  assert.ok(written.includes(join(root, "README.md")));
  assert.ok(written.includes(join(root, "DIRF Portfolio.canvas")));
  assert.ok(existsSync(join(root, "projects", `${slug}.md`)));
  assert.ok(existsSync(join(root, "attempts", `${attempts[0].id}.md`)));

  const projectNote = readFileSync(join(root, "projects", `${slug}.md`), "utf8");
  assert.match(projectNote, /^status: /m);
  assert.match(projectNote, /\[\[attempts\//);
  assert.match(projectNote, /Ship it\./);

  const readme = readFileSync(join(root, "README.md"), "utf8");
  assert.match(readme, new RegExp(`\\[\\[projects/${slug}\\|`));

  // JSON Canvas validity: parses, unique ids, no dangling edges, groups present.
  const canvas = JSON.parse(readFileSync(join(root, "DIRF Portfolio.canvas"), "utf8"));
  assert.equal(canvas.nodes.length, new Set(canvas.nodes.map((n) => n.id)).size);
  assert.ok(canvas.nodes.some((n) => n.type === "group"));
  assert.ok(canvas.nodes.some((n) => n.type === "text"));
  assert.ok(canvas.nodes.some((n) => n.type === "file" && n.file === `attempts/${attempts[0].id}.md`));
  const ids = new Set(canvas.nodes.map((n) => n.id));
  for (const edge of canvas.edges) {
    assert.ok(ids.has(edge.fromNode), `dangling fromNode ${edge.fromNode}`);
    assert.ok(ids.has(edge.toNode), `dangling toNode ${edge.toNode}`);
  }
});

test("obsidian export reflects explicit project status", () => {
  const { slug } = fixture(["one"]);
  const outDir = mkdtempSync(join(tmpdir(), "dirf-obs-out-"));
  setProjectStatus(slug, "archived");
  exportObsidian(portfolioSnapshot(), { outDir });
  const note = readFileSync(join(outDir, "DIRF Portfolio", "projects", `${slug}.md`), "utf8");
  assert.match(note, /status: archived/);
  assert.match(note, /explicit_status: archived/);
});

test("graphify export writes a well-formed graph.json", () => {
  const { attempts } = fixture();
  const outDir = mkdtempSync(join(tmpdir(), "dirf-graph-out-"));
  const result = exportGraphify(portfolioSnapshot(), { outDir });

  assert.ok(existsSync(result.graphPath));
  const graph = JSON.parse(readFileSync(result.graphPath, "utf8"));
  assert.equal(result.nodeCount, graph.nodes.length);
  assert.equal(result.edgeCount, graph.edges.length);
  assert.ok(result.nodeCount >= 3, "project node + attempt nodes");
  assert.equal(new Set(graph.nodes.map((n) => n.id)).size, graph.nodes.length, "unique node ids");

  assert.ok(graph.nodes.some((n) => n.attributes?.kind === "project" && n.attributes?.status));
  assert.ok(graph.nodes.some((n) => n.attributes?.kind === "attempt" && n.attributes?.status === "planned"));
  assert.equal(graph.nodes.filter((n) => n.attributes?.kind === "attempt").length, attempts.length);

  const ids = new Set(graph.nodes.map((n) => n.id));
  for (const edge of graph.edges) {
    assert.ok(ids.has(edge.source), `dangling source ${edge.source}`);
    assert.ok(ids.has(edge.target), `dangling target ${edge.target}`);
    assert.ok(["EXTRACTED", "INFERRED", "AMBIGUOUS"].includes(edge.confidence));
    assert.ok(typeof edge.source_file === "string" && edge.source_file.length > 0);
  }
  // Chronological next-action edges: alpha -> beta.
  assert.ok(graph.edges.some((e) => e.relation === "conceptually_related_to"));
});
