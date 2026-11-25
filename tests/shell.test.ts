import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { startShell, loadGame } from '../src/shell/server.ts';

// JSON answers are typed any: the assertions are what check their shape.
const request = async (shell: { address: string }, path: string, data?: object, key?: string): Promise<any> => {
  const response = await fetch(shell.address + path, {
    method: data === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json', ...(key && { authorization: `Bearer ${key}` }) },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    signal: AbortSignal.timeout(5000),
  });
  assert.ok(response.ok, `HTTP ${response.status}: ${path}`);
  return response.json();
};

test('the empty shell serves the page, chat, join and leave', async (t) => {
  const shell = await startShell();
  t.after(() => shell.close());
  assert.equal((await fetch(shell.address)).status, 200);
  assert.equal((await request(shell, '/snapshot')).game, null);

  const { player, key } = await request(shell, '/join', { name: 'Birch' });
  await request(shell, '/channel/send', { from: player.id, text: 'Hello' }, shell.channelKey);
  const { lines, cursor } = await request(shell, '/read');
  assert.equal(lines[0].text, 'Hello');
  assert.deepEqual((await request(shell, `/read?since=${cursor}`)).lines, []);
  assert.deepEqual((await request(shell, '/snapshot')).players.map(({ id, name }: { id: string; name: string }) => ({ id, name })), [player]);
  await request(shell, '/leave', {}, key);
  assert.deepEqual((await request(shell, '/snapshot')).players, []);
});

test('the shell loads a game and runs its steps until one fails', async (t) => {
  const folder = await mkdtemp(join(tmpdir(), 'shell-test-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  await writeFile(join(folder, 'game.ts'), `export default {
    title: 'Counter',
    rules: 'Each add raises the count by one.',
    actions: [{ name: 'add', description: 'add: raise the count by one.' }],
    create: () => ({ count: 0 }),
    act: (state, player, step) => step === 'add' ? (state.count++, { ok: true }) : { ok: false, message: 'Unknown step' },
    view: state => state,
  };`);
  const shell = await startShell(await loadGame(folder));
  t.after(() => shell.close());
  const joined = await request(shell, '/join', { name: 'Finch' });
  assert.equal(joined.actions[0].name, 'add');
  const acted = await request(shell, '/act', { steps: 'add; jump; add' }, joined.key);
  assert.deepEqual(acted.results.map((result: { ok: boolean }) => result.ok), [true, false]);
  assert.equal(acted.view.count, 1);
});

test('a game\'s TypeScript runs, and its public TypeScript reaches the browser as JavaScript', async (t) => {
  const folder = await mkdtemp(join(tmpdir(), 'shell-test-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  await writeFile(join(folder, 'game.ts'), `const title: string = 'Typed';
    export default { title, create: () => ({}), act: () => ({ ok: true }), view: (): object => ({}) };`);
  await mkdir(join(folder, 'public'));
  await writeFile(join(folder, 'public', 'scene.ts'), 'export const size: number = 2;');
  const shell = await startShell(await loadGame(folder));
  t.after(() => shell.close());
  assert.equal((await request(shell, '/snapshot')).game.title, 'Typed');
  const scene = await fetch(`${shell.address}/game/scene.ts`);
  assert.match(scene.headers.get('content-type') ?? '', /^text\/javascript/);
  assert.doesNotMatch(await scene.text(), /: number/);
});

test('options set on the page reach start; act answers when a step takes time, and stop ends the run before answering', async (t) => {
  const done: string[] = [];
  const shell = await startShell({
    title: 'Clock', create: () => ({ minutes: 0 }), view: state => state,
    options: [{ id: 'minutes', label: 'Minutes', type: 'slider', default: 5, min: 1, max: 9 }],
    start: (state: { minutes: number }, options) => { state.minutes = Number(options.minutes); },
    act: async (state, player, step) => {
      if (step === 'slow') await new Promise(resolve => setTimeout(resolve, 100));
      if (step === 'jam') return { ok: false, message: 'Jammed.' };
      done.push(step);
      return { ok: true };
    },
  });
  t.after(() => shell.close());
  await request(shell, '/options', { values: { minutes: 7 } });
  const refused = await fetch(`${shell.address}/options`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ values: { minutes: 99 } }) });
  assert.equal(refused.status, 400);
  await request(shell, '/start', {});
  assert.equal((await request(shell, '/snapshot')).view.minutes, 7);
  const { key } = await request(shell, '/join', { name: 'Oak' });
  const acted = await request(shell, '/act', { steps: 'slow; fast' }, key);
  assert.deepEqual([acted.results, acted.running], [[], ['slow', 'fast']], 'it answers before the slow step is done');
  const again = await fetch(`${shell.address}/act`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` }, body: JSON.stringify({ steps: 'fast' }) });
  assert.equal(again.status, 409, 'one act runs at a time');
  const stopped = await request(shell, '/stop', {}, key);
  assert.equal(stopped.message, 'Stopped: slow. Dropped: fast.', 'stop answers once the run has ended, with what became of it');
  assert.deepEqual(done, ['slow'], 'the step under way finishes; the rest are dropped');
  const next = await request(shell, '/act', { steps: 'slow; jam; fast' }, key);
  assert.deepEqual(next.running, ['slow', 'jam', 'fast'], 'an act straight after stop runs');
  await new Promise(resolve => setTimeout(resolve, 600));
  const texts = (await request(shell, '/snapshot', undefined, key)).events.map((event: { text: string }) => event.text);
  assert.deepEqual(texts, ['Failed: jam. Jammed. Dropped: fast.'], 'a failure after the answer is a reply, naming the steps dropped');
  const logged = (await request(shell, '/log?since=0')).events.map((event: { text: string }) => event.text);
  assert.ok(!logged.includes(texts[0]), 'a reply reaches only its player, not the log');
  await request(shell, '/act', { steps: 'slow; fast' }, key);
  await new Promise(resolve => setTimeout(resolve, 600));
  const finished = (await request(shell, '/snapshot', undefined, key)).events.map((event: { text: string }) => event.text);
  assert.deepEqual(finished, ['Your steps were done.'], 'steps still running at the answer reply when they all succeed');
});

