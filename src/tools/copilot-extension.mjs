// The way into an open Copilot CLI session, after agent-room's extension. Copilot runs this inside every session. It
// waits on the session's a2a-games server, and when game events wait for the player it sends the session a prompt
// saying so, which starts a turn even when the session sat idle.
// Copilot loads it from ~/.copilot/extensions/a2a-games/extension.mjs, a one-line file that imports this one.

import { joinSession } from "@github/copilot-sdk/extension";
import { setTimeout as pause } from "node:timers/promises";
import { call, open, sessionOf } from "./registry.mjs";

const session = await joinSession({});

for (;;) {
  try {
    // This process's parent is the Copilot CLI, and the session's server is filed under it.
    const entry = sessionOf(open(), [process.ppid]);
    if (!entry) {
      await pause(5000);
      continue;
    }
    // Held open by the server until there is something to say.
    const answer = await call(entry, "/listen", 60_000);
    if (answer.prompt) await session.send({ prompt: answer.prompt });
    else if (!answer.again) await pause(1000);
  } catch {
    await pause(5000);
  }
}
