import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { pathToFileURL } from 'node:url';

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

// A failed answer carries error: the game's message, or a JSON-RPC error with one.
type Failure = { error?: string | { message?: string } };

async function json<T>(url: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(url, { ...options, signal: options.signal ?? AbortSignal.timeout(4000) });
  const value = (await response.json()) as T & Failure;
  if (!response.ok || value.error) {
    throw new Error((typeof value.error === 'object' ? value.error.message : value.error) ?? `HTTP ${response.status}`);
  }
  return value;
}

// What the game's /read gives: chat lines after a cursor.
interface Read {
  lines: { id: number; from: { id: string; name: string }; to: string[]; text: string; at: string }[];
  cursor: number;
}

// agent-room keeps its own fields of an A2A message in the metadata under this key.
const EXTENSION = 'https://github.com/bytelabs-oss/agent-room';

// A JSON-RPC call from the room. Its fields come from outside, so each is checked before use.
interface Call {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: {
    roomId?: string;
    agents?: { name: string; agentId: string }[];
    message?: {
      contextId?: string;
      parts?: { text?: string }[];
      metadata?: Record<string, { from?: { outsideId?: string | null }; to?: string[] } | undefined>;
    };
  };
}

interface Options {
  game: string;
  channelKey: string;
  room: string;
  channel: string;
  // The key agent-room's room-add returned for this channel. It lets the connector hand the room messages.
  roomKey: string;
  // The port to listen on. The host connects the channel at this address before the connector starts.
  port?: number;
  onError?: (message: string) => void;
}

function address(value: string) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Use an HTTP address without credentials.');
  }
  return url.origin;
}

