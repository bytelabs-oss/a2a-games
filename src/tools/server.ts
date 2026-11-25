import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { setTimeout as sleep } from "node:timers/promises";
import { z } from "zod";
import { GameSession, ToolError, type Answer } from "./game.ts";
import { HARNESSES, harnessOf, type Harness, type Reach } from "./harnesses.ts";
import { register, unregister } from "./registry.mjs";
import * as turn from "./turn.ts";
import pkg from "../../package.json" with { type: "json" };

const game = new GameSession();
const server = new McpServer({ name: pkg.name, version: pkg.version });
game.onEvent = turn.heard;

// The harness this session runs in, known from the MCP client's name, and what it takes to wake the session.
let harness: Harness | undefined;
let reach: Reach = {};

// Hands the agent the game events it has not been given, through the game's own snapshot, so the game counts them seen.
// After a tool that ends the turn they go unread, so they are handed over again once the turn has ended.
async function catchUp(endsTurn: boolean) {
  if (!turn.waiting() || !game.current) return null;
  const { events = [] } = await game.call("snapshot", undefined, AbortSignal.timeout(1500));
  turn.handed(events, endsTurn);
  return events.length ? ["New game events:", ...events.map((event) => `- ${event.text}`), "Call snapshot to see the game."].join("\n") : null;
}

// What the session's hooks and its Copilot extension ask, on a loopback port filed in the registry while in a game.
const routes: Record<string, (response: ServerResponse) => object | null | undefined | Promise<object | null>> = {
  "/hook/tool": async () => {
    turn.active();
    return { notice: await catchUp(false) };
  },
  "/hook/tool-ending-turn": async () => {
    turn.active();
    return { notice: await catchUp(true) };
  },
  // Game events never hold a turn; the turn end only marks the session idle, so new events wake it.
  "/hook/stop": () => {
    turn.ended();
    return {};
  },
  ...Object.assign({}, ...Object.values(HARNESSES).map((one: Harness) => one.routes)),
};
const local = createServer(async (request, response) => {
  const route = routes[request.url ?? ""];
  if (!route) return response.writeHead(404).end();
  const body = await Promise.resolve(route(response)).catch(() => ({}));
  if (body) response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(body));
});
local.unref();

turn.watch(() => {
  const time = new Date().toLocaleTimeString("en-GB");
  harness?.knock(reach, `a2a-games: new game events are waiting for you as "${game.current?.player.name}". Call snapshot to see them. (${time})`);
});

// Results are JSON text. Failures are { error: { code, message, status? } } with isError set.
function result(body: object, isError = false) {
  return { content: [{ type: "text" as const, text: JSON.stringify(body) }], isError };
}

function toolFail(error: unknown) {
  const { code = "internal", message, status } = error instanceof ToolError ? error : { message: error instanceof Error ? error.message : String(error), status: undefined };
  return result({ error: { code, message, status } }, true);
}

// Tools without inputs get the strict empty schema the MCP spec recommends for them.
interface ToolConfig<Input extends z.ZodObject> {
  title: string;
  description: string;
  inputSchema?: Input;
  annotations?: ToolAnnotations;
}
function tool<Input extends z.ZodObject>(name: string, { inputSchema, annotations, ...config }: ToolConfig<Input>, handler: (args: z.infer<Input>, signal: AbortSignal) => Answer | Promise<Answer>) {
  const schema: z.ZodObject = inputSchema ?? z.strictObject({});
  server.registerTool(name, { ...config, inputSchema: schema, annotations: { openWorldHint: true, ...annotations } }, async (args, extra) => {
    if (!harness) {
      harness = harnessOf(server.server.getClientVersion()?.name);
      reach = harness?.reach() ?? {};
    }
    turn.active();
    try {
      // The SDK has parsed args with inputSchema, which is Input or, with none given, the empty object.
      const data = await handler(args as z.infer<Input>, extra.signal);
      if (Array.isArray(data.events)) turn.gave(data.events);
      return result(data);
    } catch (error) {
      return toolFail(error);
    }
  });
}

tool("join", {
  title: "Join game",
  description: "Join a game at its server address. Returns the rules and the actions. Players talk on the game's room channel. Each message shows under the sender's player name and is at most 300 characters.",
  inputSchema: z.object({ address: z.url({ protocol: /^https?$/ }).describe("The game's http or https address."), name: z.string().min(1).describe("Your player name: one word, 1 to 50 characters, no spaces. It must not be taken in this game, ignoring case.") }),
}, async (args, signal) => {
  turn.reset();
  const joined = await game.join(args, signal);
  if (!local.listening) await new Promise<void>((resolve) => local.listen(0, "127.0.0.1", resolve));
  register({ session: reach.session, port: (local.address() as AddressInfo).port });
  return joined;
});

tool("snapshot", {
  title: "Game snapshot",
  description: "Get the game now: its status (waiting, playing or finished), the players and whether each is ready and connected, your view, and the events you have not seen. Other players' private views are not included.",
  annotations: { readOnlyHint: true },
}, (args, signal) => game.call("snapshot", undefined, signal));

tool("act", {
  title: "Act",
  description: "Run game steps, separated by semicolons, in order. Answers once a step has to wait, with the results so far and the steps still running. If a step fails, the steps after it are dropped, and a reply among your events says which step failed and why. You cannot act while steps are running; stop ends them.",
  inputSchema: z.object({ steps: z.string().min(1) }),
}, (args, signal) => game.call("act", args, signal));

tool("stop", {
  title: "Stop",
  description: "Stop your running steps. The current one ends where it is, and the rest are dropped.",
  annotations: { destructiveHint: false, idempotentHint: true },
}, (args, signal) => game.call("stop", {}, signal));

tool("ready", {
  title: "Ready",
  description: "Tell the game you are ready.",
  annotations: { destructiveHint: false, idempotentHint: true },
}, (args, signal) => game.call("ready", {}, signal));

tool("leave", {
  title: "Leave game",
  description: "Leave the game.",
  annotations: { destructiveHint: false, idempotentHint: true },
}, async (args, signal) => {
  unregister();
  turn.reset();
  return game.leave(signal);
});

// MCP stdio clients stop a server by closing its stdin, then by a signal.
// The player leaves the game before the process exits.
process.once("exit", unregister);
const shutdown = () => Promise.race([game.leave().catch(() => {}), sleep(3000)]).then(() => process.exit(0));
process.stdin.once("end", shutdown);
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

await server.connect(new StdioServerTransport());
