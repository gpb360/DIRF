#!/usr/bin/env node
// DIRF MCP server — optional stdio JSON-RPC surface over src/state.js.
// Pure Node built-ins (no SDK). Modern per-request metadata and legacy
// initialization share the same tools and state core.

import { createInterface } from "node:readline";
import { readFileSync } from "node:fs";
import {
  resolveProject, resolveProjectReference, listProjects,
  writeHandoff, listAttempts, getAttempt, readAttemptAssignment, storeProjectDir, recordProgress, projectHandoffContextState,
} from "./state.js";
import { resolve } from "node:path";

const PROTOCOL_VERSION = "2024-11-05";
const MODERN_VERSION = "2026-07-28";
const VERSION_KEY = "io.modelcontextprotocol/protocolVersion";
const CAPABILITIES_KEY = "io.modelcontextprotocol/clientCapabilities";
const PACKAGE_VERSION = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
const SERVER_INFO = { name: "dirf", version: PACKAGE_VERSION };

const TOOLS = [
  { name: "dirf_resolve_project", description: "Resolve which DIRF project a path belongs to (default: server cwd).", inputSchema: { type: "object", properties: { path: { type: "string" } } } },
  { name: "dirf_list_projects", description: "List all registered DIRF projects.", inputSchema: { type: "object", properties: {} } },
  { name: "dirf_read_handoff", description: "Read the canonical handoff for a project (slug or path; default: server cwd).", inputSchema: { type: "object", properties: { project: { type: "string" } } } },
  { name: "dirf_write_handoff", description: "Replace the canonical handoff for a project with the given content.", inputSchema: { type: "object", properties: { project: { type: "string" }, content: { type: "string" } }, required: ["content"] } },
  { name: "dirf_record_progress", description: "Record workflow progress in HANDOFF.md - call this after completing each step. Updates current phase, last action, completed steps, and next action.", inputSchema: { type: "object", properties: { project: { type: "string", description: "Project slug or path (default: server cwd)" }, attempt: { type: "string", description: "Attempt id or unique name; required when the project has multiple attempts" }, message: { type: "string", description: "What was just completed" }, currentPhase: { type: "string", description: "Current workflow phase" }, nextAction: { type: "string", description: "Exact next step" }, changedFiles: { type: "array", items: { type: "string" }, description: "Files changed in this step" }, workItem: { type: "string", description: "Stable work identity such as pr:1442" }, reviewRevision: { type: "string", description: "Reviewed commit SHA" } }, required: ["message", "nextAction"] } },
  { name: "dirf_list_attempts", description: "List attempts for a project.", inputSchema: { type: "object", properties: { project: { type: "string" } } } },
  { name: "dirf_get_attempt", description: "Get one attempt by id or name.", inputSchema: { type: "object", properties: { project: { type: "string" }, id: { type: "string" } }, required: ["id"] } },
  { name: "dirf_read_assignment", description: "Read the complete workflow and handoff for one exact attempt id.", inputSchema: { type: "object", properties: { project: { type: "string" }, attempt: { type: "string", description: "Exact attempt id; names and paths are rejected" } }, required: ["attempt"] } },
];

function resolveSlugFromParams(params = {}, options = {}) {
  return resolveProjectReference(params.project, { defaultPath: process.cwd(), ...options });
}

function callTool(name, args) {
  switch (name) {
    case "dirf_resolve_project": {
      const target = resolve(args.path || process.cwd());
      const resolved = resolveProject(target);
      return resolved ? { slug: resolved.slug, store_path: storeProjectDir(resolved.slug) } : { slug: null };
    }
    case "dirf_list_projects":
      return { projects: listProjects() };
    case "dirf_read_handoff": {
      const slug = resolveSlugFromParams(args);
      const state = projectHandoffContextState(slug);
      return {
        content: state.handoff,
        attention: state.attention,
        related_task_relation: state.related_task_relation,
        related_task_requires_reconciliation: state.related_task_requires_reconciliation,
        related_attempt_id: state.related_attempt_id,
        related_handoff_path: state.related_handoff_path,
        newer_attempt_id: state.newer_attempt_id,
        newer_handoff_path: state.newer_handoff_path,
      };
    }
    case "dirf_write_handoff": {
      const slug = resolveSlugFromParams(args);
      writeHandoff(slug, args.content);
      return { ok: true, slug };
    }
    case "dirf_record_progress": {
      // recordProgress serializes the checkpoint itself; avoid mutating the
      // global registry while resolving the project before that lock.
      const slug = resolveSlugFromParams(args, { touch: false });
      const outcome = recordProgress(slug, {
        message: args.message,
        timestamp: null,
        phase: args.currentPhase || null,
        next: args.nextAction,
        files: args.changedFiles || [],
        attemptId: args.attempt || null,
        workItem: args.workItem ?? null,
        reviewRevision: args.reviewRevision || null,
      });
      return {
        ok: true,
        slug,
        recorded: outcome.recorded,
        accepted: outcome.accepted,
        reason: outcome.reason,
        attempt_accepted: outcome.attempt_accepted,
        attempt_reason: outcome.attempt_reason,
        message: outcome.accepted
          ? "Progress recorded"
          : outcome.recorded
            ? "Progress recorded for the attempt; canonical handoff unchanged"
            : "Progress rejected; handoffs and lifecycle unchanged",
      };
    }
    case "dirf_list_attempts": {
      const slug = resolveSlugFromParams(args);
      return { attempts: listAttempts(slug).map((a) => ({ id: a.id, name: a.name, created_at: a.created_at })) };
    }
    case "dirf_get_attempt": {
      const slug = resolveSlugFromParams(args);
      const a = getAttempt(slug, args.id);
      return { id: a.id, name: a.name, created_at: a.created_at, folder: a.folder };
    }
    case "dirf_read_assignment": {
      const slug = resolveSlugFromParams(args);
      return readAttemptAssignment(slug, args.attempt);
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

function respond(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
}
function respondError(id, code, message, data) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message, ...(data ? { data } : {}) } }) + "\n");
}

