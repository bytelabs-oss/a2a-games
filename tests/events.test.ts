import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { startShell } from '../src/shell/server.ts';

const tools = join(import.meta.dirname, '..', 'src', 'tools');

test('game events reach an agent through its harness hooks and wake it when idle', async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'events-test-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const env = { ...process.env, HOME: home, COPILOT_AGENT_SESSION_ID: 'session-1' };
  const shell = await startShell({
    title: 'Ping', rules: '', actions: [{ name: 'ping', description: 'ping: say ping.' }],
    create: () => ({}), act: (state, player) => ({ ok: true, events: [{ text: `${player.name} pinged.`, headline: true }] }), view: () => ({}),
  });
  t.after(() => shell.close());
  const client = new Client({ name: 'github/cli', version: '1.0.0' });
  t.after(() => client.close());
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(tools, 'server.ts')], env }));
  await client.callTool({ name: 'join', arguments: { address: shell.address, name: 'Oak' } });

  const hook = (...args: string[]) => new Promise<string>((resolve) => {
    const child = spawn(process.execPath, [join(tools, 'hook.ts'), 'copilot', ...args], { env });
    let out = '';
    child.stdout.on('data', (chunk) => { out += chunk; });
    child.on('close', () => resolve(out.trim()));
    child.stdin.end(JSON.stringify({ session_id: 'session-1' }));
  });
  // JSON answers are typed any: the assertions are what check their shape.
  const post = async (path: string, body: object, key?: string): Promise<any> => (await fetch(shell.address + path, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` }, body: JSON.stringify(body),
  })).json();

  const elm = await post('/join', { name: 'Elm' });
  await post('/act', { steps: 'ping' }, elm.key);
  assert.match(JSON.parse(await hook('tool')).additionalContext, /Elm pinged\./);
  assert.equal(await hook(), '');

  const sessions = join(home, '.a2a-games', 'sessions');
  const { port } = JSON.parse(await readFile(join(sessions, (await readdir(sessions))[0]), 'utf8'));
  const woken: Promise<any> = fetch(`http://127.0.0.1:${port}/listen`, { method: 'POST' }).then((response) => response.json());
  await post('/act', { steps: 'ping' }, elm.key);
  assert.match((await woken).prompt, /the game you are playing as "Oak", announces: Elm pinged\./, 'an announcement wakes an idle session, and the wake-up carries it');
  assert.equal(await hook('tool'), '', 'a hook does not tell the session again of what a wake-up carried');
});

test('news handed over after a tool that ends the turn is handed over again when the turn ends, and after any other tool it is not', async () => {
  const turn = await import('../src/tools/turn.ts');
  turn.reset();
  const yourTurn = { id: 7, text: "Hazel's turn.", by: 'alder' };
  turn.heard(yourTurn, 'hazel');
  turn.active();
  turn.handed([yourTurn], true);
  assert.equal(turn.waiting(), false);
  turn.ended();
  assert.equal(turn.waiting(), true, 'the agent never read it, so it waits for a wake-up');
  turn.active();
  turn.handed([yourTurn], false);
  turn.ended();
  assert.equal(turn.waiting(), false, 'the agent read it in the tool result, so the turn ending hands nothing over again');
});
