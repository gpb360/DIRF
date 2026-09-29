import { test } from "node:test";
import assert from "node:assert/strict";
import { traceMcpToolCall } from "../src/mcp-trace.js";

function ids() {
  let next = 0;
  return () => `id-${++next}`;
}

test("records a parent request span and child TOOL span with allowlisted DIRF attributes", () => {
  const spans = [];
  const result = traceMcpToolCall("dirf_record_progress", {
    attempt: "attempt-1",
    workItem: " pr:66 ",
    reviewRevision: "abc123",
    message: "secret prompt-like content",
    content: "private handoff body",
    project: "private path",
  }, () => ({ ok: true, recorded: true }), { traceSink: span => spans.push(span), idFactory: ids() });

  assert.deepEqual(result, { ok: true, recorded: true });
  assert.equal(spans.length, 2);
  const [tool, request] = spans;
  assert.equal(tool.kind, "TOOL");
  assert.equal(request.kind, "CHAIN");
  assert.equal(tool.traceId, request.traceId);
  assert.equal(tool.parentSpanId, request.spanId);
  assert.deepEqual(tool.attributes, {
    "dirf.tool_id": "dirf_record_progress",
    "dirf.execution_outcome": "success",
    "dirf.attempt_id": "attempt-1",
    "dirf.work_item": "pr:66",
    "dirf.review_revision": "abc123",
  });
  assert.doesNotMatch(JSON.stringify(spans), /secret prompt-like content|private handoff body|private path/);
});

test("an unavailable trace sink cannot change the tool result", () => {
  const expected = { ok: true, recorded: false, reason: "stale_review_revision" };
  const result = traceMcpToolCall("dirf_record_progress", {
    attempt: "attempt-2",
    message: "must not leak",
  }, () => expected, { traceSink: () => { throw new Error("backend unavailable"); }, idFactory: ids() });

  assert.equal(result, expected);
});

test("trace failure preserves the original tool error", () => {
  const original = new Error("tool failed");
  assert.throws(() => traceMcpToolCall("dirf_read_handoff", {
    content: "must not leak",
  }, () => { throw original; }, {
    traceSink: () => { throw new Error("backend unavailable"); },
    idFactory: ids(),
  }), error => error === original);
});

test("no trace sink is a transparent no-op", () => {
  let calls = 0;
  const result = traceMcpToolCall("dirf_list_projects", {}, () => {
    calls += 1;
    return { projects: [] };
  });
  assert.equal(calls, 1);
  assert.deepEqual(result, { projects: [] });
});
