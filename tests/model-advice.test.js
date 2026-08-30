import { test } from "node:test";
import assert from "node:assert/strict";
import { buildModelAdvice, normalizeModelCatalog } from "../src/model-advice.js";

const flow = {
  steps: [
    { stage: "review", capability: "code review" },
    { stage: "verify", capability: "testing" },
    { stage: "route", capability: "model selection advice" },
    { stage: "approve", capability: "decision", invocation: "user" },
  ],
};

test("no model catalog produces explicit unavailable advice without side effects", () => {
  assert.deepEqual(buildModelAdvice(flow), {
    advisory_only: true,
    invoked_models: false,
    live_monitoring: false,
    pricing_lookup: false,
    status: "unavailable",
    catalog_source: "not provided",
    recommendations: [],
    uncovered_capabilities: ["code review", "testing"],
    rationale: "This host did not provide a model catalog, so DIRF made no model recommendation.",
  });
});

test("model advice chooses the lowest host-reported tier and preserves catalog evidence", () => {
  const hash = "a".repeat(64);
  const catalog = normalizeModelCatalog({ models: [
    { name: "frontier", cost_tier: "high", capabilities: ["*"] },
    { name: "small-reviewer", cost_tier: "low", capabilities: ["code review", "testing"] },
    { name: "medium-reviewer", cost_tier: "medium", capabilities: ["code review"] },
  ] }, hash);
  const advice = buildModelAdvice(flow, catalog);

  assert.equal(advice.status, "recommended");
  assert.equal(advice.catalog_sha256, hash);
  assert.deepEqual(advice.recommendations, [{
    model: "small-reviewer",
    cost_tier: "low",
    capabilities: ["code review", "testing"],
    stages: ["review", "verify"],
    rationale: "Lowest host-reported cost tier that declares: code review, testing.",
  }]);
  assert.equal(advice.invoked_models, false);
  assert.equal(advice.live_monitoring, false);
  assert.equal(advice.pricing_lookup, false);
});

test("model advice reports uncovered capabilities instead of guessing", () => {
  const catalog = normalizeModelCatalog({ models: [
    { name: "test-only", cost_tier: "low", capabilities: ["testing"] },
  ] });
  const advice = buildModelAdvice(flow, catalog);

  assert.equal(advice.status, "partial");
  assert.deepEqual(advice.uncovered_capabilities, ["code review"]);
  assert.deepEqual(advice.recommendations[0].capabilities, ["testing"]);
});

test("model catalogs reject ambiguous or malformed entries", () => {
  assert.throws(() => normalizeModelCatalog({}), /models.*array/);
  assert.throws(() => normalizeModelCatalog({ models: [
    { name: "same", cost_tier: "low", capabilities: ["testing"] },
    { name: "same", cost_tier: "high", capabilities: ["*"] },
  ] }), /duplicate model/);
  assert.throws(() => normalizeModelCatalog({ models: [
    { name: "bad-tier", cost_tier: "free", capabilities: ["testing"] },
  ] }), /low, medium, or high/);
});
