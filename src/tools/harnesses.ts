// The harnesses a player's session can run in. Each entry says how the
// harness is recognised, what its after-tool hook prints, how an idle session of it is woken, and how the tools are
// registered with it. Supporting another harness means adding an entry.

import { execFileSync, spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import type { ServerResponse } from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { cliPid } from "./registry.mjs";

// How to reach a session to wake it: its id, and for Claude Code its message socket and token.
export interface Reach {
  session?: string;
  socket?: string;
  token?: string;
}

export interface Harness {
  // The MCP client names the harness reports.
  clients: string[];
  // What the after-tool hook prints to hand the session text.
  afterTool(text: string): object;
  // Tools whose call ends the session's turn, so text handed over after them is never read.
  endsTurn: string[];
  reach(): Reach;
  knock(reach: Reach, text: string): void;
  // Routes the harness's own parts call on the session's server.
  routes?: Record<string, (response: ServerResponse) => object | undefined>;
  register(): void;
  unregister(): void;
}

const home = (...parts: string[]) => path.join(os.homedir(), ...parts);
const codexHome = (name: string) => path.join(process.env.CODEX_HOME ?? home(".codex"), name);
const file = (name: string) => path.join(import.meta.dirname, name);
const hook = (...args: string[]) => `node ${JSON.stringify(file("hook.ts"))} ${args.join(" ")}`;

function run(command: string, ...args: string[]) {
  const { status, error } = spawnSync(command, args, { stdio: "inherit" });
  if (error || status !== 0) throw new Error(`${command} ${args.slice(0, 2).join(" ")} failed${error ? `: ${error.message}` : ""}.`);
}

// The file holds whatever the harness keeps there; only the keys edit touches are known.
function editJson(where: string, edit: (json: Record<string, any>) => void) {
  const json = fs.existsSync(where) ? JSON.parse(fs.readFileSync(where, "utf8")) : {};
  edit(json);
  fs.mkdirSync(path.dirname(where), { recursive: true });
  fs.writeFileSync(where, `${JSON.stringify(json, null, 2)}\n`);
}

// Takes out of Claude Code's hooks every one that runs a hook file of this folder, whatever its extension, so a hook
// left by an earlier checkout (hook.mjs) goes too. A group left with no hooks goes with it.
export function withoutOurHooks(hooks: Record<string, { hooks?: { command?: string; [key: string]: unknown }[] }[]>, dir = import.meta.dirname) {
  // Commands are written as node "<dir>/hook.<extension>" ..., so the quoted path up to the extension marks ours.
  const ours = JSON.stringify(path.join(dir, "hook.")).slice(0, -1);
  for (const event of Object.keys(hooks)) {
    hooks[event] = hooks[event]
      .map((group) => ({ ...group, hooks: group.hooks?.filter((one) => !one.command?.includes(ours)) }))
      .filter((group) => group.hooks?.length);
    if (!hooks[event].length) delete hooks[event];
  }
  return hooks;
}

// The Copilot extension's open request, held until there is a knock, and a knock that came while none was open.
const HOLD_MS = 25_000;
let listener: { response: ServerResponse; timer: NodeJS.Timeout } | null = null;
let pending: string | null = null;

function answer(body: object) {
  if (!listener) return false;
  clearTimeout(listener.timer);
  listener.response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(body));
  listener = null;
  return true;
}

