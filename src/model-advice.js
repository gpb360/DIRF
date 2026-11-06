// Portable, diagnostic model suggestions from a catalog supplied by the host.
// This module never discovers providers, fetches prices, invokes a model, or
// observes a running session.

const COST_ORDER = new Map([["low", 0], ["medium", 1], ["high", 2]]);
const EFFORT_ORDER = new Map([["light", 0], ["standard", 1], ["heavy", 2]]);
const ADVICE_CAPABILITY = "model selection advice";
const MAX_CATALOG_LABEL_LENGTH = 120;

function cleanStrings(values) {
  return [...new Set(values.map((value) => String(value).trim()).filter(Boolean))];
}

function catalogLabel(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string`);
  const normalized = value.trim();
  if (normalized.length > MAX_CATALOG_LABEL_LENGTH) {
    throw new Error(`${label} must be ${MAX_CATALOG_LABEL_LENGTH} characters or fewer`);
  }
  if (/[\u0000-\u001f\u007f\u2028\u2029]/.test(normalized)) {
    throw new Error(`${label} must be a single-line identifier without control characters`);
  }
  return normalized;
}

function modelIdentifier(value, label) {
  const normalized = catalogLabel(value, label);
  if (!/^[A-Za-z0-9][A-Za-z0-9._+:/@-]*$/.test(normalized)) {
    throw new Error(`${label} must be an identifier using only letters, numbers, dot, underscore, plus, colon, slash, at, or hyphen`);
  }
  return normalized;
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
    const name = modelIdentifier(model.name, `Model catalog entry ${index + 1} name`);
    if (names.has(name)) throw new Error(`Model catalog contains duplicate model ${JSON.stringify(name)}`);
    names.add(name);
    const costTier = String(model.cost_tier || "").trim();
    if (!COST_ORDER.has(costTier)) {
      throw new Error(`Model catalog entry ${name} cost_tier must be low, medium, or high`);
    }
    if (!Array.isArray(model.capabilities) || model.capabilities.some((capability) => typeof capability !== "string" || !capability.trim())) {
      throw new Error(`Model catalog entry ${name} capabilities must be an array of non-empty strings`);
    }
    const capabilities = cleanStrings(model.capabilities.map((capability, capabilityIndex) =>
      catalogLabel(capability, `Model catalog entry ${name} capability ${capabilityIndex + 1}`)));
    // Optional provider declaration ("anthropic", "openai", "z.ai", ...).
    // Absent means provider-agnostic: eligible under any provider filter.
    const provider = model.provider === undefined || model.provider === null || !String(model.provider).trim()
      ? null
      : modelIdentifier(String(model.provider).trim(), `Model catalog entry ${name} provider`);
    return { name, cost_tier: costTier, capabilities, provider };
  });
  return { models, ...(sha256 ? { sha256 } : {}) };
}

// Capability -> { stages, effort }. Effort is the STRONGEST declared weight
// among the steps sharing a capability, so one assignment satisfies every
// step that requires it. Steps without effort default to "standard", which
// preserves the historical lowest-tier pick.
export function capabilityEffortRequirements(skillFlow = {}) {
  const requirements = new Map();
  for (const step of skillFlow.steps || []) {
    const capability = String(step.capability || "").trim();
    if (!capability || capability === ADVICE_CAPABILITY || step.invocation === "user") continue;
    // Unrecognized effort values degrade to "standard" here; validate.js is
    // the surface that reports them, so this core stays tolerant of drafts.
    const declared = String(step.effort || "standard").trim().toLowerCase();
    const effort = EFFORT_ORDER.has(declared) ? declared : "standard";
    const current = requirements.get(capability) || { stages: new Set(), effort: "standard" };
    if (step.stage) current.stages.add(step.stage);
    if (EFFORT_ORDER.get(effort) > EFFORT_ORDER.get(current.effort)) current.effort = effort;
    requirements.set(capability, current);
  }
  return requirements;
}

export function requiredModelCapabilities(skillFlow = {}) {
  const stagesByCapability = new Map();
  for (const [capability, requirement] of capabilityEffortRequirements(skillFlow)) {
    stagesByCapability.set(capability, requirement.stages);
  }
  return stagesByCapability;
}

function covers(model, capability) {
  return model.capabilities.includes("*") || model.capabilities.includes(capability);
}

export function buildModelAdvice(skillFlow = {}, catalog = null, { providers = null } = {}) {
  const requirements = capabilityEffortRequirements(skillFlow);
  const providerSet = providers && providers.length ? new Set(providers.map((p) => String(p).trim().toLowerCase())) : null;
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

  // Provider filter: a model is eligible when it declares no provider or one
  // in the requested set. Capabilities with no match inside the set fall back
  // to the full catalog (provider-agnostic entries cover every filter).
  const inProviderSet = (model) => !model.provider || !providerSet || providerSet.has(model.provider.toLowerCase());
  const eligibleFor = (capability) => catalog.models.filter((model) => inProviderSet(model) && covers(model, capability));
  const fellBackOutsideSet = [];

  const assignments = new Map();
  const uncovered = [];
  for (const [capability, requirement] of requirements) {
    let eligible = eligibleFor(capability);
    if (!eligible.length && providerSet) {
      eligible = catalog.models.filter((model) => covers(model, capability));
      if (eligible.length) fellBackOutsideSet.push(capability);
    }
    if (!eligible.length) {
      uncovered.push(capability);
      continue;
    }
    // Weight-aware pick: heavy steps prefer the fleet's strongest tier first,
    // falling back down if no high-tier model covers the capability; every
    // other effort prefers the cheapest sufficient tier (the historical pick).
    const heavy = requirement.effort === "heavy";
    eligible.sort((a, b) => heavy
      ? (COST_ORDER.get(b.cost_tier) - COST_ORDER.get(a.cost_tier)) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
      : (COST_ORDER.get(a.cost_tier) - COST_ORDER.get(b.cost_tier)) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    const chosen = eligible[0];
    const current = assignments.get(chosen.name) || {
      model: chosen.name,
      cost_tier: chosen.cost_tier,
      ...(chosen.provider ? { provider: chosen.provider } : {}),
      capabilities: [],
      stages: [],
      _heavy: false,
    };
    current.capabilities.push(capability);
    current.stages.push(...requirement.stages);
    if (heavy) current._heavy = true;
    assignments.set(chosen.name, current);
  }

  const recommendations = [...assignments.values()].map((assignment) => {
    const { _heavy, ...rest } = assignment;
    return {
      ...rest,
      capabilities: cleanStrings(assignment.capabilities),
      stages: cleanStrings(assignment.stages),
      rationale: _heavy
        ? `Selected for the strongest host-reported cost tier (covers effort: heavy): ${cleanStrings(assignment.capabilities).join(", ")}.`
        : `Lowest host-reported cost tier that declares: ${cleanStrings(assignment.capabilities).join(", ")}.`,
    };
  });
  const status = recommendations.length && !uncovered.length
    ? "recommended"
    : recommendations.length ? "partial" : "unavailable";
  const rationaleSuffix = fellBackOutsideSet.length
    ? ` Declared provider set had no match for: ${cleanStrings(fellBackOutsideSet).join(", ")}; fell back to models outside the set.`
    : "";
  return {
    ...base,
    status,
    catalog_source: "host-provided file",
    ...(catalog.sha256 ? { catalog_sha256: catalog.sha256 } : {}),
    ...(providerSet ? { providers: providers.map((p) => String(p).trim()).filter(Boolean) } : {}),
    recommendations,
    uncovered_capabilities: uncovered,
    rationale: (status === "recommended"
      ? "Every declared preflight workflow capability has a suggestion from the host-provided catalog."
      : status === "partial"
        ? "Some declared preflight workflow capabilities have no match in the host-provided catalog."
        : "No host-reported model declares the preflight workflow capabilities, so DIRF made no recommendation.") + rationaleSuffix,
  };
}
