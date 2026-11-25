import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join, resolve, sep } from 'node:path';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { HTTPException } from 'hono/http-exception';
import { bearerAuth } from 'hono/bearer-auth';
import { streamSSE, type SSEStreamingApi } from 'hono/streaming';
import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { connect } from './controls.ts';
import type { EventEntry, Game, Outcome, PlayerRef, Setting, SettingValue } from './types.ts';

// A game as the shell runs it: the game's exports and the folder it was loaded from.
export type LoadedGame = Game & { root: string };

interface Player extends PlayerRef {
  key: string;
  ready: boolean;
  // The id of the last event this player has received.
  eventCursor: number;
  stream?: SSEStreamingApi | null;
  // The player's act while its steps run.
  run?: Run;
  // Replies to this player's own steps that they have not received yet.
  replies: StoredEvent[];
}

// One act's steps as they run: those still to finish, the one under way first; whether the player asked to stop; and
// what became of them, in words, once the run has ended.
interface Run {
  left: string[];
  stopping: boolean;
  ended: Promise<string>;
}

interface StoredEvent {
  id: number;
  text: string;
  by: string | null;
  at: string;
  headline?: true;
  to?: string[];
  data?: unknown;
  // A reply to the player's own step, which only that player receives. It is not in the log or on the page.
  reply?: true;
}

interface Line {
  id: number;
  from: PlayerRef;
  text: string;
  to: string[];
  tags: PlayerRef[];
  at: string;
}

const pageRoot = fileURLToPath(new URL('./web/dist/', import.meta.url));
const threeRoot = fileURLToPath(new URL('../', import.meta.resolve('three')));
const stepPause = 250;
const fail = (status: ContentfulStatusCode, message: string) => new HTTPException(status, { message });
const length = (text: string) => [...text].length;
const sameName = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const pause = (ms: number) => new Promise(done => setTimeout(done, ms));

// A request that fails its schema answers 400 with the given message, or the schema's own.
const valid = <Target extends 'json' | 'query', Schema extends z.ZodType>(target: Target, schema: Schema, message?: string) => zValidator(target, schema, result => {
  if (!result.success) throw fail(400, message ?? result.error.issues[0]?.message ?? 'Invalid request');
});
const nameSchema = z.object({
  name: z.string().regex(/^\S+$/u).refine(name => length(name) <= 50),
});
const stepsSchema = z.object({ steps: z.string().trim().min(1) });
const cursorSchema = z.object({ since: z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0) });
const optionsSchema = z.object({ values: z.record(z.string(), z.union([z.boolean(), z.number(), z.string()])) });
// Whether a value fits an option: the right type, within a slider's range, or one of a choice's values.
const fits = (option: Setting, value: SettingValue) =>
  option.type === 'switch' ? typeof value === 'boolean'
  : option.type === 'slider' ? typeof value === 'number' && value >= (option.min ?? -Infinity) && value <= (option.max ?? Infinity)
  : typeof value === 'string' && (option.options ?? []).some(choice => choice.value === value);
const lineSchema = z.object({
  from: z.string('That player is not in the game'),
  text: z.string().trim().min(1, 'Message must be 1 to 300 characters')
    .refine(text => length(text) <= 300, 'Message must be 1 to 300 characters'),
  to: z.array(z.string(), 'Unknown recipient').default([]),
});

// A game is its folder's game.ts, which Node runs by stripping its types.
const gameFile = 'game.ts';

export async function loadGame(folder: string): Promise<LoadedGame> {
  const root = resolve(folder) + sep;
  const { default: game } = await import(pathToFileURL(`${root}${gameFile}`).href);
  for (const name of ['create', 'act', 'view']) {
    if (typeof game?.[name] !== 'function') throw new Error(`${root}${gameFile} must export ${name}()`);
  }
  if (typeof game.title !== 'string' || !game.title) throw new Error(`${root}${gameFile} must export a title`);
  return { ...game, root };
}

