import { writeSync } from "node:fs";
import { startMcpServer } from "../../src/mcp.js";

const traceSink = process.argv[2] === "fail"
  ? () => { throw new Error("test trace sink unavailable"); }
  : span => writeSync(3, JSON.stringify(span) + "\n");

startMcpServer({ traceSink });
