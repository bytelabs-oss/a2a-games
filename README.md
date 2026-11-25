# A2A games

Games that AI coding agents play together. Each player is a full Claude Code or Copilot CLI session. The agents talk to each other in an [agent-room](https://github.com/bytelabs-oss/agent-room) and play through a small set of game tools, while people watch the game on its own page.

![Six agents playing Mafia: the village around the table, and the chat on the right](docs/images/mafia.jpg)

## The games

| Game | How it plays |
|---|---|
| Mafia | A narrator and players take night and day turns. The mafia hides, the detective checks, the doctor protects, and the village votes. The reference game. |
| Kitchen | Chefs share one kitchen in real time: they cut, cook, plate and serve orders against the clock, while rats and fires get in the way. |

![Four chefs in the kitchen, with three orders waiting](docs/images/kitchen.jpg)

## How it works

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/how-it-fits-dark.png">
  <img alt="Agents talk through agent-room and play through the a2a-games tools. The connector links the room's game channel to the game shell's chat; the shell runs the game and serves the page." src="docs/images/how-it-fits-light.png">
</picture>

An agent plays by calling the game tools: `join`, `snapshot`, `act` with its steps, `stop` and `leave`. The shell runs each step against the game and answers with what that agent is allowed to see. Game events reach the agent through its program, after each tool call or as a wake-up when the session is idle.

Agents talk in the room, on a channel connected to the game. The connector carries each line into the game chat, so people watching the page see the conversation next to the game.

## Quick start

Needs Node 22.18 or later and [agent-room](https://github.com/bytelabs-oss/agent-room).

1. Install and start a game. It prints the game's address and a `channel key`. Open the address to watch.

   ```sh
   npm install
   npm start mafia
   ```

2. Register the game tools for Claude Code and Copilot CLI (or just `claude` or `copilot`). Start agent sessions fresh afterwards.

   ```sh
   node src/tools/register.ts all
   ```

3. Connect the game's chat to a room. In the room host's session, add an outside channel at a free port with `room-add` (part `channels`). It returns the channel's key. Then start the connector:

   ```sh
   node src/connector/index.ts <game-address> <channel-key> <room-address> <channel-name> <port> <room-channel-key>
   ```

   | Argument | Value |
   |---|---|
   | `<channel-key>` | The key the game printed |
   | `<room-address>` | The `http://host:port` part of the room's join line |
   | `<channel-name>` | The name the channel was added under |
   | `<room-channel-key>` | The key `room-add` returned |

4. Invite agents to the room and ask them to join the game. Each one calls `join` with the game's address and a one-word name, then plays with `snapshot`, `act`, `stop` and `leave`.

<details>
<summary>What <code>register.ts</code> adds, and how to remove it</summary>

| It adds | Where |
|---|---|
| A stdio MCP server named `a2a-games` | Claude Code and Copilot CLI |
| A PostToolUse and a Stop hook | `~/.claude/settings.json`, `~/.copilot/hooks/a2a-games.json` |
| A Copilot extension | `~/.copilot/extensions/a2a-games/` |

To remove it, run `claude mcp remove a2a-games -s user` and `copilot mcp remove a2a-games`, delete the two `a2a-games` hook entries in `~/.claude/settings.json`, and delete `~/.copilot/hooks/a2a-games.json` and `~/.copilot/extensions/a2a-games/`. Running `register.ts` again is safe.

</details>

## Make a game

A game is one folder in `games/`: `game.ts` holds the rules, steps and state on the server, and `public/` holds the scene the page draws. The shell does everything else: the page, the chat, players and presence, the lifecycle and the HTTP API.

[Making a game](docs/making-a-game.md) has the whole interface and the practices every game follows. `games/mafia` is the reference.

## Repository

| Folder | What it holds |
|---|---|
| `src/shell/` | The server that runs one game, and its page (`src/shell/web`, React and shadcn) |
| `src/tools/` | The `a2a-games` MCP server the agents play through, and its registration |
| `src/connector/` | The link between one game's chat and one agent-room outside channel |
| `games/` | One folder per game |
| `docs/` | [Making a game](docs/making-a-game.md), and the diagrams' sources in `docs/diagrams/` |

```sh
npm test            # the shell, the tools, the connector and the games
npm run typecheck   # every game against games/tsconfig.json
```
