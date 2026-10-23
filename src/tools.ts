import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod';
import type { BtsClient } from './bts.js';
import { activeOnly, buildParams, CatalogError, describe, type Param, resolveChanges, SECTIONS } from './catalog.js';
import { BtsUnavailableError } from './cdp.js';
import { connectAndWait, type ConnectResult } from './connect.js';
import { CONTROLS, describeControls } from './controls.js';
import type { LaunchResult } from './launcher.js';

export interface ToolDeps {
  bts: BtsClient;
  launch(): Promise<LaunchResult>;
  /** Defaults to connectAndWait(bts). */
  connect?(): Promise<ConnectResult>;
}
export type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean };

const ok = (obj: unknown): ToolResult => ({ content: [{ type: 'text', text: JSON.stringify(obj, null, 2) }] });
const fail = (text: string): ToolResult => ({ isError: true, content: [{ type: 'text', text }] });
const COLOR = ['green', 'red', 'yellow'];

async function guard(fn: () => Promise<ToolResult>): Promise<ToolResult> {
  try { return await fn(); } catch (e) {
    if (e instanceof BtsUnavailableError || e instanceof CatalogError) return fail(e.message);
    throw e;
  }
}

export function createHandlers({ bts, launch, connect = () => connectAndWait(bts) }: ToolDeps) {
  async function params(): Promise<{ list: Param[]; connected: boolean; patchName: string; colors: number[] }> {
    const st = await bts.status();
    return { list: buildParams(await bts.index(), st.colors), ...st };
  }

  return {
    status: () => guard(async () => {
      const st = await bts.status();
      const names = ['booster', 'mod', 'fx', 'delay', 'reverb'];
      return ok({
        reachable: true,
        ampConnected: st.connected,
        patchName: st.patchName,
        activeVariation: Object.fromEntries(names.map((n, i) => [n, COLOR[st.colors[i]] ?? st.colors[i]])),
      });
    }),

    get: ({ sections }: { sections?: string[] }) => guard(async () => {
      const { list } = await params();
      const wanted = sections?.length ? list.filter(p => sections.includes(p.section)) : list;
      const values = await bts.read(wanted.map(p => p.pid));
      const shown = activeOnly(wanted, values); // only the selected MOD/FX type's details
      const out: Record<string, Record<string, unknown>> = {};
      for (const p of shown) (out[p.section] ??= {});
      for (const [k, v] of Object.entries(describe(shown, values))) out[k.split('.')[0]][k] = v;
      return ok(out);
    }),

    set: ({ changes }: { changes: Record<string, unknown> }) => guard(async () => {
      const { list, connected } = await params();
      const resolved = resolveChanges(list, changes); // throws before anything is written
      const back = await bts.write(resolved.map(({ pid, value }) => ({ pid, value })));
      const touched = list.filter(p => resolved.some(r => r.pid === p.pid));
      return ok({
        applied: describe(touched, back),
        warnings: connected ? [] : ['No KATANA is connected: BOSS TONE STUDIO shows the change, but the amp did not receive it.'],
      });
    }),

    listParams: ({ section }: { section: string }) => guard(async () => {
      const { list } = await params();
      return ok(list.filter(p => p.section === section)
        .map(({ key, min, max, options, boolean }) => ({ key, min, max, ...(options && { options }), ...(boolean && { boolean }) })));
    }),

    controls: () => guard(async () => {
      const st = await bts.status();
      const r = await bts.controls(CONTROLS.map(({ key, pid, elementId }) => ({ key, pid, elementId })));
      return ok(describeControls(r.readings, { gafc: r.gafc, connected: st.connected }));
    }),

    launch: () => guard(async () => {
      const r = await launch();
      if (!r.ok) return fail(r.message);
      return ok({ ...r, ...(await connect()) });
    }),

    connect: () => guard(async () => ok(await connect())),
  };
}

export function registerKatanaTools(server: McpServer, deps: ToolDeps): void {
  const h = createHandlers(deps);
  const section = z.enum(SECTIONS);

  server.registerTool('katana_status', {
    description: 'Check that BOSS TONE STUDIO is reachable, whether a KATANA Gen 3 is connected, the current patch name and which variation (green/red/yellow) each effect shows.',
  }, () => h.status());

  server.registerTool('katana_launch', {
    description: 'Open BOSS TONE STUDIO with the debug port if it is not open yet, connect it to the KATANA ' +
      '(answers the "Connect with" dialog) and wait until the amp patch is loaded.',
  }, () => h.launch());

  server.registerTool('katana_connect', {
    description: 'Connect an already open BOSS TONE STUDIO to the KATANA (e.g. after the amp was switched off and on) and wait until the amp patch is loaded.',
  }, () => h.connect());

  server.registerTool('katana_get', {
    description: 'Read the current tone from BOSS TONE STUDIO as friendly keys (amp.volume, booster.type, ...). Effects show the active variation.',
    inputSchema: { sections: z.array(section).optional().describe('Limit to these sections; omit for all') },
  }, args => h.get(args));

  server.registerTool('katana_set', {
    description: 'Set one or more parameters live (edit buffer, not saved to a patch). The BOSS TONE STUDIO UI updates immediately. ' +
      'Keys like amp.volume, amp.type ("LEAD"), booster.on (true/false), delay.time; use katana_list_params for ranges. All-or-nothing validation, no clamping.',
    inputSchema: { changes: z.record(z.string(), z.union([z.number(), z.string(), z.boolean()])).describe('{ "amp.volume": 12, "booster.type": "BLUES DRIVE" }') },
  }, args => h.set(args));

  server.registerTool('katana_list_params', {
    description: 'List the keys of one section with their ranges and option names (for MOD/FX this includes every effect type\'s detail parameters).',
    inputSchema: { section },
  }, args => h.listParams(args));

  server.registerTool('katana_controls', {
    description: 'Show what the footswitches and expression pedals do: the amp\'s FOOT SW (tip/ring) and EXP PEDAL jacks and the GA-FC / GA-FC EX ' +
      'switches and pedals for the current patch, plus the GA-FC global switch functions. Read-only. BOSS TONE STUDIO cannot detect which ' +
      'pedals are physically plugged in; these are the assignments.',
  }, () => h.controls());
}