const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const modernResult = (result) => ({ ...result, resultType: "complete", _meta: { "io.modelcontextprotocol/serverInfo": SERVER_INFO } });
// No shared cache: a local process may serve unrelated projects and callers.
const cache = { ttlMs: 0, cacheScope: "private" };

// Validate the small, fixed vocabulary used by DIRF's own input schemas.
// This is not a general-purpose JSON Schema evaluator or external schema loader.
function validateArguments(tool, args) {
  for (const key of tool.inputSchema.required || []) {
    if (!Object.hasOwn(args, key)) throw new Error(`Missing required argument: ${key}`);
  }
  for (const [key, schema] of Object.entries(tool.inputSchema.properties)) {
    if (!Object.hasOwn(args, key)) continue;
    if (schema.type === "string" && typeof args[key] !== "string") throw new Error(`${key} must be a string`);
    if (schema.type === "array" && (!Array.isArray(args[key]) || args[key].some(item => typeof item !== "string"))) {
      throw new Error(`${key} must be an array of strings`);
    }
  }
}

let legacyInitialized = false;
const rl = createInterface({ input: process.stdin });
rl.on("line", (line) => {
  let msg;
  try { msg = JSON.parse(line); } catch {
    respondError(undefined, -32700, "Parse error");
    return;
  }
  const validId = object(msg) && (typeof msg.id === "string" || Number.isSafeInteger(msg.id));
  if (!object(msg) || msg.jsonrpc !== "2.0" || typeof msg.method !== "string" ||
      (Object.hasOwn(msg, "id") && !validId)) {
    respondError(validId ? msg.id : undefined, -32600, "Invalid request");
    return;
  }
  // Notifications have no response, and cannot invoke state-changing tools.
  // Operations are synchronous, so cancellation cannot interrupt an in-flight call.
  if (!Object.hasOwn(msg, "id")) return;
  if (msg.params !== undefined && !object(msg.params)) {
    respondError(msg.id, -32602, "params must be an object");
    return;
  }
  const params = msg.params || {};
  if (params._meta !== undefined && !object(params._meta)) {
    respondError(msg.id, -32602, "_meta must be an object");
    return;
  }
  const meta = params._meta || {};
  const modern = Object.hasOwn(meta, VERSION_KEY);
  if (modern && typeof meta[VERSION_KEY] !== "string") {
    respondError(msg.id, -32602, "Protocol version must be a string");
    return;
  }
  if (modern && meta[VERSION_KEY] !== MODERN_VERSION) {
    respondError(msg.id, -32022, "Unsupported protocol version", { supported: [MODERN_VERSION], requested: meta[VERSION_KEY] });
    return;
  }
  if ((modern && !object(meta[CAPABILITIES_KEY])) ||
      (!modern && (Object.hasOwn(meta, CAPABILITIES_KEY) || msg.method === "server/discover"))) {
    respondError(msg.id, -32602, "Modern requests require protocolVersion and clientCapabilities in _meta");
    return;
  }
  const info = meta["io.modelcontextprotocol/clientInfo"];
  if (modern && info !== undefined && (!object(info) || typeof info.name !== "string" || typeof info.version !== "string")) {
    respondError(msg.id, -32602, "clientInfo must include name and version strings");
    return;
  }
  const reply = (result) => respond(msg.id, modern ? modernResult(result) : result);
  if (msg.method === "initialize" && !modern) {
    if (typeof params.protocolVersion !== "string" || !object(params.capabilities) ||
        !object(params.clientInfo) || typeof params.clientInfo.name !== "string" || typeof params.clientInfo.version !== "string") {
      respondError(msg.id, -32602, "Invalid initialize parameters");
      return;
    }
    // A legacy client may accept this supported version or disconnect.
    legacyInitialized = true;
    reply({ protocolVersion: PROTOCOL_VERSION, capabilities: { tools: {} }, serverInfo: SERVER_INFO });
    return;
  }
  if (!modern && !legacyInitialized) {
    respondError(msg.id, -32602, "Supply modern request metadata or initialize a legacy session first");
    return;
  }
  if (msg.method === "server/discover") {
    reply({ supportedVersions: [MODERN_VERSION, PROTOCOL_VERSION], capabilities: { tools: {} }, ...cache });
    return;
  }
  if (msg.method === "ping" && !modern) { reply({}); return; }
  if (msg.method === "tools/list") {
    if (params.cursor !== undefined) { respondError(msg.id, -32602, "Invalid cursor: this tool list fits on one page"); return; }
    reply({ tools: TOOLS, ...(modern ? cache : {}) });
    return;
  }
  if (msg.method === "tools/call") {
    const tool = TOOLS.find(tool => tool.name === params.name);
    if (!tool || (params.arguments !== undefined && !object(params.arguments))) {
      respondError(msg.id, -32602, "Unknown tool or invalid tools/call parameters");
      return;
    }
    try {
      const args = params.arguments || {};
      validateArguments(tool, args);
      const result = callTool(params.name, args);
      reply({ content: [{ type: "text", text: JSON.stringify(result) }],
        ...(modern ? { structuredContent: result, isError: result.recorded === false } : {}) });
    } catch (e) {
      if (modern) reply({ content: [{ type: "text", text: e.message }], isError: true });
      else respondError(msg.id, -32603, e.message);
    }
    return;
  }
  respondError(msg.id, -32601, `method not found: ${msg.method}`);
});
