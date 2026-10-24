import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod';
import type { Gen1Adapter } from './adapter.js';
import type { ToolResult } from '../tools.js';

export function createGen1Handlers(adapter: Gen1Adapter) {
  const run = async (action: () => unknown | Promise<unknown>): Promise<ToolResult> => {
    try { return { content: [{ type: 'text', text: JSON.stringify(await action(), null, 2) }] }; }
    catch (e) { return { isError: true, content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }] }; }
  };
  return {
    status: () => run(() => adapter.status()),
    list: () => run(() => adapter.listParams()),
    discover: () => run(() => adapter.discover()),
    connect: () => run(() => adapter.connect()),
    disconnect: () => run(() => adapter.disconnect()),
    read: ({ key, explicitResearch }: { key: string; explicitResearch?: boolean }) => run(() => adapter.read(key, explicitResearch)),
    set: ({ key, value }: { key: string; value: number }) => run(() => adapter.write(key, value)),
    tone: ({ name, outputLevel, dryRun }: { name: string; outputLevel?: number; dryRun?: boolean }) => run(() => adapter.applyTone(name, outputLevel, dryRun)),
  };
}

export function registerGen1Tools(server: McpServer, adapter: Gen1Adapter): void {
  const h = createGen1Handlers(adapter);
  server.registerTool('katana_gen1_status', { description: 'Experimental Gen 1 cached status and safety gates; no device I/O.' }, h.status);
  server.registerTool('katana_gen1_list_params', { description: 'List evidenced Gen 1 raw parameters and access restrictions; no device I/O.' }, h.list);
  server.registerTool('katana_gen1_discover', { description: 'Enumerate MIDI ports, without opening a port or sending inquiry. Requires hardware opt-in. Port name cannot prove model.' }, h.discover);
  server.registerTool('katana_gen1_connect', { description: 'Explicitly open a unique KATANA MIDI pair and verify observed identity; requires hardware and physical model confirmation. Close Tone Studio first.' }, h.connect);
  server.registerTool('katana_gen1_disconnect', { description: 'Close Gen 1 MIDI ports. Does not clear fault lock.' }, h.disconnect);
  server.registerTool('katana_gen1_read', {
    description: 'Read one evidenced Gen 1 raw parameter with strict DT1 validation. Not an atomic patch snapshot; no Gen 3 key conversion.',
    inputSchema: { key: z.string(), explicitResearch: z.boolean().optional() },
  }, h.read);
  server.registerTool('katana_gen1_set', {
    description: 'EXPERIMENTAL: write an allowlisted temporary DSP parameter with source-bounded raw value and strict readback. Requires write and low-MASTER opt-ins. TemporaryLevel ceiling 10; panel/system/patch save/firmware writes unavailable. Never auto-retries or rolls back.',
    inputSchema: { key: z.string(), value: z.number().int() },
  }, h.set);
  server.registerTool('katana_gen1_apply_tone', {
    description: 'Preview or apply experimental metal starting tone. Defaults to dryRun=true with zero I/O. Apply requires dryRun=false plus write/low-MASTER opt-ins. Pre-reads backup, reduces temporary LEVEL to 0, verifies each step, ends at min(previous LEVEL, outputLevel). Sequential; stops/locks on uncertainty, no automatic rollback or patch save. Raw DSP values differ from panel knobs.',
    inputSchema: { name: z.enum(['metal']), outputLevel: z.number().int().min(0).max(10).optional(), dryRun: z.boolean().optional() },
  }, h.tone);
}
