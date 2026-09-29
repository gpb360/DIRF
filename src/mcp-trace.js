import { randomUUID } from "node:crypto";

function safeAttributes(toolName, outcome) {
  const attributes = {
    "dirf.tool_id": toolName,
    "dirf.execution_outcome": outcome,
  };
  // Request arguments are untrusted content, even when named like identifiers.
  return attributes;
}

function emit(traceSink, span) {
  if (typeof traceSink !== "function") return;
  try {
    Promise.resolve(traceSink(span)).catch(() => {});
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
  let didThrow = false;

  try {
    result = run();
  } catch (caught) {
    didThrow = true;
    error = caught;
  }

  const outcome = didThrow ? "error" : result?.recorded === false ? "rejected" : "success";
  const attributes = safeAttributes(toolName, outcome);
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

  if (didThrow) throw error;
  return result;
}
