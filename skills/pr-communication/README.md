---
name: pr-communication
kind: skill
description: "Write pull request titles, descriptions, and agent-written comments that lead with the problem and name the model that did the work"
uses: []
details: []
inputs: ["pull request or branch", "the user's original request", "comment to post"]
outputs: ["pull request title and description", "attributed comment"]
capabilities: ["contribution writeup"]
---

# Pull request communication

Several agents and models can work on one pull request, and their comments
post under the user's own account. A reader must be able to tell what the
change is for, how it was proved, and which model wrote each part.

Project instructions win. If the project forbids model attribution, leave the
attribution lines out and keep the rest.

## Before you file

1. Check whether a pull request for this branch already exists. Update it
   instead of opening a second one.
2. Use the base branch the project names. Do not assume `main`.
3. Read the diff against that base. Confirm that it contains the goal and
   nothing else.

## Title

Follow the title convention of the repository. Read recently merged pull
requests for examples. The title usually becomes the commit message, so state
the outcome a person gets, not the mechanism.

- Weak: `fix(export): add retry wrapper around the upload client`
- Strong: `fix(export): long videos no longer fail at 99 percent`

## Description

Write these parts in this order:

1. **Problem.** One to three sentences in the user's terms, taken from the
   original request.
2. **Solution.** A short explanation. Do not list every changed file or
   function.
3. **Proof.** One short line that says how the change was verified.
4. **Known gaps.** What this pull request does not fix, when there is any.
5. **Made by.** The last line names the model and harness:
   `Created with <model> in <harness>.` Include each model that wrote part of
   the change.

Use the model name that the harness reports. If the harness does not report
one, name the harness only. Never guess a model.

Open the pull request as ready, not as a draft, so review bots run. Rewrite
the description when later fixes change what the pull request does.

## Comments

Start every comment that an agent posts for the user with this note:

```md
> [!NOTE]
> 🤖 **<model> in <harness> responding on behalf of <user>**

The comment starts here.
```

- Keep the attribution inside the note and the reply outside it.
- Use this format for top-level comments, inline review comments, replies to
  bots or reviewers, and the written reason for a dismissed finding.
- Do not add it to descriptions, commit messages, or text the user asked you
  to post unchanged.
- Add no second attribution, signature, heading, or horizontal rule.

Write the reply itself in a direct style:

- Lead with the conclusion.
- Cite the code, check, or reproduction that supports it.
- Separate verified facts from judgment.
- Leave out thanks, filler, and status narration.

Post a comment only when it serves the user's request. Do not post "still
waiting" or other filler.

## Before you send

- Check the title, description, comment, quotes, and attachments for secrets
  and private details.
- Preview the Markdown so quotes and blank lines render correctly.
- After you post, confirm that GitHub returned the URL of the comment or
  review. Resolve a review thread only after its reply is posted.

## GitHub rate limits

`gh pr create`, `gh pr view`, and `gh pr checks` use the GraphQL limit. The
REST limit is separate. When GraphQL is used up, read and write through REST:

- Read a pull request: `gh api repos/<owner>/<repo>/pulls/<n>`
- Read checks: `gh api repos/<owner>/<repo>/commits/<sha>/check-runs`
- Open a pull request:
  `gh api repos/<owner>/<repo>/pulls -f title=... -f head=... -f base=... -F body=@<file>`

Completion: the pull request or comment exists on GitHub, its URL is recorded,
and the text names the problem, the proof, and the model, unless the project
forbids attribution.
