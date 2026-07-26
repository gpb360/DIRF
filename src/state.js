// src/state.js — the ONLY module that reads/writes DIRF canonical state.
// Central store layout (under storeHome()):
//   projects.json            project registry
//   projects/<slug>/
//     config.json            canonical config
//     HANDOFF.md             canonical handoff
//     attempts/<id>/         per-run state (layout unchanged)
//
// Every disk-touching function resolves the store root from storeHome().
// storeHome() = process.env.DIRF_HOME || ~/.dirf  — enables isolated tests.

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export function storeHome() {
  return process.env.DIRF_HOME || join(homedir(), ".dirf");
}

export function registryPath() {
  return join(storeHome(), "projects.json");
}

const EMPTY_REGISTRY = Object.freeze({ schema_version: 1, projects: {} });

export function readRegistry() {
  const path = registryPath();
  if (!existsSync(path)) return { ...EMPTY_REGISTRY, projects: {} };
  const data = JSON.parse(readFileSync(path, "utf8"));
  if (data.schema_version !== 1) {
    throw new Error(`Unsupported DIRF project registry schema ${data.schema_version}`);
  }
  return { schema_version: 1, projects: data.projects || {} };
}

export function listProjects() {
  return Object.values(readRegistry().projects);
}
