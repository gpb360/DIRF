# DIRF TypeScript Conversion — Design

- **Status:** Draft (pending user review)
- **Date:** 2026-07-27
- **Scope:** `amf-dirf` — convert `src/*.js` to `src/*.ts` with real type safety for contributors, zero-install preserved for users.
- **Origin:** User asked "why aren't we using TypeScript for everything?" — correctly identified that the project has outgrown plain JS (the merge bug where `compaction`/`focusedOutput`/`routing` piled up as positional args in `buildPlan`, silently passed in the wrong slot, is concrete evidence).

## 1. Problem

DIRF has real typed shapes now — `attempt.json`, `workflow.json`, `projects.json`, the observation entries, the MCP tool params/results — enforced by nothing. Three modules share contracts (`state.js` exports → `cli.js` + `mcp.js` consume); in JS, a signature change silently propagates. The `buildPlan` signature drift during the recent merge produced a silent wrong-slot bug caught only by manual reasoning, not by any check. As the project grew from "small router" to "stateful multi-module system speaking JSON-RPC," the cost of untyped shapes crossed the cost of adding types.

## 2. The decision (already made)

- **Source becomes `.ts`.** Real TypeScript with interfaces, generics, type aliases.
- **Runtime: Node 22 native type stripping.** Users run `node src/cli.ts` directly — **no `npm install`, no build step.** Verified on Node 22.20: interfaces, generics, type aliases, optional params, return types all stripped and run cleanly. The zero-install promise (`git clone && node src/cli.js` → `node src/cli.ts`) is preserved.
- **Type-checking: `tsc` as devDep, optional.** Contributors who want compile-time safety run `npm install` + `npm run typecheck`. CI runs it. Users don't need it. Types are enforced at contribution time, not run time.

This is strictly better than the two extremes: full zero-install preserved for users (unlike "require npm install to run"), and real type safety for contributors (unlike "strip-only, never checked").

## 3. Non-goals

- **No runtime behavior change.** Every existing test must pass unchanged throughout the conversion. Types are added; logic is not rewritten.
- **No new dependencies at runtime.** Zero runtime deps stays. `typescript` is devDep only.
- **No big-bang.** Staged module-by-module, kit keeps running.
- **No typed JSON loading in v1.** The `registry/*.json` files stay untyped JSON; a `Registry` interface can be added later. Out of scope for the conversion itself.

## 4. The dependency graph (determines staging order)

Confirmed by reading `import` lines:

```
Layer 0 (no internal imports):
  paths.js        folders.js        state.js

Layer 1 (import Layer 0):
  skills.js   → paths, folders
  router.js   → paths, folders
  project.js  → state
  flow.js     → skills

Layer 2 (import Layer 1):
  renderer.js → paths
  validate.js → paths, flow, folders
  inspect.js  → (node builtins only, but logically Layer 2)

Layer 3 (roots, import everything):
  cli.js      → paths, router, skills, renderer, validate, inspect, flow, folders, project, state
  mcp.js      → state
```

Conversion goes **bottom-up**: each module converts against already-typed dependencies. A converted `.ts` module and an unconverted `.js` module can coexist (Node resolves both; `.ts` importing `.js` and vice-versa works under type stripping).

## 5. The type model (what gets typed, concretely)

Centered on `state.js` (the single source of truth), since its shapes are consumed everywhere:

```typescript
// state.ts
export interface ProjectRecord {
  slug: string;
  name: string;
  git_common_dir: string;
  main_path: string;
  created_at: string;
  last_seen: string;
}
export interface Registry { schema_version: 1; projects: Record<string, ProjectRecord>; }
export interface Attempt { schema_version: 1; id: string; name: string; relativePath: string; created_at: string; folder: string; }
export interface Observation { n: number; ts: string; text: string; }
export type ResolveResult = { slug: string } | null;
// ... etc. Each exported function gets param + return types.
```

Other key shapes:
- `workflow.ts` (new file, or in `cli.ts`): the `Plan` object built by `buildPlan` — the one that drifted in the merge. Typing it is the single highest-value win.
- `mcp.ts`: typed tool schemas, `McpRequest`/`McpResponse` for the JSON-RPC envelope.
- `project.ts`: the `ProjectConfig` shape (schema v2).

## 6. Rollout staging

Each stage is a separate PR; kit stays green throughout; each can ship independently.