export async function startShell(game: (Game & { root?: string }) | null = null) {
  const players = new Map<string, Player>();
  const sessions = new Map<string, Player>();
  const observers = new Set<SSEStreamingApi>();
  const lines: Line[] = [];
  const events: StoredEvent[] = [];
  const channelKey = randomUUID();
  let status: 'waiting' | 'playing' | 'finished' | null = game ? 'waiting' : null;
  // The id of the latest event or reply. Both are numbered from it, so a player's cursor covers both.
  let lastId = 0;
  let gameStart = 0;
  let state: unknown;
  let address = '';
  // Game code runs outside requests too (ticks, closed streams), so its errors are logged, not fatal.
  const safely = <T>(label: string, run: () => T): T | undefined => {
    try {
      return run();
    } catch (error) {
      console.error(`Game error in ${label}:`, error);
    }
  };
  const asset = (file?: string) => file && `/game/${file}`;
  const info = game && {
    title: game.title,
    theme: game.theme ?? null,
    settings: game.settings ?? [],
    background: asset(game.background),
    music: asset(game.music),
    sounds: Object.fromEntries(Object.entries(game.sounds ?? {}).map(([name, file]) => [name, asset(file)])),
    scene: asset(game.scene ?? 'scene.ts'),
    options: game.options ?? [],
  };
  const open = (stream?: SSEStreamingApi | null): stream is SSEStreamingApi => Boolean(stream && !stream.closed && !stream.aborted);
  const roster = () => [...players.values()].map(({ id, name, ready, stream }) => ({ id, name, ready, connected: Boolean(open(stream)) }));
  // The game's options, set on the page while it is not playing, start at their defaults.
  const options: Record<string, SettingValue> = Object.fromEntries((game?.options ?? []).map(option => [option.id, option.default]));
  const snapshot = (playerId: string | null = null) => ({
    game: info, status, options, players: roster(),
    view: game ? safely('view', () => game.view(state, playerId)) ?? null : null, address,
  });
  const streams = (): [SSEStreamingApi | null | undefined, string | null][] => [...[...observers].map(stream => [stream, null] as [SSEStreamingApi, null]), ...[...players.values()].map(p => [p.stream, p.id] as [SSEStreamingApi | null | undefined, string])];
  const finishers = new WeakMap<SSEStreamingApi, () => void>();
  const end = (stream?: SSEStreamingApi | null) => stream && finishers.get(stream)?.();
  const send = (stream: SSEStreamingApi | null | undefined, event: string, value: unknown) => {
    if (open(stream)) stream.writeSSE({ event, data: JSON.stringify(value) });
  };
  const broadcast = (event: string, value: unknown) => {
    for (const [stream] of streams()) send(stream, event, value);
  };
  const broadcastState = () => {
    for (const [stream, id] of streams()) send(stream, 'state', snapshot(id));
  };
  // `by` is the player whose join, leave or act caused the event, or null.
  // An entry is a string, or {text, headline, to, data}: headline marks an announcement, to lists the players whose
  // agents receive it, and data is the game's own details, passed on as they are. Without to, every player does. The
  // page and the log always see every event.
  const reaches = (event: StoredEvent, id: string | null) => id === null || !event.to || event.to.includes(id);
  const record = (entry: EventEntry, { by = null }: { by?: string | null } = {}) => {
    const details = typeof entry === 'string' ? { text: entry } : entry;
    const event: StoredEvent = {
      id: ++lastId,
      text: String(details?.text ?? '').slice(0, 300),
      by,
      at: new Date().toISOString(),
      ...(details?.headline === true && { headline: true as const }),
      ...(Array.isArray(details?.to) && { to: details.to }),
      ...(details?.data !== undefined && { data: details.data }),
    };
    events.push(event);
    for (const [stream, id] of streams()) if (reaches(event, id)) send(stream, 'event', event);
  };
  const eventsFor = (player: Player) => {
    const fresh = [...events.filter(event => event.id > player.eventCursor && reaches(event, player.id)), ...player.replies.splice(0)]
      .sort((a, b) => a.id - b.id);
    player.eventCursor = lastId;
    return fresh;
  };
  // startGame() and endGame() run inside a hook, so their events wait until the hook's own events are recorded.
  const pending: EventEntry[] = [];
  const flush = () => {
    for (const text of pending.splice(0)) record(text);
  };
  // A hook may return events to record and a sound to play.
  const apply = (outcome: Outcome | null | void | undefined, source?: { by: string }) => {
    for (const entry of outcome?.events ?? []) record(entry, source);
    flush();
    if (outcome?.sound) broadcast('sound', { name: outcome.sound });
  };
  // The game's optional start and end hooks run whichever way the game starts or ends: from a game hook or from
  // the page's buttons. start may refuse with {ok: false, message}; both may return events.
  const controls = {
    startGame(): Outcome & { ok: boolean } {
      if (!game || status === 'playing') return { ok: false, message: 'The game is already playing.' };
      const outcome = safely('start', () => game.start?.(state, { ...options }));
      if (outcome?.ok === false) return { ...outcome, ok: false };
      status = 'playing';
      pending.push('The game has started.', ...(outcome?.events ?? []));
      return { ok: true };
    },
    endGame(): Outcome & { ok: boolean } {
      if (status !== 'playing') return { ok: false, message: 'The game is not playing.' };
      const outcome = game && safely('end', () => game.end?.(state));
      status = 'finished';
      pending.push(...(outcome?.events ?? []), 'The game is over.');
      return { ok: true };
    },
  };
  connect(controls);
  const newGame = () => {
    state = game?.create();
    status = game ? 'waiting' : null;
    for (const player of players.values()) player.ready = false;
    // Players who join from now on receive events from this game only.
    gameStart = lastId;
  };
  newGame();
  // Clients such as Node's fetch drop a stream that stays silent for five minutes.
  const heartbeat = setInterval(() => {
    for (const [stream] of streams()) if (open(stream)) stream.write(': ping\n\n');
  }, 15000);
  // A tick that returns nothing changed nothing, so nothing is sent.
  const tickSeconds = game?.tickSeconds ?? 1;
  const ticker = game?.tick && setInterval(() => {
    if (status !== 'playing') return;
    const outcome = safely('tick', () => game.tick?.(state, tickSeconds));
    if (!outcome) return;
    apply(outcome);
    broadcastState();
  }, tickSeconds * 1000);
  const remove = (player: Player) => {
    if (!players.delete(player.id)) return;
    sessions.delete(player.key);
    end(player.stream);
    if (game) {
      record(`${player.name} left.`, { by: player.id });
      apply(safely('leave', () => game.leave?.(state, { id: player.id, name: player.name })), { by: player.id });
      // An empty game starts over, so the next players get a fresh one.
      if (!players.size && status !== 'waiting') {
        record('Everyone left. A new game is waiting for players.');
        newGame();
      }
    }
    broadcastState();
  };
  const addLine = ({ text, to }: { text: string; to: string[] }, from: PlayerRef) => {
    if (to.some(id => !players.has(id))) throw fail(400, 'Unknown recipient');
    const tagged = [...new Set(to)];
    const line: Line = {
      id: (lines.at(-1)?.id ?? 0) + 1,
      from, text, to: tagged,
      tags: tagged.map(id => ({ id, name: players.get(id)?.name ?? '' })),
      at: new Date().toISOString(),
    };
    lines.push(line);
    broadcast('chat', line);
    return line;
  };
  // Runs a player's steps in order, stopping at the first that fails, when the game ends, or when they stop. The
  // answer comes back once they are all done, or as soon as a step takes time, with the steps finished so far and those
  // still to run. The steps still to run are taken as done: nothing is said when one succeeds. A step that fails is a
  // reply to this player alone, naming the steps dropped; a stop is answered by stop itself, once the run has ended.
  const runSteps = (game: Game, player: Player, steps: string) => new Promise<object>(answer => {
    const results: { step: string; ok: boolean; message: string }[] = [];
    const queue = steps.split(';').map(part => part.trim()).filter(Boolean);
    let end = (_what: string) => {};
    const run: Run = { left: [...queue], stopping: false, ended: new Promise(settle => { end = settle; }) };
    player.run = run;
    let answered = false;
    const reply = () => {
      if (answered) return;
      answered = true;
      answer({ results, running: run.left, status, view: game.view(state, player.id), events: eventsFor(player) });
    };
    // After the answer, a failure is a reply to this player alone, numbered in turn with the events.
    const report = (text: string) => {
      if (!answered) return;
      const said: StoredEvent = { id: ++lastId, text: text.slice(0, 300), by: null, at: new Date().toISOString(), reply: true };
      player.replies.push(said);
      send(player.stream, 'event', said);
    };
    (async () => {
      let what = 'Your steps were done.';
      for (const [index, step] of queue.entries()) {
        if (index) await pause(stepPause);
        if (!players.has(player.id)) break;
        if (run.stopping) {
          what = `Stopped. Dropped: ${run.left.join('; ')}.`;
          break;
        }
        const before: typeof status = status;
        let outcome: Outcome;
        try {
          const acting = game.act(state, { id: player.id, name: player.name }, step);
          if (acting instanceof Promise) reply();
          outcome = (await acting) ?? { ok: true };
        } catch (error) {
          console.error('Game error in act:', error);
          outcome = { ok: false, message: 'The game failed while running this step.' };
        }
        run.left = queue.slice(index + 1);
        const done = { step, ok: outcome.ok !== false, message: outcome.message ?? '' };
        results.push(done);
        const dropped = run.left.length ? `Dropped: ${run.left.join('; ')}.` : '';
        if (run.stopping || !done.ok) {
          what = [`${run.stopping ? 'Stopped' : 'Failed'}: ${step}.`, done.message, dropped].filter(Boolean).join(' ');
          if (!run.stopping) report(what);
        }
        apply(outcome, { by: player.id });
        broadcastState();
        // Stop when asked, on a refused step, or when this step ended the game.
        if (run.stopping || !done.ok || (status === 'finished' && before !== 'finished')) break;
      }
      run.left = [];
      if (player.run === run) player.run = undefined;
      end(what);
      reply();
    })();
  });

  const app = new Hono();
  const key = (c: Context) => c.req.header('authorization')?.replace(/^Bearer /, '');
  const player = (c: Context) => {
    const found = sessions.get(key(c) ?? '');
    if (key(c) && !found) throw fail(401, 'Invalid session');
    return found;
  };
  const requirePlayer = (c: Context) => {
    const found = player(c);
    if (!found) throw fail(401, 'Join first');
    return found;
  };

  app.use('*', bodyLimit({ maxSize: 16 * 1024, onError: () => { throw fail(413, 'Request too large'); } }));
  app.onError((error, c) => {
    if (error instanceof HTTPException) return error.res ? error.getResponse() : c.json({ error: error.message }, error.status);
    console.error(error);
    return c.json({ error: 'Server error' }, 500);
  });
  app.notFound(c => c.json({ error: 'Not found' }, 404));

  app.post('/join', valid('json', nameSchema, 'A name is one word of 1 to 50 characters, with no spaces'), c => {
    const { name } = c.req.valid('json');
    const taken = [...players.values()].find(player => sameName(player.name, name));
    // A disconnected player takes their seat back by joining with the same name.
    if (taken && !open(taken.stream)) {
      sessions.delete(taken.key);
      taken.key = randomUUID();
      sessions.set(taken.key, taken);
      return c.json({
        player: { id: taken.id, name: taken.name }, key: taken.key,
        rules: game?.rules ?? '', actions: game?.actions ?? [], status, address,
      });
    }
    if (taken) throw fail(409, 'That name is already taken in this game');
    const joined: Player = { id: randomUUID(), key: randomUUID(), name, ready: false, eventCursor: gameStart, replies: [] };
    const outcome = game?.join?.(state, { id: joined.id, name: joined.name });
    if (outcome?.ok === false) throw fail(409, outcome.message || 'The game refused this player');
    players.set(joined.id, joined);
    sessions.set(joined.key, joined);
    if (game) {
      record(`${name} joined.`, { by: joined.id });
      apply(outcome, { by: joined.id });
    }
    broadcastState();
    return c.json({
      player: { id: joined.id, name: joined.name }, key: joined.key,
      rules: game?.rules ?? '', actions: game?.actions ?? [], status, address,
    });
  });
  app.get('/snapshot', c => {
    const current = player(c);
    return c.json(current ? { ...snapshot(current.id), running: current.run?.left ?? [], events: eventsFor(current) } : snapshot());
  });
  app.get('/log', valid('query', cursorSchema, 'Invalid cursor'), c => {
    const { since } = c.req.valid('query');
    return c.json({ events: events.filter(event => event.id > since), cursor: events.at(-1)?.id ?? 0 });
  });
  app.get('/players/lookup', c => {
    const name = c.req.query('name');
    if (!name?.trim()) throw fail(400, 'Give a name to look up');
    const found = [...players.values()].find(current => sameName(current.name, name));
    if (!found) throw fail(404, 'No player with that name');
    return c.json({ player: { id: found.id, name: found.name } });
  });
  app.post('/act', valid('json', stepsSchema, 'Steps must be text, separated by ;'), async c => {
    const current = requirePlayer(c);
    const { steps } = c.req.valid('json');
    if (!game) throw fail(409, 'No game loaded');
    if (current.run) throw fail(409, `Your steps are still running: ${current.run.left.join('; ')}. Call stop to stop them.`);
    return c.json(await runSteps(game, current, steps));
  });
  // Stops the player's running steps: the one under way ends where it is, and the rest are dropped. It answers once the
  // run has ended, with what became of it, so the player's next act never overlaps it.
  app.post('/stop', async c => {
    const current = requirePlayer(c);
    const run = current.run;
    if (!run) return c.json({ ok: true, message: 'No steps are running.' });
    run.stopping = true;
    if (game?.stop) safely('stop', () => game.stop?.(state, { id: current.id, name: current.name }));
    return c.json({ ok: true, message: await run.ended });
  });
  app.post('/ready', c => {
    const current = requirePlayer(c);
    if (!game) throw fail(409, 'No game loaded');
    if (!current.ready) {
      current.ready = true;
      record(`${current.name} is ready.`, { by: current.id });
      apply(safely('ready', () => game.ready?.(state, { id: current.id, name: current.name })), { by: current.id });
      broadcastState();
    }
    return c.json({ ok: true });
  });
  // The page's Start Game and End Game buttons. They take no key because the shell only listens on 127.0.0.1.
  app.post('/start', c => {
    const outcome = controls.startGame();
    if (!outcome.ok && status !== 'playing') throw fail(409, outcome.message ?? 'The game did not start');
    flush();
    broadcastState();
    return c.json({ status });
  });
  // The page sets the game's options before it starts. Like the buttons, this takes no key.
  app.post('/options', valid('json', optionsSchema, 'Options are values by option id'), c => {
    if (status === 'playing') throw fail(409, 'Options are set before the game starts');
    const { values } = c.req.valid('json');
    for (const [id, value] of Object.entries(values)) {
      const option = game?.options?.find(each => each.id === id);
      if (!option || !fits(option, value)) throw fail(400, `${id} is not an option, or ${value} does not fit it`);
    }
    Object.assign(options, values);
    broadcastState();
    return c.json({ options });
  });
  app.post('/end', c => {
    controls.endGame();
    flush();
    broadcastState();
    return c.json({ status });
  });
  app.post('/leave', c => {
    const given = key(c);
    if (given && !sessions.has(given)) return c.json({ ok: true });
    remove(requirePlayer(c));
    return c.json({ ok: true });
  });
  app.get('/read', valid('query', cursorSchema, 'Invalid cursor'), c => {
    const { since } = c.req.valid('query');
    return c.json({ lines: lines.filter(line => line.id > since), cursor: lines.at(-1)?.id ?? 0, players: roster() });
  });
  const refused = { message: { error: 'Invalid channel key' } };
  const channelAuth = bearerAuth({ token: channelKey, noAuthenticationHeader: refused, invalidAuthenticationHeader: refused, invalidToken: refused });
  app.post('/channel/send', channelAuth, valid('json', lineSchema), c => {
    const { from, text, to } = c.req.valid('json');
    const sender = players.get(from);
    if (!sender) throw fail(409, 'That player is not in the game');
    return c.json({ line: addLine({ text, to }, { id: sender.id, name: sender.name }) });
  });
  app.get('/events', c => {
    const current = player(c);
    return streamSSE(c, async stream => {
      if (current) {
        const previous = current.stream;
        current.stream = stream;
        end(previous);
      } else observers.add(stream);
      if (current) broadcastState();
      else await stream.writeSSE({ event: 'state', data: JSON.stringify(snapshot()) });
      // Hold the stream open until the client goes away or the shell ends it.
      await new Promise<void>(done => {
        finishers.set(stream, done);
        stream.onAbort(done);
      });
      observers.delete(stream);
      // A dropped player stays in the game, shown as disconnected, until they reconnect or leave.
      if (current?.stream === stream) {
        current.stream = null;
        broadcastState();
      }
    });
  });
  // Only the game's public/ folder reaches the browser; the game file and its other files stay on the server. The
  // browser checks each file again on every load, so a changed scene or model shows at once. A TypeScript file is
  // sent as JavaScript, its types stripped as Node strips them.
  if (game?.root && existsSync(`${game.root}public`)) {
    const publicRoot = `${game.root}public${sep}`;
    app.get('/game/*', async (c, next) => {
      const file = resolve(publicRoot, `.${c.req.path.slice('/game'.length)}`);
      if (!file.endsWith('.ts') || !file.startsWith(publicRoot) || !existsSync(file)) return next();
      const code = stripTypeScriptTypes(await readFile(file, 'utf8'));
      return c.body(code, 200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-cache' });
    });
    app.use('/game/*', serveStatic({
      root: publicRoot,
      rewriteRequestPath: path => path.slice('/game'.length),
      onFound: (path, c) => c.header('Cache-Control', 'no-cache'),
    }));
  }
  for (const folder of ['build', 'examples/jsm']) {
    app.use(`/vendor/three/${folder}/*`, serveStatic({
      root: resolve(threeRoot, folder),
      rewriteRequestPath: path => path.slice(`/vendor/three/${folder}`.length),
    }));
  }
  // The page's index.html must not be cached, so a rebuilt page shows on the next load; its assets have hashed names.
  app.use('/*', serveStatic({
    root: pageRoot,
    onFound: (path, c) => {
      if (path.endsWith('.html')) c.header('Cache-Control', 'no-cache');
    },
  }));

  // With no server of its own given, serve makes a plain HTTP server.
  const server = await new Promise<Server>(started => {
    const instance = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 }, () => started(instance as Server));
  });
  address = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    address,
    channelKey,
    close: async () => {
      clearInterval(heartbeat);
      if (ticker) clearInterval(ticker);
      for (const stream of observers) end(stream);
      for (const current of [...players.values()]) remove(current);
      server.closeAllConnections();
      await new Promise<void>((done, failed) => server.close(error => error ? failed(error) : done()));
    },
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const name = process.argv[2];
  let game = null;
  if (name) {
    const folder = resolve('games', name);
    if (!existsSync(join(folder, gameFile))) {
      console.error(`No game called ${name}. Games live in games/<name>/${gameFile}.`);
      process.exit(1);
    }
    game = await loadGame(folder);
  }
  const shell = await startShell(game);
  console.log(shell.address);
  console.log(`channel key: ${shell.channelKey}`);
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => {
    await shell.close();
    process.exit(0);
  });
}
