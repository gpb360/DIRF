#!/usr/bin/env node
// Bootstrap an agent laptop to share DIRF state over a network store.
//
// Sets up: DIRF checkout, Claude Code MCP registration, DIRF_HOME and the
// fleet-wide orchestrator token. See docs/integration.md ("Shared store
// across laptops") for the contract this implements.
//
// Usage:
//   node scripts/bootstrap-laptop.js --store \\server\dirf-store --repo <dirf-repo-url>
//     [--dirf-path C:\dirf] [--pin <revision>] [--token <32+ char shared secret>]
//
// The token must be the same value on every laptop sharing the store; the
// authority hash bound at first setup rejects any other token. It is never
// printed by this script.

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import process from "node:process";

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (!["--store", "--repo", "--dirf-path", "--pin", "--token"].includes(flag)) {
      fail(`unknown argument ${flag}`);
    }
    if (!value || value.startsWith("--")) fail(`${flag} requires a value`);
    out[flag.slice(2)] = value;
    i++;
  }
  if (!out.store) fail("--store is required (the shared DIRF_HOME path)");
  if (!out.repo && !existsSync(out.dirfPath || process.env.DIRF_PATH || defaultDirfPath())) {
    fail("--repo is required when the DIRF checkout does not exist yet");
  }
  return out;
}

function defaultDirfPath() {
  return process.platform === "win32" ? "C:\\dirf" : join(homeDir(), "dirf");
}

function homeDir() {
  return process.env.USERPROFILE || process.env.HOME || "";
}

function fail(message) {
  console.error(`bootstrap-laptop: ${message}`);
  process.exit(2);
}

function run(command, args, options = {}) {
  // claude ships as a .cmd shim on Windows and needs a shell to spawn; quote
  // arguments with whitespace since shell mode joins them raw.
  const shelled = process.platform === "win32" && command === "claude";
  const quoted = shelled ? args.map((a) => (/\s/.test(a) ? `"${a}"` : a)) : args;
  const result = spawnSync(command, quoted, {
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
    shell: shelled,
    encoding: options.capture ? "utf8" : undefined,
  });
  if (options.optional && (result.error || result.status !== 0)) return null;
  if (!options.optional && (result.error || result.status !== 0)) {
    fail(`${command} ${args.join(" ")} failed${result.error ? `: ${result.error.message}` : ""}`);
  }
  return result;
}

function main() {
  const { store, repo, pin, token: tokenFlag, dirfPath: dirfPathArg } = parseArgs(process.argv.slice(2));
  const dirfPath = resolve(dirfPathArg || process.env.DIRF_PATH || defaultDirfPath());
  const mcpEntry = join(dirfPath, "src", "mcp.js");

  if (!existsSync(dirfPath)) {
    console.log(`Cloning DIRF into ${dirfPath} ...`);
    run("git", ["clone", repo, dirfPath]);
  }
  if (pin) run("git", ["-C", dirfPath, "checkout", pin]);

  // Shared store: DIRF_HOME machine-wide so CLI and MCP agree.
  if (process.platform === "win32") {
    run("setx", ["DIRF_HOME", store], { capture: true });
  } else {
    console.log(`Add to your shell profile:  export DIRF_HOME="${store}"`);
  }
  process.env.DIRF_HOME = store;

  // Fleet-wide orchestrator token. Skip (with a warning) if not provided and
  // not already set — projects cannot bind or verify execution authority
  // without it.
  const token = tokenFlag || process.env.BOOTSTRAP_TOKEN || null;
  if (token) {
    if (token.length < 32) fail("the orchestrator token must be at least 32 characters");
    if (process.platform === "win32") {
      run("setx", ["DIRF_ORCHESTRATOR_TOKEN", token], { capture: true });
    } else {
      console.log('Add to your shell profile:  export DIRF_ORCHESTRATOR_TOKEN="<fleet token>"');
    }
    process.env.DIRF_ORCHESTRATOR_TOKEN = token;
    console.log("Orchestrator token recorded (value not shown).");
  } else if (process.env.DIRF_ORCHESTRATOR_TOKEN) {
    console.log("Using existing DIRF_ORCHESTRATOR_TOKEN from the environment.");
  } else {
    console.warn("warning: no DIRF_ORCHESTRATOR_TOKEN. Pass --token (identical value on every laptop) before running dirf setup.");
  }

  // Register the MCP server in Claude Code, user scope. Re-register to
  // refresh the path or revision.
  const hasClaude = run("claude", ["--version"], { capture: true, optional: true });
  if (hasClaude) {
    run("claude", ["mcp", "remove", "dirf", "-s", "user"], { capture: true, optional: true });
    run("claude", ["mcp", "add", "dirf", "-s", "user", "--env", `DIRF_HOME=${store}`, "--", "node", mcpEntry]);
    console.log("Registered MCP server 'dirf'. Restart Claude Code to load it.");
  } else {
    console.warn("warning: claude CLI not found; MCP server not registered. Install Claude Code, then rerun this script.");
  }

  // Health check.
  run(process.execPath, [join(dirfPath, "src", "cli.js"), "doctor"]);

  console.log("");
  console.log("Clone shared projects to the SAME absolute path on every laptop so");
  console.log("slugs resolve to one store entry (see docs/integration.md).");
}

main();
