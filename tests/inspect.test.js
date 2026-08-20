import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspect, detectStack, detectStackProfile } from "../src/inspect.js";

test("Graphify suppresses the missing context-persistence suggestion", () => {
  const root = mkdtempSync(join(tmpdir(), "dirf-inspect-"));
  try {
    mkdirSync(join(root, "graphify-out"));
    writeFileSync(join(root, "graphify-out", "GRAPH_REPORT.md"), "# Graph");

    const result = inspect(root);

    assert.equal(result.suggestions.some((item) => item.gap.includes("memory / context-persistence")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("detectStack is exported and detects a web framework from package.json", () => {
  const root = mkdtempSync(join(tmpdir(), "dirf-inspect-"));
  try {
    writeFileSync(join(root, "package.json"), JSON.stringify({
      dependencies: { react: "^19", vite: "^5", "@tanstack/react-query": "^5" },
    }));
    const findings = detectStack(root);
    const items = findings.map((f) => f.item);
    assert.ok(items.includes("React"));
    assert.ok(items.includes("Vite"));
    assert.ok(items.includes("TanStack Query"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("detectStack detects Electron via dependency", () => {
  const root = mkdtempSync(join(tmpdir(), "dirf-inspect-"));
  try {
    writeFileSync(join(root, "package.json"), JSON.stringify({
      devDependencies: { electron: "^30", "electron-builder": "^24" },
    }));
    const findings = detectStack(root);
    const items = findings.map((f) => f.item);
    assert.ok(items.includes("Electron"), `expected Electron in ${JSON.stringify(items)}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("detectStack detects Electron via an electron/ directory (hoisted deps)", () => {
  const root = mkdtempSync(join(tmpdir(), "dirf-inspect-"));
  try {
    mkdirSync(join(root, "electron"));
    writeFileSync(join(root, "electron", "main.js"), "// main process\n");
    writeFileSync(join(root, "package.json"), JSON.stringify({ dependencies: {} }));
    const findings = detectStack(root);
    assert.ok(findings.some((f) => f.item === "Electron"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("detectStackProfile derives appKind web for a React/Vite repo", () => {
  // Representative modern web stack: React 19 + react-router + Zustand +
  // TanStack Query + Tailwind + Vite + Supabase, NO electron.
  const root = mkdtempSync(join(tmpdir(), "dirf-inspect-"));
  try {
    writeFileSync(join(root, "package.json"), JSON.stringify({
      dependencies: {
        react: "^19", "react-dom": "^19", "react-router-dom": "^7",
        zustand: "^5", "@tanstack/react-query": "^5",
        "tailwind-merge": "^3", "@supabase/supabase-js": "^2",
        "@ffmpeg/ffmpeg": "^0.12",
      },
      devDependencies: { vite: "^5" },
    }));
    const profile = detectStackProfile(root);
    assert.equal(profile.appKind, "web");
    assert.ok(profile.frameworks.includes("React"));
    assert.ok(!profile.frameworks.includes("Electron"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("detectStackProfile derives appKind electron when electron is present", () => {
  const root = mkdtempSync(join(tmpdir(), "dirf-inspect-"));
  try {
    writeFileSync(join(root, "package.json"), JSON.stringify({
      dependencies: { react: "^19" },
      devDependencies: { electron: "^30" },
    }));
    const profile = detectStackProfile(root);
    // Electron wins over web even when React is also present.
    assert.equal(profile.appKind, "electron");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("detectStackProfile returns unknown for a non-Node repo and for null root", () => {
  const root = mkdtempSync(join(tmpdir(), "dirf-inspect-"));
  try {
    // no package.json
    assert.equal(detectStackProfile(root).appKind, "unknown");
    // null/missing root is null-guarded (mirrors collectRoutingFacts)
    assert.equal(detectStackProfile(null).appKind, "unknown");
    assert.equal(detectStackProfile("").appKind, "unknown");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("detectStackProfile derives node for a backend-only runtime (no web UI)", () => {
  const root = mkdtempSync(join(tmpdir(), "dirf-inspect-"));
  try {
    writeFileSync(join(root, "package.json"), JSON.stringify({
      dependencies: { express: "^4" },
    }));
    const profile = detectStackProfile(root);
    assert.equal(profile.appKind, "node");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
