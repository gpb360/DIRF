import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  assertPublicHttpsUrl,
  classifyLearningSource,
  extractYouTubePlayerResponse,
  fetchTextSafely,
  htmlToMarkdown,
  ingestLearningSource,
  transcriptFromJson3,
  transcriptFromVtt,
  transcriptFromXml,
  youtubeVideoId,
} from "../src/learn.js";

function attemptRoot() {
  const root = mkdtempSync(join(tmpdir(), "dirf-learn-"));
  mkdirSync(join(root, "artifacts"));
  return root;
}

test("classifies pasted text, exact files, pages, and YouTube links", () => {
  const root = mkdtempSync(join(tmpdir(), "dirf-source-"));
  const file = join(root, "reference.md");
  writeFileSync(file, "# Reference\n");
  assert.equal(classifyLearningSource("plain article text").kind, "text");
  assert.equal(classifyLearningSource(file).kind, "file");
  assert.equal(classifyLearningSource("./missing-reference.pdf").kind, "file");
  assert.equal(classifyLearningSource("https://example.com/docs").kind, "web");
  assert.equal(classifyLearningSource("https://youtu.be/abc123").kind, "youtube");
});

test("converts useful HTML structure while dropping executable page content", () => {
  const result = htmlToMarkdown(`
    <html><head><title>Useful Docs</title><script>ignore()</script></head>
    <body><article><h1>Install</h1><p>Use <code>safe()</code>.</p><pre>const x = 1;</pre></article></body></html>
  `);
  assert.equal(result.title, "Useful Docs");
  assert.match(result.markdown, /# Install/);
  assert.match(result.markdown, /`safe\(\)`/);
  assert.match(result.markdown, /```\nconst x = 1;\n```/);
  assert.doesNotMatch(result.markdown, /ignore/);
});

test("rejects URLs that resolve to local infrastructure", async () => {
  await assert.rejects(
    assertPublicHttpsUrl("https://example.test/docs", {
      lookup: async () => [{ address: "127.0.0.1", family: 4 }],
    }),
    /private or local/,
  );
  await assert.rejects(assertPublicHttpsUrl("http://example.com"), /must use HTTPS/);
});

test("stops reading a remote body as soon as it exceeds the byte limit", async () => {
  let cancelled = false;
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(Buffer.from("123"));
      controller.enqueue(Buffer.from("456"));
    },
    cancel() { cancelled = true; },
  });
  await assert.rejects(fetchTextSafely("https://example.test/article", { maxBytes: 5 }, {
    lookup: async () => [{ address: "93.184.216.34", family: 4 }],
    fetch: async () => new Response(body, { status: 200, headers: { "content-type": "text/plain" } }),
  }), /exceeds the 5 byte limit/);
  assert.equal(cancelled, true);
});

test("extracts a public YouTube player response and JSON3 transcript", () => {
  const player = {
    videoDetails: { title: "DIRF patterns" },
    captions: { playerCaptionsTracklistRenderer: { captionTracks: [] } },
  };
  const html = `<script>var ytInitialPlayerResponse = ${JSON.stringify(player)};</script>`;
  assert.deepEqual(extractYouTubePlayerResponse(html), player);
  assert.equal(youtubeVideoId("https://www.youtube.com/watch?v=abc123"), "abc123");
  assert.equal(transcriptFromJson3({ events: [
    { segs: [{ utf8: "First " }, { utf8: "idea" }] },
    { segs: [{ utf8: "Second idea" }] },
  ] }), "First idea\nSecond idea");
  assert.equal(transcriptFromXml('<transcript><text start="0">First &amp; safe</text><text start="1">Second</text></transcript>'), "First & safe\nSecond");
  assert.equal(transcriptFromVtt("WEBVTT\n\n00:00.000 --> 00:01.000\nFirst idea\n\n00:01.000 --> 00:02.000\nSecond idea"), "First idea\nSecond idea");
});

test("ingests a mocked YouTube transcript with provenance and no code execution", async () => {
  const root = attemptRoot();
  const player = {
    videoDetails: { title: "Workflow upgrade" },
    captions: { playerCaptionsTracklistRenderer: { captionTracks: [
      { baseUrl: "https://www.youtube.com/api/timedtext?v=abc", languageCode: "en", kind: "asr" },
    ] } },
  };
  const responses = [
    { body: `<script>var ytInitialPlayerResponse = ${JSON.stringify(player)};</script>`, finalUrl: "https://www.youtube.com/watch?v=abc" },
    { body: "", bytes: Buffer.alloc(0) },
    { body: '<transcript><text start="0">Use a bounded adapter.</text></transcript>', bytes: Buffer.from("caption-xml") },
  ];
  const result = await ingestLearningSource({
    attemptRoot: root,
    input: "https://www.youtube.com/watch?v=abc",
  }, {
    fetchText: async () => responses.shift(),
  });
  assert.equal(result.kind, "youtube");
  assert.equal(readFileSync(result.artifactPath, "utf8"), "Use a bounded adapter.\n");
  const manifest = JSON.parse(readFileSync(result.manifestPath, "utf8"));
  assert.equal(manifest.source.kind, "youtube");
  assert.equal(manifest.parser.language, "en");
  assert.equal(manifest.safety.codeExecution, "disabled");
  assert.equal(manifest.safety.repositoryWrites, "none");
});

test("normalizes an explicitly selected local text document", async () => {
  const root = attemptRoot();
  const input = join(root, "reference.md");
  writeFileSync(input, "# Reference\r\n\r\nKeep this pattern.\r\n");
  const result = await ingestLearningSource({ attemptRoot: root, explicitFile: input });
  assert.equal(result.kind, "file");
  assert.equal(readFileSync(result.artifactPath, "utf8"), "# Reference\n\nKeep this pattern.\n");
  const manifest = JSON.parse(readFileSync(result.manifestPath, "utf8"));
  assert.equal(manifest.parser.name, "builtin-text");
});

test("rejects unsafe transcript language selectors", async () => {
  await assert.rejects(ingestLearningSource({
    attemptRoot: attemptRoot(),
    input: "https://youtu.be/abc",
    language: "*",
  }), /language must be a short language code/);
});
