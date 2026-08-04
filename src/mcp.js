#!/usr/bin/env node
// amf-dirf MCP server — optional stdio JSON-RPC surface over src/state.js.
// Pure Node built-ins (no SDK). Speaks MCP initialize / notifications.initialized
// / tools/list / tools/call. Every tool is a thin call into state.js.

import { createInterface } from "node:readline";
import {
  resolveProject, listProjects,
  readHandoff, writeHandoff, listAttempts, getAttempt, storeProjectDir,
} from "./state.js";
import { updateProgressSection } from "./handoff-update.js";
import { resolve } from "node:path";

const PROTOCOL_VERSION = "2024-11-05";
const SERVER_INFO = { name: "amf-dirf", version: "1.0.0" };

const TOOLS = [
  { name: "dirf_resolve_project", description: "Resolve which DIRF project a path belongs to (default: server cwd).", inputSchema: { type: "object", properties: { path: { type: "string" } } } },
  { name: "dirf_list_projects", description: "List all registered DIRF projects.", inputSchema: { type: "object", properties: {} } },
  { name: "dirf_read_handoff", description: "Read the canonical handoff for a project (slug or path; default: server cwd).", inputSchema: { type: "object", properties: { project: { type: "string" } } } },
  { name: "dirf_write_handoff", description: "Replace the canonical handoff for a project with the given content.", inputSchema: { type: "object", properties: { project: { type: "string" }, content: { type: "string" } }, required: ["content"] } },
  { name: "dirf_record_progress", description: "Record workflow progress in HANDOFF.md - call this after completing each step. Updates current phase, last action, completed steps, and next action.", inputSchema: { type: "object", properties: { project: { type: "string", description: "Project slug or path (default: server cwd)" }, message: { type: "string", description: "What was just completed" }, currentPhase: { type: "string", description: "Current workflow phase" }, nextAction: { type: "string", description: "Exact next step" }, changedFiles: { type: "array", items: { type: "string" }, description: "Files changed in this step" } }, required: ["message", "nextAction"] } },
  { name: "dirf_list_attempts", description: "List attempts for a project.", inputSchema: { type: "object", properties: { project: { type: "string" } } } },
  { name: "dirf_get_attempt", description: "Get one attempt by id or name.", inputSchema: { type: "object", properties: { project: { type: "string" }, id: { type: "string" } }, required: ["id"] } },
];

function resolveSlugFromParams(params = {}) {
  const project = params.project;
  if (project && /^[a-z0-9.-]+-[0-9a-f]{8}$/.test(project)) return project; // looks like a slug
  const target = resolve(project || process.cwd());
  const resolved = resolveProject(target);
  if (!resolved) throw new Error(`DIRF has no project registered for ${target}`);
  return resolved.slug;
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
      const md = readHandoff(slug);
      return { content: md };
    }
    case "dirf_write_handoff": {
      const slug = resolveSlugFromParams(args);
      writeHandoff(slug, args.content);
      return { ok: true, slug };
    }
    case "dirf_record_progress": {
      const slug = resolveSlugFromParams(args);
      const currentHandoff = readHandoff(slug);
      const updatedHandoff = updateProgressSection(currentHandoff || "# DIRF Handoff\n\n## Objective\n\n(Work in progress)\n", {
        message: args.message,
        timestamp: new Date().toISOString(),
        phase: args.currentPhase || null,
        next: args.nextAction,
        files: args.changedFiles || []
      });
      writeHandoff(slug, updatedHandoff);
      return { ok: true, slug, message: "Progress recorded" };
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
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

function respond(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
}
function respondError(id, code, message) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }) + "\n");
}

const rl = createInterface({ input: process.stdin });
rl.on("line", (line) => {
  let msg;
  try { msg = JSON.parse(line); } catch { return; } // ignore malformed lines
  if (msg.method === "initialize") {
    respond(msg.id, { protocolVersion: PROTOCOL_VERSION, capabilities: { tools: {} }, serverInfo: SERVER_INFO });
    return;
  }
  if (msg.method === "notifications/initialized") return; // notification — no response
  if (msg.method === "tools/list") {
    respond(msg.id, { tools: TOOLS });
    return;
  }
  if (msg.method === "tools/call") {
    try {
      const result = callTool(msg.params.name, msg.params.arguments || {});
      respond(msg.id, { content: [{ type: "text", text: JSON.stringify(result) }] });
    } catch (e) {
      respondError(msg.id, -32603, e.message);
    }
    return;
  }
  if (msg.id) respondError(msg.id, -32601, `method not found: ${msg.method}`);
});
