#!/usr/bin/env node
// hook <harness>        the turn-end hook
// hook <harness> tool   the hook after each tool call
//
// Harnesses run these in every session on the machine. After a tool, a session in a game is told of game events it has
// not been given. The turn-end hook only tells the server the turn is over, so new events wake the idle session; it
// never holds the turn. A hook never stands in the way: if it breaks, or the session is in no game, or its server does
// not answer, the session goes on as usual.

import fs from "node:fs";
import { HARNESSES, isHarness } from "./harnesses.ts";
import { call, open, parents, sessionOf } from "./registry.mjs";

try {
  const [name, event] = process.argv.slice(2);
  if (!isHarness(name) || (event !== undefined && event !== "tool")) throw new Error(`usage: hook <${Object.keys(HARNESSES).join("|")}> [tool]`);
  const entries = open();
  if (entries.length) {
    const input = JSON.parse(fs.readFileSync(0, "utf8") || "{}");
    const entry = sessionOf(entries, parents(), input.sessionId ?? input.session_id);
    if (entry && event === "tool") {
      const tool = input.toolName ?? input.tool_name;
      const { notice } = await call(entry, HARNESSES[name].endsTurn.includes(tool) ? "/hook/tool-ending-turn" : "/hook/tool", 2000);
      if (notice) console.log(JSON.stringify(HARNESSES[name].afterTool(notice)));
    } else if (entry) {
      await call(entry, "/hook/stop", 2000);
    }
  }
} catch (error) {
  console.error(`a2a-games hook: ${error instanceof Error ? error.message : error}`);
}
