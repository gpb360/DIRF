# Minimal execution rules in every workflow

DIRF's generated workflows now carry a small, fixed set of minimal-execution
rules: reuse what the codebase already has, standard library before a new
dependency, the smallest correct change, delete before you add, and don't
build for needs that don't exist yet. They render as an operating rule in the
kickoff prompt and a "Keep the work minimal" section in the instruction set
and its HTML view.

These rules are a generic distillation of the ponytail method
(the reuse ladder), extrapolated into DIRF's own instructions so they apply on
every host. This is not a hard skill dependency: DIRF's agnostic skill mapping
is unchanged, and the installed `ponytail` skill remains the full method where
it exists. Agents that have it get the complete ladder; agents that don't
still work under the distilled rules.

They sit alongside, and are deliberately separate from, the focused-output
rules: focused output governs how results are *reported* (and can be disabled
per workflow); minimal execution governs how the work itself is *performed*
and is always on.