function messageId(game: string, id: number) {
  // The same chat line keeps its UUID across retries and connector restarts.
  const hex = createHash('sha256').update(JSON.stringify([game, id])).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export async function startConnector({ game, channelKey, room, channel, roomKey, port = 0, onError = console.error }: Options) {
  game = address(game);
  room = address(room);
  if (typeof channelKey !== 'string' || !channelKey) throw new Error('Supply the channel key the game printed.');
  if (typeof roomKey !== 'string' || !roomKey) throw new Error('Supply the channel key room-add returned.');
  if (typeof channel !== 'string' || !channel.trim() || channel.length > 60) {
    throw new Error('Supply a channel name of 1 to 60 characters.');
  }
  const card = await json<{ capabilities?: { extensions?: { params?: { roomId?: string } }[] } }>(`${room}/.well-known/agent-card.json`);
  const roomId = card.capabilities?.extensions?.[0]?.params?.roomId;
  if (!roomId) throw new Error('The address has no active room.');

  const stopped = new AbortController();
  let cursor = 0;
  // Lines the connector said for an agent came from the room, so they are not handed back to it.
  const said = new Set<number>();
  const saying = new Set<Promise<unknown>>();
  let reading: Promise<void> | undefined;
  let again = false;
  let stopping = false;
  let retry: NodeJS.Timeout | undefined;
  let lastError: string | undefined;
  let resolveDone = () => {};
  let rejectDone = (error: unknown) => {};
  const done = new Promise<void>((resolve, reject) => {
    resolveDone = resolve;
    rejectDone = reject;
  });
  done.catch(() => {});

  const read = () => json<Read>(`${game}/read?since=${cursor}`);
  const handIn = (line: Read['lines'][number]) => json(room, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${roomKey}` },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'PostMessage',
      params: {
        message: {
          messageId: messageId(game, line.id),
          contextId: roomId,
          role: 'ROLE_USER',
          parts: [{ text: line.text }],
          metadata: {
            [EXTENSION]: {
              where: { channel },
              from: { name: line.from.name, outsideId: line.from.id },
              to: line.to,
              at: line.at,
              // A tagged player is woken and answers, as when an agent tags another in the room.
              ...(line.to.length && { requiresResponse: true }),
            },
          },
        },
      },
    }),
  });

  // Each update on the game's stream asks for one read. An update during a read asks for one more, and a failed
  // read tries again a second later, so nothing waits for the next update.
  function sync(): Promise<void> {
    if (stopping) return Promise.resolve();
    if (reading) {
      again = true;
      return reading;
    }
    clearTimeout(retry);
    reading = (async () => {
      do {
        again = false;
        const state = await read();
        await Promise.allSettled(saying);
        for (const line of state.lines) {
          if (!said.delete(line.id)) await handIn(line);
          cursor = line.id;
        }
        cursor = state.cursor;
      } while (again && !stopping);
      lastError = undefined;
    })().catch((error) => {
      const message = messageOf(error);
      if (!stopping && message !== lastError) onError(message);
      lastError = message;
      if (!stopping) retry = setTimeout(() => sync().catch(() => {}), 1000);
      throw error;
    }).finally(() => { reading = undefined; });
    return reading;
  }

  async function handle({ method, params }: Call) {
    if (!params || (params.roomId ?? params.message?.contextId) !== roomId) throw new Error('Wrong room.');
    if (method === 'ResolveIds') {
      const agents = params.agents;
      if (!Array.isArray(agents)) throw new Error('Expected agents.');
      // The game decides which player a name is. Two agents that land on one player are both left out.
      const found = await Promise.all(agents.map(async (agent) => {
        const response = await fetch(`${game}/players/lookup?name=${encodeURIComponent(agent.name)}`, {
          signal: AbortSignal.timeout(4000),
        });
        if (response.status === 404 || response.status === 400) return null;
        const value = (await response.json()) as { player: { id: string }; error?: string };
        if (!response.ok) throw new Error(value.error ?? `HTTP ${response.status}`);
        return value.player.id;
      }));
      const ids: Record<string, string> = {};
      agents.forEach((agent, at) => {
        const id = found[at];
        if (id && found.filter((one) => one === id).length === 1) ids[agent.agentId] = id;
      });
      return { ids };
    }
    if (method !== 'PostMessage') throw new Error('Unknown method.');
    const message = params.message;
    const fields = message?.metadata?.[EXTENSION];
    if (!message || !Array.isArray(message.parts) || !fields || typeof fields.from !== 'object' || !Array.isArray(fields.to)) {
      throw new Error('Expected a message from an agent.');
    }
    // An agent speaks in the game as its own player, so only an agent that has joined the game can.
    if (!fields.from?.outsideId) throw new Error('Join the game first.');
    const text = message.parts.map((part) => part.text ?? '').join('\n');
    const sending = json<{ line: { id: number } }>(`${game}/channel/send`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${channelKey}` },
      body: JSON.stringify({ from: fields.from.outsideId, text, to: fields.to }),
    });
    saying.add(sending);
    try {
      said.add((await sending).line.id);
    } finally {
      saying.delete(sending);
    }
    return {};
  }

  const server = createServer(async (request, response) => {
    let id: Call['id'] = null;
    const answer = (value: object, status = 200) => response.writeHead(status, {
      'content-type': 'application/json',
    }).end(JSON.stringify({ jsonrpc: '2.0', id, ...value }));
    try {
      if (request.method !== 'POST' || request.url !== '/') {
        return answer({ error: { code: -32600, message: 'POST JSON to /.' } }, 404);
      }
      if (!request.headers['content-type']?.startsWith('application/json')) {
        throw new Error('Send application/json.');
      }
      let body = '';
      for await (const chunk of request) {
        body += chunk;
        if (Buffer.byteLength(body) > 65536) throw new Error('Request too large.');
      }
      const call: Call = JSON.parse(body);
      id = call.id ?? null;
      if (call.jsonrpc !== '2.0') throw new Error('Expected JSON-RPC 2.0.');
      answer({ result: await handle(call) });
    } catch (error) {
      answer({ error: { code: -32602, message: messageOf(error) } });
    }
  });

  let closing: Promise<void> | undefined;
  async function close() {
    closing ??= (async () => {
      stopping = true;
      clearTimeout(retry);
      server.close();
      server.closeAllConnections();
      await reading?.catch(() => {});
      stopped.abort();
      resolveDone();
    })();
    return closing;
  }

  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', resolve);
    });
    const events = await fetch(`${game}/events`, { signal: stopped.signal });
    if (!events.ok || !events.body) throw new Error(`Cannot open game events: HTTP ${events.status}`);
    const body = events.body;
    const pump = async () => {
      for await (const chunk of body) {
        if (chunk.length) sync().catch(() => {});
      }
      throw new Error('The game event stream closed.');
    };
    pump().catch(async (error) => {
      if (stopping) return;
      rejectDone(error);
      await close();
    });
    return { address: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, sync, close, done };
  } catch (error) {
    await close();
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [game, channelKey, room, channel, port, roomKey] = process.argv.slice(2);
  if (!game || !channelKey || !room || !channel || !port || !roomKey) {
    console.error('Usage: node src/connector/index.ts <game-address> <channel-key> <room-address> <channel-name> <port> <room-channel-key>');
    process.exitCode = 1;
  } else {
    try {
      const connector = await startConnector({ game, channelKey, room, channel, roomKey, port: Number(port) });
      console.log(`Channel "${channel}" at ${connector.address}`);
      process.once('SIGINT', () => connector.close());
      process.once('SIGTERM', () => connector.close());
      await connector.done;
    } catch (error) {
      console.error(messageOf(error));
      process.exitCode = 1;
    }
  }
}
