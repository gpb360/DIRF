// Locks the mostly-STE style guidance: no copy states the old hard limits as rules.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "../src/paths.js";

const read = (path) => readFileSync(join(ROOT, path), "utf8");
const HARD_LIMIT = /Limit instructions to 20 words|Keep sentences within the ASD-STE100 limits|Give one instruction per sentence|word-count conventions in section 8|Keep lists to five relevant items/;

test("policy and editing skills ask for mostly-STE style, not hard limits", () => {
  for (const path of ["policies/workflow-policy.md", "skills/unslop/README.md", "skills/ste100/README.md", "playbooks/documentation/README.md"]) {
    const text = read(path);
    assert.doesNotMatch(text, HARD_LIMIT, path);
    assert.match(text, /mostly in (the style of )?ASD-STE100/, path);
  }
});

test("ste check findings are advisory and exit 1 is not a failed step", () => {
  for (const path of ["policies/workflow-policy.md", "skills/unslop/README.md", "skills/ste100/README.md"]) {
    const text = read(path).replace(/\s+/g, " ");
    assert.match(text, /findings are advisory/, path);
    assert.match(text, /exit status 1/i, path);
  }
  const frontmatter = read("skills/ste100/README.md").split("---")[1];
  assert.match(frontmatter, /description: "[^"]*mostly in ASD-STE100[^"]*as advisory"/);
  assert.match(read("skills/ste100/README.md"), /Treat\s+them as targets, not hard limits/);
});