test('a game starts and ends', async (t) => {
  const shell = await startShell({ title: 'Table', rules: '', actions: [], create: () => ({}), act: () => ({ ok: true }), view: () => ({}) });
  t.after(() => shell.close());
  await request(shell, '/join', { name: 'Wren' });
  assert.equal((await request(shell, '/snapshot')).status, 'waiting');
  assert.equal((await request(shell, '/start', {})).status, 'playing');
  assert.equal((await request(shell, '/end', {})).status, 'finished');
});

test('the start and end hooks run from the page buttons, and start may refuse', async (t) => {
  let open = false;
  const shell = await startShell({
    title: 'Gate', create: () => ({}), act: () => ({ ok: true }), view: () => ({}),
    start: () => open ? { events: ['Roles are dealt.'] } : { ok: false, message: 'Not enough players.' },
    end: () => ({ events: ['Roles were shown.'] }),
  });
  t.after(() => shell.close());
  const refused = await fetch(`${shell.address}/start`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(refused.status, 409);
  open = true;
  assert.equal((await request(shell, '/start', {})).status, 'playing');
  await request(shell, '/end', {});
  const { events } = await request(shell, '/log?since=0');
  assert.deepEqual(events.map((event: { text: string }) => event.text), ['The game has started.', 'Roles are dealt.', 'Roles were shown.', 'The game is over.']);
});

test('an event with to reaches only those players, while the log keeps it, with its data, for everyone', async (t) => {
  const shell = await startShell({
    title: 'Whisper', create: () => ({}), view: () => ({}),
    act: (state, player, step) => ({ ok: true, events: [{ text: `${player.name} nods.`, to: [step], data: { nod: player.name } }] }),
  });
  t.after(() => shell.close());
  const wren = await request(shell, '/join', { name: 'Wren' });
  const moss = await request(shell, '/join', { name: 'Moss' });
  const acted = await request(shell, '/act', { steps: wren.player.id }, wren.key);
  assert.ok(acted.events.some((event: { text: string }) => event.text === 'Wren nods.'));
  assert.ok(!(await request(shell, '/snapshot', undefined, moss.key)).events.some((event: { text: string }) => event.text === 'Wren nods.'));
  const logged = (await request(shell, '/log?since=0')).events.find((event: { text: string }) => event.text === 'Wren nods.');
  assert.deepEqual(logged?.data, { nod: 'Wren' });
});
