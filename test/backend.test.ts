import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { expect, it } from 'vitest';
import { registerBackend } from '../src/backend.js';
import { createHandlers } from '../src/tools.js';
import { McpServer as RealMcpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { MidiBackend } from '../src/gen1/adapter.js';

function registry() {
  const tools = new Map<string, (...args: any[]) => Promise<any>>();
  const server = { registerTool: (name: string, _config: unknown, handler: (...args: any[]) => Promise<any>) => tools.set(name, handler) } as unknown as McpServer;
  return { server, tools };
}
const neverMidi: MidiBackend = {
  list: async () => { throw new Error('Unexpected native MIDI access'); },
  open: async () => { throw new Error('Unexpected native MIDI access'); },
};

it('preserves all six Gen 3 tool names by default and exposes no Gen 1 writes', () => {
  const r = registry(); registerBackend(r.server, {}, neverMidi);
  expect([...r.tools.keys()]).toEqual(['katana_status', 'katana_launch', 'katana_connect', 'katana_get', 'katana_set', 'katana_list_params']);
});
it('selects isolated Gen 1 tools with hardware disabled unless explicitly opted in', async () => {
  const r = registry(); registerBackend(r.server, { KATANA_BACKEND: 'gen1' }, neverMidi);
  expect(r.tools.size).toBe(8);
  expect([...r.tools.keys()].every(k => k.startsWith('katana_gen1_'))).toBe(true);
  const status = JSON.parse((await r.tools.get('katana_gen1_status')!()).content[0].text);
  expect(status).toMatchObject({ hardwareEnabled: false, connected: false, writesEnabled: false });
  expect((await r.tools.get('katana_gen1_connect')!()).content[0].text).toContain('hardware disabled');
});
it('rejects misspelled backend without silently falling back to hardware', () => {
  expect(() => registerBackend(registry().server, { KATANA_BACKEND: 'genI' }, neverMidi)).toThrow('Unknown KATANA_BACKEND');
});
it('Gen 3 status and connect retain their handler contract with mocked BTS', async () => {
  const bts = {
    status: async () => ({ connected: true, patchName: 'GEN3', colors: [0, 1, 2, 0, 1] }),
    connect: async () => ({ started: false, already: true }),
    index: async () => [], read: async () => ({}), write: async () => ({}),
  };
  const h = createHandlers({ bts, launch: async () => ({ ok: true, message: 'unchanged' }) });
  expect(JSON.parse((await h.status()).content[0].text)).toMatchObject({ ampConnected: true, patchName: 'GEN3', activeVariation: { booster: 'green', mod: 'red', fx: 'yellow' } });
  expect(JSON.parse((await h.connect()).content[0].text)).toMatchObject({ ampConnected: true, patchName: 'GEN3' });
});

it('serves Gen 1 tools through the real MCP SDK with no hardware and validates input', async () => {
  const server = new RealMcpServer({ name: 'gen1-offline-test', version: '0' });
  registerBackend(server, { KATANA_BACKEND: 'gen1' }, neverMidi);
  const client = new Client({ name: 'test', version: '0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const listed = await client.listTools(); expect(listed.tools).toHaveLength(8);
    const result = await client.callTool({ name: 'katana_gen1_status', arguments: {} });
    expect(result.isError).not.toBe(true);
    const blocked = await client.callTool({ name: 'katana_gen1_connect', arguments: {} });
    expect(blocked.isError).toBe(true);
    const invalid = await client.callTool({ name: 'katana_gen1_set', arguments: { key: 'TemporaryGain', value: 95.5 } });
    expect(invalid.isError).toBe(true);
    const plan = await client.callTool({ name: 'katana_gen1_apply_tone', arguments: { name: 'metal' } });
    expect(JSON.parse((plan.content as { text: string }[])[0].text)).toMatchObject({ dryRun: true, deviceIO: false });
    const apply = await client.callTool({ name: 'katana_gen1_apply_tone', arguments: { name: 'metal', dryRun: false } });
    expect(apply.isError).toBe(true);
  } finally { await client.close(); await server.close(); }
});