**Stage 0 — Scaffolding (no code converted yet).**
- Add `typescript` devDep + `tsconfig.json` (`strict: true`, `module: nodenext`, `allowJs: true`, `checkJs: false`).
- Add `npm run typecheck` script (`tsc --noEmit`).
- Update `.gitignore` if needed (no `dist/` — we ship `.ts`).
- One PR. No behavior change. `node --test` still 150 green; `npm run typecheck` runs but reports nothing to fix yet (allowJs + checkJs false).

**Stage 1 — Layer 0:** `paths.ts`, `folders.ts`, `state.ts`.
- Rename `.js` → `.ts`, add types. `state.ts` gets the interfaces from §5 (highest value — these are consumed everywhere).
- Update importers (Layer 1+ still `.js`) — Node resolves `.ts` from `.js` fine; the imports don't even need extension changes if `allowImportingTsExtensions` is off. (Decide: keep extensionless imports for least churn.)
- Tests: rename `tests/state.test.js` → `.ts` is **not** required; tests can stay `.js` and import `.ts`. (Verified: Node resolves cross-extension.)
- Verify: `node --test` green; `npm run typecheck` green for the 3 converted modules.

**Stage 2 — Layer 1:** `skills.ts`, `router.ts`, `project.ts`, `flow.ts`.
- The `ProjectConfig` type lands in `project.ts`. The `Skill`/`Agent` registry types land in `skills.ts`.
- Verify: tests + typecheck green.

**Stage 3 — Layer 2:** `renderer.ts`, `validate.ts`, `inspect.ts`.
- Verify: tests + typecheck green.

**Stage 4 — Layer 3 (roots):** `cli.ts`, `mcp.ts`.
- The `Plan` interface lands here (the merge-bug shape). `McpRequest`/`McpResponse` in `mcp.ts`.
- Update `package.json` `bin` → `./src/cli.ts`.
- Update shebang (still `#!/usr/bin/env node` — works for `.ts` under Node 22).
- Verify: tests + typecheck green.

**Stage 5 — Docs + cleanup.**
- Update `AGENTS.md`, `README.md`: `node src/cli.js` → `node src/cli.ts`; note the `npm install` + `npm run typecheck` contributor flow; preserve the "users just `node src/cli.ts`, no install" promise.
- Remove any `.js` leftovers.
- Update the shell alias/function paths (`dirf` alias) if the entry filename changed — single path update in `~/.bashrc` + the two PowerShell profiles.

## 7. Testing approach

- **Every stage:** `node --test` must stay 150+/0. No behavior change, ever.
- **Every stage:** `npm run typecheck` (`tsc --noEmit`) green for converted modules. No `any` escapes (`strict: true`) unless explicitly justified in a comment.
- **One new test file** per stage only if the types reveal a latent bug worth a regression test (e.g., if typing `Plan` surfaces the `buildPlan` slot issue, add a test that would have caught it). Otherwise: no new tests, types are the new safety net.

## 8. Risks + honest caveats

- **Node version requirement tightens.** Today: Node ≥18.17. After: **Node ≥22** (for native type stripping). This is a real user-facing constraint change — anyone on Node 18/20 needs to upgrade. Must be called out in README and `package.json` `engines`. **This is the one genuine cost of the conversion.**
- **Node 22 type stripping has limits** (no `enum`, no parameter properties, no namespaces, no `const enum`). The type model in §5 uses none of these (interfaces, type aliases, generics, unions only) — verified by probe. If a contributor reaches for `enum`, the type-check passes under `tsc` but Node won't strip it and it'll fail at runtime. Document this in AGENTS.md.
- **`tsc` strict mode may surface real latent bugs** in the existing code (e.g., `any` returns, untyped JSON parses). That's a feature, not a risk — but expect the first `typecheck` run after Stage 1 to find things. Each is fixed in-stage.
- **Tests stay `.js` optionally.** Converting tests to `.ts` is low-value (they're already correct) and adds churn. Decision: leave tests as `.js` unless typing reveals a test bug. Revisit later.
- **No MCP type export in v1.** MCP tool schemas are typed internally to `mcp.ts`; we don't publish a types package for external MCP clients. Out of scope.

## 9. Success criteria

- `src/*.ts` replaces `src/*.js`; `node src/cli.ts validate` and `node --test` behave identically to today (150 tests, validate clean).
- Zero runtime dependencies preserved; `typescript` is devDep only.
- `npm run typecheck` (`tsc --noEmit --strict`) passes with no `any` escapes.
- The `buildPlan` signature is typed — the slot-drift class of bug is now compile-caught.
- `engines.node` bumped to `>=22`; README documents the Node requirement.
- Users still run DIRF with no `npm install` (`node src/cli.ts` works after `git clone`).
