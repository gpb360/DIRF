// Portable, diagnostic model suggestions from a catalog supplied by the host.
// This module never discovers providers, fetches prices, invokes a model, or
// observes a running session.

const COST_ORDER = new Map([["low", 0], ["medium", 1], ["high", 2]]);
const ADVICE_CAPABILITY = "model selection advice";

function cleanStrings(values) {
  return [...new Set(values.map((value) => String(value).trim()).filter(Boolean))];
}

export function normalizeModelCatalog(data, sha256 = null) {
  if (!data || typeof data !== "object" || Array.isArray(data) || !Array.isArray(data.models)) {
    throw new Error('Model catalog must be an object with a "models" array');
  }
  const names = new Set();
  const models = data.models.map((model, index) => {
    if (!model || typeof model !== "object" || Array.isArray(model)) {
      throw new Error(`Model catalog entry ${index + 1} must be an object`);
    }
    const name = String(model.name || "").trim();
    if (!name) throw new Error(`Model catalog entry ${index + 1} name must be a non-empty string`);
    if (names.has(name)) throw new Error(`Model catalog contains duplicate model ${JSON.stringify(name)}`);
    names.add(name);
    const costTier = String(model.cost_tier || "").trim();
    if (!COST_ORDER.has(costTier)) {
      throw new Error(`Model catalog entry ${name} cost_tier must be low, medium, or high`);
    }
    if (!Array.isArray(model.capabilities) || model.capabilities.some((capability) => typeof capability !== "string" || !capability.trim())) {
      throw new Error(`Model catalog entry ${name} capabilities must be an array of non-empty strings`);
    }
    return { name, cost_tier: costTier, capabilities: cleanStrings(model.capabilities) };
  });
  return { models, ...(sha256 ? { sha256 } : {}) };
}

export function requiredModelCapabilities(skillFlow = {}) {
  const requirements = new Map();
  for (const step of skillFlow.steps || []) {
    const capability = String(step.capability || "").trim();
    if (!capability || capability === ADVICE_CAPABILITY || step.invocation === "user") continue;
    const current = requirements.get(capability) || new Set();
    if (step.stage) current.add(step.stage);
    requirements.set(capability, current);
  }
  return requirements;
}

function covers(model, capability) {
  return model.capabilities.includes("*") || model.capabilities.includes(capability);
}

export function buildModelAdvice(skillFlow = {}, catalog = null) {
  const requirements = requiredModelCapabilities(skillFlow);
  const base = {
    advisory_only: true,
    invoked_models: false,
    live_monitoring: false,
    pricing_lookup: false,
  };
  if (!catalog) {
    return {
      ...base,
      status: "unavailable",
      catalog_source: "not provided",
      recommendations: [],
      uncovered_capabilities: [...requirements.keys()],
      rationale: "This host did not provide a model catalog, so DIRF made no preflight model recommendation.",
    };
  }

  const assignments = new Map();
  const uncovered = [];
  for (const [capability, stages] of requirements) {
    const eligible = catalog.models.filter((model) => covers(model, capability))
      .sort((a, b) => COST_ORDER.get(a.cost_tier) - COST_ORDER.get(b.cost_tier) ||
        (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    const chosen = eligible[0];
    if (!chosen) {
      uncovered.push(capability);
      continue;
    }
    const current = assignments.get(chosen.name) || {
      model: chosen.name,
      cost_tier: chosen.cost_tier,
      capabilities: [],
      stages: [],
    };
    current.capabilities.push(capability);
    current.stages.push(...stages);
    assignments.set(chosen.name, current);
  }

  const recommendations = [...assignments.values()].map((assignment) => ({
    ...assignment,
    capabilities: cleanStrings(assignment.capabilities),
    stages: cleanStrings(assignment.stages),
    rationale: `Lowest host-reported cost tier that declares: ${cleanStrings(assignment.capabilities).join(", ")}.`,
  }));
  const status = recommendations.length && !uncovered.length
    ? "recommended"
    : recommendations.length ? "partial" : "unavailable";
  return {
    ...base,
    status,
    catalog_source: "host-provided file",
    ...(catalog.sha256 ? { catalog_sha256: catalog.sha256 } : {}),
    recommendations,
    uncovered_capabilities: uncovered,
    rationale: status === "recommended"
      ? "Every declared preflight workflow capability has a suggestion from the host-provided catalog."
      : status === "partial"
        ? "Some declared preflight workflow capabilities have no match in the host-provided catalog."
        : "No host-reported model declares the preflight workflow capabilities, so DIRF made no recommendation.",
  };
}
