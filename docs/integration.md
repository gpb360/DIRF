# Project integration

Keep one tested DIRF checkout and point your projects or agent hosts at it.
The CLI and MCP server use the same state store.

## CLI

Run commands from the DIRF checkout with an explicit project path:

```bash
node src/cli.js setup "../my-project"
node src/cli.js build first-run "fix the checkout timeout" --path "../my-project"
```

For a global command, run `npm install -g .` from the tested DIRF checkout.
Then, from a project, use `dirf state active`, `dirf build`, and
`dirf record-progress`. `dirf doctor` shows which installation and revision
the command uses. A global install may link to the source checkout, so keep
that checkout at an intentional revision.

No runtime dependency install is needed when using `node src/cli.js` directly.
Contributors run `npm ci --ignore-scripts` for development tools.

## MCP

Add the following command and arguments to your host's MCP configuration,
replacing the path with the installed DIRF checkout:

```json
{
  "command": "node",
  "args": ["<path-to-DIRF>/src/mcp.js"]
}
```

The server uses standard input/output, not a public HTTP listener. The host
may require a wrapper such as `mcpServers`; consult its configuration format.

The supported tools resolve projects, list projects and attempts, read and
write handoffs, record progress, and retrieve one attempt. These tools expose
a subset of the CLI. Tool calls happen only when the host makes them; adding
this configuration does not automatically record progress or start work.

For a delegated task, pass its exact attempt ID to `dirf_read_assignment`.
The result includes that attempt's workflow and handoff, so a fresh session
can retrieve its assignment without reading unrelated project progress.
Names, unknown IDs, and missing handoff files are rejected. Returned metadata
is limited to assignment fields; internal execution authority is omitted.
This selects an attempt; it does not
authenticate the caller or grant permission to execute its instructions.

After `dirf_record_progress`, inspect `recorded`, `accepted`,
`attempt_accepted`, and `reason`. `ok` means the tool handled the request;
it does not mean the checkpoint became current. A rejected stale or
unverifiable revision must be reconciled with the current assignment before
continuing. Progress records do not create approval or decision-gate records.
Once an attempt has a work identity, checkpoints must retain that identity.
An explicitly empty identity or a different identity is rejected without
changing the handoffs, lifecycle, or progress sequence.

## Session startup and progress

Run `dirf state active` from the project checkout. Continue the reported active
attempt, create new work if idle, or resolve an ownership conflict. Use
`dirf resume <attempt-id>` only for a named planned attempt.

An optional session-start hook may run `dirf state active --hook`. Its wrapper
is host-specific; the three-state result is the same as the CLI.

```bash
dirf record-progress "Implemented and tested the change" \
  --attempt <attempt-id> --phase "<workflow phase>" \
  --files "src/example.js" --next "Review the current diff"
```

Use the phase from that attempt's workflow. A later session follows the saved
next action and checks current repository facts before continuing.

## Updates and team use

Check `dirf doctor` and `git status` before updating a linked installation.
Review the changelog, select a tested revision, then run the release checks in
that checkout. Do not bulk-update dirty project checkouts.

Teams may pin the DIRF commit in their setup instructions or use a Git
submodule pinned to a reviewed commit. DIRF does not interpret a separate
`.dirf-version` file. The canonical registry is under `~/.dirf/`; there is no
second project list to maintain.

The old `setup-integration.sh`, custom project-list updater, and standalone
`pr-review` package have been retired. Replace them with the CLI/MCP setup
above and the [current review playbook](../playbooks/pr-review/README.md).
Existing shell aliases or update scripts are user-owned: inspect and remove
them manually if obsolete. Installing this change does not alter host settings.

## Troubleshooting

- Command missing or wrong revision: run the direct Node command and check
  `dirf doctor` after fixing the global installation.
- MCP unavailable: verify the command/path, Node version, and host logs. The
  server waits for JSON-RPC input; silence at a terminal is not a startup failure.
- Progress not advancing: check `dirf state active`, the attempt ID, and its
  allowed phases. Do not use another attempt merely because it is newer.

See the [reference](reference.md) for the complete command and state contracts.
