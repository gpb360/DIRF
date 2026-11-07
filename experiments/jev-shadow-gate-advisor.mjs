// @ts-check
// Offline shadow gate advisor — the single approved experiment from DIRF learn
// attempt 20260918T180949421Z-learn-source (recommendation jev-recommendation-v1).
//
// Maps a JEV-shaped evaluation response — a Choice over command safety plus a
// Noul for file deletion — onto DIRF's gate outcomes as ADVICE ONLY. It never
// mutates attempt state, never sits in the gate enforcement path, and never
// touches the network: callers pass recorded fixture responses instead of live
// API calls, so the mapping is testable offline with zero dependencies.
//
// Pattern source: flaviocopes.com/jev — high confidence acts, low confidence
// asks a human, and the thresholds stay in caller-owned code.

/**
 * Confidence thresholds, named so a reader can audit and change them in one
 * place. Below the review floor nothing is automatable; at or above the
 * automation floor a safe label may be advised as acceptable. At or above the
 * deletion floor a deletion signal blocks automation.
 */
export const THRESHOLDS = Object.freeze({ reviewFloor: 0.5, automationFloor: 0.9, deletionFloor: 0.5 });

const SAFE_LABELS = new Set(["read_only", "reversible"]);

/**
 * Builds the request body for a pre-gate command-safety evaluation.
 * @param {{ command: string, directory?: string }} input
 * @returns {object} JEV-shaped request: one Choice over safety labels plus
 * one Noul for deletion signals, criteria describing situations not degrees.
 */
export function buildGateRequest({ command, directory = "the repository" }) {
  return {
    model: "jev-latest",
    state: { command, directory },
    questions: {
      action: {
        type: "choice",
        instructions:
          "How would running `command` inside `directory` affect the system?",
        criteria: {
          read_only:
            "Observes state only: no file, git, network, or process change",
          reversible:
            "Changes files or state in a way ordinary git or OS operations undo",
          irreversible:
            "Destroys data, rewrites history, publishes, or reaches outside the repository",
        },
      },
      deletes_files: {
        type: "noul",
        instructions: "Does `command` delete or overwrite files?",
        criteria: {
          true: "Removes, truncates, or overwrites existing files or directories",
          false: "Creates new files only, or changes nothing on disk",
        },
      },
    },
  };
}

/**
 * Maps a recorded evaluation response onto an advisory gate tier.
 * @param {{ answers: { action: { choice: string, confidence: number }, deletes_files: { noul: number } } }} response
 * @returns {{ tier: "accept"|"confirm"|"deny", reason: string }} the advised
 * tier: "accept" may proceed, "confirm" asks the user, "deny" recommends
 * refusing. Advisory output only — the gate record stays user-owned.
 */
export function adviseGate(response) {
  const { action, deletes_files } = response.answers;
  if (action.confidence < THRESHOLDS.reviewFloor) {
    return { tier: "confirm", reason: "label confidence below the review floor" };
  }
  const deletes = deletes_files.noul >= THRESHOLDS.deletionFloor;
  if (action.choice === "irreversible") {
    return { tier: "deny", reason: deletes ? "irreversible and deletes files" : "irreversible" };
  }
  if (!SAFE_LABELS.has(action.choice)) {
    return { tier: "confirm", reason: "unrecognized label" };
  }
  if (
    !deletes &&
    action.confidence >= THRESHOLDS.automationFloor
  ) {
    return {
      tier: "accept",
      reason: "safe label at or above the automation floor with no deletion signal",
    };
  }
  return {
    tier: "confirm",
    reason: "safe label below the automation floor or deletion signal present",
  };
}
