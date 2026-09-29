import { randomUUID } from "node:crypto";

const SAFE_ARGUMENTS = new Map([
  ["attempt", "dirf.attempt_id"],
  ["workItem", "dirf.work_item"],
  ["reviewRevision", "dirf.review_revision"],
]);

function safeAttributes(toolName, args, outcome) {
  const attributes = {
    "dirf.tool_id": toolName,
    "dirf.execution_outcome": outcome,
  };
  for (const [argument, attribute] of SAFE_ARGUMENTS) {
    if (typeof args[argument] === "string" && args[argument].trim()) {
      attributes[attribute] = args[argument].trim();
    }
  }
  return attributes;
}

function emit(traceSink, span) {
  if (typeof traceSink !== "function") return;
  try {
    traceSink(span);
  } catch {
    // Observability is evidence-only and must never affect tool execution.
  }
}

export function traceMcpToolCall(toolName, args, run, options = {}) {
  const { traceSink = null, idFactory = randomUUID } = options;
  if (typeof traceSink !== "function") return run();

  const traceId = idFactory();
  const requestSpanId = idFactory();
  const toolSpanId = idFactory();
  let result;
  let error;

  try {
    result = run();
  } catch (caught) {
    error = caught;
  }

  const outcome = error ? "error" : result?.recorded === false ? "rejected" : "success";
  const attributes = safeAttributes(toolName, args, outcome);
  emit(traceSink, {
    name: toolName,
    kind: "TOOL",
    traceId,
    spanId: toolSpanId,
    parentSpanId: requestSpanId,
    attributes,
  });
  emit(traceSink, {
    name: "mcp.tools/call",
    kind: "CHAIN",
    traceId,
    spanId: requestSpanId,
    parentSpanId: null,
    attributes,
  });

  if (error) throw error;
  return result;
}
