import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import {
  assertPublicHttpsUrl,
  classifyLearningSource,
  extractYouTubePlayerResponse,
  fetchTextSafely,
  githubRepositoryRef,
  htmlToMarkdown,
  linkedMarkdownPaths,
  ingestLearningSource,
  transcriptFromJson3,
  transcriptFromVtt,
  transcriptFromXml,
  youtubeVideoId,
  ytDlpCaptionLanguages,
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

test("recognizes GitHub repository and folder URLs only", () => {
  assert.deepEqual(githubRepositoryRef("https://github.com/Leonxlnx/cook#install"), { owner: "Leonxlnx", repo: "cook", ref: "HEAD", folder: "" });
  assert.deepEqual(githubRepositoryRef("https://github.com/o/r/tree/main/skills/x"), { owner: "o", repo: "r", ref: "main", folder: "skills/x" });
  assert.equal(githubRepositoryRef("https://github.com/o/r/issues/1"), null);
  assert.equal(githubRepositoryRef("https://github.com/topics/ai"), null);
  assert.equal(githubRepositoryRef("https://example.com/o/r"), null);
  // A malformed percent escape falls back to web intake instead of throwing.
  assert.equal(githubRepositoryRef("https://github.com/o/r%/tree/x"), null);
  assert.equal(githubRepositoryRef("https://github.com/o/r/tree/main/docs%E0%A4%A"), null);
  assert.equal(classifyLearningSource("https://github.com/o/r").kind, "github");
});

test("keeps only safe relative Markdown paths from links and code spans", () => {
  assert.deepEqual(
    linkedMarkdownPaths("[a](references/a.md) `templates/B.md` [x](https://e.com/x.md) `../up.md` `/abs.md` [c](./c.md#part)"),
    ["references/a.md", "c.md", "templates/B.md"],
  );
});

test("ingests a GitHub skill as raw SKILL.md plus the Markdown files it names", async () => {
  const root = attemptRoot();
  const files = {
    "https://raw.githubusercontent.com/o/cook/HEAD/SKILL.md": "# Cook\nRead `references/loop.md` and [brief](templates/brief.md). Ignore [ext](https://e.com/x.md).",
    "https://raw.githubusercontent.com/o/cook/HEAD/README.md": "# cook readme",
    "https://raw.githubusercontent.com/o/cook/HEAD/references/loop.md": "# Loop\nSee `rules.md`.",
    "https://raw.githubusercontent.com/o/cook/HEAD/references/rules.md": "# Rules",
    "https://raw.githubusercontent.com/o/cook/HEAD/templates/brief.md": "# Brief",
  };
  const requested = [];
  const result = await ingestLearningSource({ attemptRoot: root, input: "https://github.com/o/cook#install" }, {
    fetchText: async (url) => {
      requested.push(url);
      if (!(url in files)) throw new Error("learning URL returned HTTP 404");
      return { body: files[url], bytes: Buffer.from(files[url]) };
    },
  });
  assert.equal(result.kind, "github");
  assert.ok(requested.every((url) => url.startsWith("https://raw.githubusercontent.com/o/cook/HEAD/")));
  const markdown = readFileSync(result.artifactPath, "utf8");
  for (const text of ["# Cook", "# cook readme", "# Loop", "# Rules", "# Brief"]) assert.match(markdown, new RegExp(text));
  const manifest = JSON.parse(readFileSync(result.manifestPath, "utf8"));
  assert.deepEqual(manifest.source.files.map((file) => file.path), ["SKILL.md", "README.md", "templates/brief.md", "references/loop.md", "references/rules.md"]);
  assert.match(manifest.source.files[0].sha256, /^[0-9a-f]{64}$/);
  assert.equal(manifest.parser.name, "github-raw-markdown");
  assert.equal(manifest.safety.codeExecution, "disabled");
});

test("falls back to the rendered GitHub page when no raw Markdown exists", async () => {
  const root = attemptRoot();
  const result = await ingestLearningSource({ attemptRoot: root, input: "https://github.com/o/empty" }, {
    fetchText: async (url) => {
      if (url.startsWith("https://raw.githubusercontent.com/")) throw new Error("learning URL returned HTTP 404");
      return { body: "<html><title>Repo</title><body><main><p>Rendered page</p></main></body></html>", contentType: "text/html", finalUrl: url };
    },
  });
  assert.equal(result.kind, "web");
  assert.match(readFileSync(result.artifactPath, "utf8"), /Rendered page/);
});

function youtubeWithoutPublicCaptions() {
  const player = {
    videoDetails: { title: "Fallback video" },
    captions: { playerCaptionsTracklistRenderer: { captionTracks: [
      { baseUrl: "https://www.youtube.com/api/timedtext?v=abc&exp=xpe", languageCode: "en", kind: "asr" },
    ] } },
  };
  const responses = [
    { body: `<script>var ytInitialPlayerResponse = ${JSON.stringify(player)};</script>`, finalUrl: "https://www.youtube.com/watch?v=abc" },
    { body: "", bytes: Buffer.alloc(0) },
    { body: "", bytes: Buffer.alloc(0) },
  ];
  return async () => responses.shift();
}

// Stub yt-dlp: `tracks` maps a --sub-langs value to VTT text, or to an
// { stderr } failure. Records each requested language.
function stubYtDlp(tracks, calls) {
  return (command, args) => {
    const language = args[args.indexOf("--sub-langs") + 1];
    const output = args[args.indexOf("--output") + 1];
    calls.push(language);
    const track = tracks[language];
    if (typeof track === "string") {
      writeFileSync(join(dirname(output), `transcript.${language}.vtt`), track);
      return { status: 0, stdout: "", stderr: "" };
    }
    return { status: 1, stdout: "", stderr: track?.stderr || "" };
  };
}

test("yt-dlp fallback asks for the original caption track before the translated one", () => {
  assert.deepEqual(ytDlpCaptionLanguages(undefined), ["en-orig", "en"]);
  assert.deepEqual(ytDlpCaptionLanguages("pt-BR"), ["pt-BR-orig", "pt-BR"]);
  assert.deepEqual(ytDlpCaptionLanguages("en-orig"), ["en-orig"]);
});

test("yt-dlp fallback uses the en-orig track when present", async () => {
  const root = attemptRoot();
  const calls = [];
  const result = await ingestLearningSource({ attemptRoot: root, input: "https://www.youtube.com/watch?v=abc" }, {
    fetchText: youtubeWithoutPublicCaptions(),
    spawnSync: stubYtDlp({ "en-orig": "WEBVTT\n\n00:00.000 --> 00:01.000\nOriginal track" }, calls),
  });
  assert.deepEqual(calls, ["en-orig"]);
  assert.equal(readFileSync(result.artifactPath, "utf8"), "Original track\n");
  const manifest = JSON.parse(readFileSync(result.manifestPath, "utf8"));
  assert.equal(manifest.parser.name, "yt-dlp-public-captions");
  assert.equal(manifest.parser.language, "en-orig");
});

test("yt-dlp fallback falls back to the requested track when no original track exists", async () => {
  const root = attemptRoot();
  const calls = [];
  const result = await ingestLearningSource({ attemptRoot: root, input: "https://www.youtube.com/watch?v=abc" }, {
    fetchText: youtubeWithoutPublicCaptions(),
    spawnSync: stubYtDlp({ en: "WEBVTT\n\n00:00.000 --> 00:01.000\nManual track" }, calls),
  });
  assert.deepEqual(calls, ["en-orig", "en"]);
  assert.equal(readFileSync(result.artifactPath, "utf8"), "Manual track\n");
  assert.equal(JSON.parse(readFileSync(result.manifestPath, "utf8")).parser.language, "en");
});

test("yt-dlp fallback reports the real yt-dlp error instead of asking to install it", async () => {
  const calls = [];
  const throttled = { stderr: "WARNING: old\nERROR: Unable to download video subtitles for 'en': HTTP Error 429: Too Many Requests\n" };
  await assert.rejects(ingestLearningSource({ attemptRoot: attemptRoot(), input: "https://www.youtube.com/watch?v=abc" }, {
    fetchText: youtubeWithoutPublicCaptions(),
    spawnSync: stubYtDlp({ "en-orig": throttled, en: throttled }, calls),
  }), (error) => {
    assert.match(error.message, /HTTP Error 429/);
    assert.match(error.message, /en-orig: /);
    assert.doesNotMatch(error.message, /install yt-dlp/);
    return true;
  });
  assert.deepEqual(calls, ["en-orig", "en"]);
});

test("yt-dlp fallback asks to install yt-dlp only when it is missing", async () => {
  const missing = () => ({ error: Object.assign(new Error("spawn yt-dlp ENOENT"), { code: "ENOENT" }) });
  await assert.rejects(ingestLearningSource({ attemptRoot: attemptRoot(), input: "https://www.youtube.com/watch?v=abc" }, {
    fetchText: youtubeWithoutPublicCaptions(),
    spawnSync: missing,
  }), /install yt-dlp/);
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
