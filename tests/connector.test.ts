import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { startConnector } from '../src/connector/index.ts';
import { startShell } from '../src/shell/server.ts';

const EXTENSION = 'https://github.com/bytelabs-oss/agent-room';

// A stand-in room with agent-room's outside channel interface: a card with the room id, and PostMessage calls handed in
// with the channel's key.
interface Handed {
  parts: { text: string }[];
  metadata: Record<string, { to: string[]; from: { outsideId: string }; requiresResponse?: boolean }>;
}

function startRoom() {
  const handed: Handed[] = [];
  const server = createServer(async (request, response) => {
    const reply = (value: object) => response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(value));
    if (request.url === '/.well-known/agent-card.json') return reply({ capabilities: { extensions: [{ params: { roomId: 'room-1' } }] } });
    let body = '';
    for await (const chunk of request) body += chunk;
    const { id, method, params } = JSON.parse(body);
    if (method !== 'PostMessage' || request.headers.authorization !== 'Bearer room-key') return reply({ jsonrpc: '2.0', id, error: { message: 'Refused' } });
    handed.push(params.message);
    reply({ jsonrpc: '2.0', id, result: {} });
  });
  return new Promise<{ address: string; handed: Handed[]; server: typeof server }>(resolve => server.listen(0, '127.0.0.1', () => resolve({ address: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, handed, server })));
}

test('the connector carries game chat to and from a room, and nothing else', async (t) => {
  const shell = await startShell({ title: 'Table', rules: '', actions: [], create: () => ({}), act: () => ({ ok: true }), view: () => ({}) });
  t.after(() => shell.close());
  const room = await startRoom();
  t.after(() => room.server.close());
  const connector = await startConnector({ game: shell.address, channelKey: shell.channelKey, room: room.address, channel: 'table', roomKey: 'room-key' });
  t.after(() => connector.close());
  // JSON answers are typed any: the assertions are what check their shape.
  const request = async (path: string, body?: object, key?: string): Promise<any> => {
    const response = await fetch(shell.address + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'content-type': 'application/json', ...(key && { authorization: `Bearer ${key}` }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    assert.ok(response.ok, `HTTP ${response.status}: ${path}`);
    return response.json();
  };
  const call = async (method: string, params: object): Promise<any> => (await fetch(connector.address, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })).json();

  const birch = (await request('/join', { name: 'Birch' })).player;
  const finch = (await request('/join', { name: 'Finch' })).player;
  assert.deepEqual((await request('/snapshot')).players.map(({ id, name }: { id: string; name: string }) => ({ id, name })), [birch, finch]);
  assert.deepEqual((await call('ResolveIds', { roomId: 'room-1', agents: [{ agentId: 'agent-birch', name: 'Birch' }] })).result.ids, { 'agent-birch': birch.id });

  await request('/channel/send', { from: finch.id, text: 'Hello room', to: [birch.id] }, shell.channelKey);
  await connector.sync();
  assert.deepEqual(room.handed.map(message => message.parts[0].text), ['Hello room']);
  const chat = room.handed[0].metadata[EXTENSION];
  assert.deepEqual(chat.to, [birch.id]);
  assert.equal(chat.from.outsideId, finch.id);
  assert.equal(chat.requiresResponse, true);

  const message = {
    messageId: crypto.randomUUID(), contextId: 'room-1', role: 'ROLE_USER', parts: [{ text: 'Hello game' }],
    metadata: { [EXTENSION]: { where: { channel: 'channel-1' }, to: [], at: new Date().toISOString(), from: { agentId: 'agent-birch', name: 'Birch', outsideId: birch.id } } },
  };
  assert.deepEqual((await call('PostMessage', { message })).result, {});
  const line = (await request('/read')).lines.at(-1);
  assert.equal(line.text, 'Hello game');
  assert.equal(line.from.id, birch.id);
  await connector.sync();
  assert.equal(room.handed.some(handed => handed.parts[0].text === 'Hello game'), false);
});
