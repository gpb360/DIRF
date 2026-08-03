#!/bin/sh
# Shared review gate. Given one or more incoming commit-ish arguments, refuse
# unless each carries a recorded review score >= the threshold.
#
# The review record lives in a git note on the `reviews` ref, so it travels
# with the commit, needs no tracked file, and works offline. Record one with:
#
#   git notes --ref=reviews add -m 'score: 9' <sha>
#
# The note body may say anything else it likes; only the first `score:` line
# is read. Everything after it is free-form rationale, which is the point --
# the score is machine-checked, the reasoning stays human-readable.
#
# Tune: git config dirf.reviewThreshold 9
#
# Sourced by pre-merge-commit (clean merges) and pre-commit (merges that had
# conflicts). Exits nonzero if any incoming head is unreviewed or below bar.

# Ignore SIGPIPE. If our diagnostics are piped somewhere that stops reading
# (`git merge 2>&1 | head`), a write to the closed pipe would otherwise kill
# this script with signal 13 -- and git reads a signal-killed hook as a pass,
# silently turning a refusal into a merge. Verdict must not depend on whether
# anyone is listening.
trap '' PIPE

threshold=$(git config --int dirf.reviewThreshold 2>/dev/null) || threshold=""
[ -n "$threshold" ] || threshold=9

fail=0

for head in "$@"; do
	[ -n "$head" ] || continue

	sha=$(git rev-parse --verify --quiet "$head^{commit}") || continue
	subject=$(git log -1 --format=%s "$sha")
	short=$(git rev-parse --short "$sha")

	note=$(git notes --ref=reviews show "$sha" 2>/dev/null)
	if [ -z "$note" ]; then
		echo "review-gate: no review recorded for $short ($subject)" >&2
		echo "  Record one with:" >&2
		echo "    git notes --ref=reviews add -m 'score: N' $short" >&2
		fail=1
		continue
	fi

	# First `score:` line wins. Tolerates `Score : 9`, `score: 9/10`, and
	# leading whitespace, because a human writes this by hand under time
	# pressure and a gate that rejects on formatting only teaches people to
	# reach for --no-verify.
	score=$(printf '%s\n' "$note" \
		| sed -n 's/^[[:space:]]*[Ss][Cc][Oo][Rr][Ee][[:space:]]*:[[:space:]]*\([0-9][0-9]*\).*/\1/p' \
		| head -n 1)

	if [ -z "$score" ]; then
		echo "review-gate: review note on $short has no 'score:' line." >&2
		echo "  Found instead:" >&2
		printf '%s\n' "$note" | sed 's/^/    /' >&2
		fail=1
		continue
	fi

	if [ "$score" -lt "$threshold" ]; then
		echo "review-gate: $short scored $score, below the $threshold bar. ($subject)" >&2
		echo "  Fix the findings and re-record:" >&2
		echo "    git notes --ref=reviews add -f -m 'score: N' $short" >&2
		fail=1
		continue
	fi

	echo "review-gate: $short reviewed at $score/$threshold+. ok"
done

if [ "$fail" -ne 0 ]; then
	echo "" >&2
	echo "  Override with: --no-verify" >&2
	exit 1
fi

exit 0