export const HARNESSES = {
  claude: {
    clients: ["claude-code"],
    afterTool: (text) => ({ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: text } }),
    endsTurn: [] as string[],
    // Claude Code gives every session a message socket of its own, with a token.
    reach: () => ({ session: process.env.CLAUDE_CODE_SESSION_ID, socket: process.env.CLAUDE_CODE_MESSAGING_SOCKET, token: process.env.CLAUDE_CODE_MESSAGING_TOKEN }),
    // The socket takes JSON lines: the token, then a user message, which starts a turn.
    knock(reach, text) {
      if (!reach.socket) return;
      const lines = [{ type: "auth", token: reach.token }, { type: "user", message: { role: "user", content: text } }];
      const socket = net.createConnection(reach.socket, () => socket.end(lines.map((line) => `${JSON.stringify(line)}\n`).join("")));
      socket.on("error", (error) => console.error(`a2a-games: could not wake the Claude Code session: ${error.message}`));
    },
    register() {
      spawnSync("claude", ["mcp", "remove", "a2a-games", "-s", "user"], { stdio: "ignore" });
      run("claude", "mcp", "add", "--scope", "user", "--transport", "stdio", "a2a-games", "--", "node", file("server.ts"));
      editJson(home(".claude", "settings.json"), (settings) => {
        const hooks = withoutOurHooks((settings.hooks ??= {}));
        for (const [event, args] of [["Stop", ["claude"]], ["PostToolUse", ["claude", "tool"]]] as const) {
          (hooks[event] ??= []).push({ hooks: [{ type: "command", command: hook(...args) }] });
        }
      });
    },
    unregister() {
      spawnSync("claude", ["mcp", "remove", "a2a-games", "-s", "user"], { stdio: "ignore" });
      if (fs.existsSync(home(".claude", "settings.json"))) editJson(home(".claude", "settings.json"), (settings) => settings.hooks && withoutOurHooks(settings.hooks));
    },
  },

  copilot: {
    clients: ["github/cli", "copilot-cli", "github-copilot-cli"],
    afterTool: (text) => ({ additionalContext: text }),
    endsTurn: ["task_complete"],
    reach: () => ({ session: process.env.COPILOT_AGENT_SESSION_ID }),
    // Hands the text to the extension waiting inside the session, which sends it as a prompt.
    knock(reach, text) {
      if (!answer({ prompt: text })) pending = text;
    },
    routes: {
      "/listen"(response: ServerResponse) {
        answer({});
        listener = { response, timer: setTimeout(() => answer({ again: true }), HOLD_MS) };
        response.on("close", () => listener?.response === response && answer({}));
        if (pending) {
          answer({ prompt: pending });
          pending = null;
        }
      },
    },
    register() {
      spawnSync("copilot", ["mcp", "remove", "a2a-games"], { stdio: "ignore" });
      run("copilot", "mcp", "add", "--transport", "stdio", "a2a-games", "--", "node", file("server.ts"));
      editJson(home(".copilot", "hooks", "a2a-games.json"), (config) =>
        Object.assign(config, { version: 1, hooks: { agentStop: [{ type: "command", bash: hook("copilot") }], postToolUse: [{ type: "command", bash: hook("copilot", "tool") }] } }),
      );
      fs.mkdirSync(home(".copilot", "extensions", "a2a-games"), { recursive: true });
      fs.writeFileSync(home(".copilot", "extensions", "a2a-games", "extension.mjs"), `import ${JSON.stringify(file("copilot-extension.mjs"))};\n`);
    },
    unregister() {
      spawnSync("copilot", ["mcp", "remove", "a2a-games"], { stdio: "ignore" });
      fs.rmSync(home(".copilot", "hooks", "a2a-games.json"), { force: true });
      fs.rmSync(home(".copilot", "extensions", "a2a-games"), { recursive: true, force: true });
    },
  },
  codex: {
    clients: ["codex-mcp-client"],
    afterTool: (text) => ({ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: text } }),
    endsTurn: [] as string[],
    // Codex tells its MCP servers nothing about the session, but keeps the session's rollout file open, and the
    // session id is in that file's name.
    reach() {
      try {
        const open = execFileSync("lsof", ["-p", String(cliPid()), "-Fn"], { encoding: "utf8" });
        return { session: open.match(/rollout-[^\n]*-([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})\.jsonl/)?.[1] };
      } catch {
        return {};
      }
    },
    // `codex queue` hands the session a message, which starts a turn when it is idle.
    knock(reach, text) {
      if (!reach.session) return;
      spawn("codex", ["queue", "--thread", reach.session, "--message", text], { stdio: "ignore" }).on("error", (error) =>
        console.error(`a2a-games: could not wake the Codex session: ${error.message}`),
      );
    },
    register() {
      spawnSync("codex", ["mcp", "remove", "a2a-games"], { stdio: "ignore" });
      run("codex", "mcp", "add", "a2a-games", "--", "node", file("server.ts"));
      editJson(codexHome("hooks.json"), (config) => {
        const hooks = withoutOurHooks((config.hooks ??= {}));
        for (const [event, args] of [["Stop", ["codex"]], ["PostToolUse", ["codex", "tool"]]] as const) {
          (hooks[event] ??= []).push({ hooks: [{ type: "command", command: hook(...args) }] });
        }
      });
    },
    unregister() {
      spawnSync("codex", ["mcp", "remove", "a2a-games"], { stdio: "ignore" });
      if (fs.existsSync(codexHome("hooks.json"))) editJson(codexHome("hooks.json"), (config) => config.hooks && withoutOurHooks(config.hooks));
    },
  },
} satisfies Record<string, Harness>;

export type HarnessName = keyof typeof HARNESSES;
export const isHarness = (name: string | undefined): name is HarnessName => name !== undefined && Object.hasOwn(HARNESSES, name);
export const harnessOf = (client: string | undefined): Harness | undefined => Object.values(HARNESSES).find((harness) => client !== undefined && harness.clients.includes(client));
