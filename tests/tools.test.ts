import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { startShell } from '../src/shell/server.ts';

const root = join(import.meta.dirname, '..');
const { name, version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));

for (const game of [null, { title: 'Table', rules: '', actions: [], create: () => ({}), act: () => ({ ok: true }), view: () => ({}) }]) {
  test(`the tools join, snapshot, act, ready and leave ${game ? 'a game' : 'the empty shell'}`, async (t) => {
    const shell = await startShell(game);
    t.after(() => shell.close());
    const client = new Client({ name, version });
    t.after(() => client.close());
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(root, 'src', 'tools', 'server.ts')] }));
    const call = async (tool: string, args = {}) => {
      const result = await client.callTool({ name: tool, arguments: args });
      const [first] = result.content as { type: string; text: string }[];
      return { isError: result.isError, value: JSON.parse(first?.text ?? 'null') };
    };

    const { tools } = await client.listTools();
    assert.deepEqual(tools.map(tool => tool.name).sort(), ['act', 'join', 'leave', 'ready', 'snapshot', 'stop']);
    const joined = await call('join', { address: shell.address, name: 'Checker' });
    assert.equal(joined.isError, false);
    assert.equal('key' in joined.value, false);
    assert.equal((await call('snapshot')).isError, false);
    assert.equal(typeof (await call('act', { steps: 'check' })).isError, 'boolean');
    if (game) assert.equal((await call('ready')).isError, false);
    assert.deepEqual((await call('leave')).value, { ok: true });
  });
}

test('registering takes out hooks an earlier checkout left, whatever their file, and keeps everyone else\'s', async () => {
  const { withoutOurHooks } = await import('../src/tools/harnesses.ts');
  const dir = '/x/a2a-games/src/tools';
  const hooks = withoutOurHooks({
    Stop: [
      { hooks: [{ command: `node "${dir}/hook.mjs" claude` }] },
      { hooks: [{ command: `node "${dir}/hook.ts" claude` }, { command: 'node /other/hook.ts' }] },
    ],
    PostToolUse: [{ hooks: [{ command: `node "${dir}/hook.mjs" claude tool` }] }],
  }, dir);
  assert.deepEqual(hooks, { Stop: [{ hooks: [{ command: 'node /other/hook.ts' }] }] });
});
