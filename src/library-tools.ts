import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod';
import { BtsUnavailableError } from './cdp.js';
import { type LibraryClient, LibraryError, type PatchesInfo, type SlotInfo } from './library.js';
import { checkName, isEmptyPatchName, PATCH_NAME_MAX } from './library-refs.js';
import { parseSlot, slotName } from './slots.js';

export interface LibraryToolDeps {
  lib: LibraryClient;
  /** Home folder for the default .tsl location; tests pass a temp dir. */
  home?: string;
}
type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean };

const ok = (obj: unknown): ToolResult => ({ content: [{ type: 'text', text: JSON.stringify(obj, null, 2) }] });
const fail = (text: string): ToolResult => ({ isError: true, content: [{ type: 'text', text }] });
const ASK = 'Ask the user, then call again with overwrite: true.';

async function guard(fn: () => Promise<ToolResult>): Promise<ToolResult> {
  try { return await fn(); } catch (e) {
    if (e instanceof BtsUnavailableError || e instanceof LibraryError) return fail(e.message);
    throw e;
  }
}

export function createLibraryHandlers({ lib }: LibraryToolDeps) {
  async function ampPatches(): Promise<PatchesInfo> {
    const p = await lib.patches();
    if (!p.connected) throw new LibraryError('No KATANA is connected. Connect it with katana_connect first.');
    return p;
  }

  function existingSlot(p: PatchesInfo, slot: string): SlotInfo {
    const row = parseSlot(slot);
    const s = p.slots[row];
    if (!s?.exists) {
      const valid = p.slots.filter(x => x.exists).map(x => slotName(x.row)).join(', ');
      throw new LibraryError(`${p.model} has no slot ${slotName(row)}; valid: ${valid}.`);
    }
    return s;
  }

  return {
    listPatches: () => guard(async () => {
      const p = await ampPatches();
      return ok({
        model: p.model,
        current: slotName(p.current),
        slots: p.slots.filter(s => s.exists).map(s => ({ slot: slotName(s.row), name: s.name, empty: isEmptyPatchName(s.name) })),
      });
    }),

    selectPatch: ({ slot }: { slot: string }) => guard(async () => {
      const s = existingSlot(await ampPatches(), slot);
      const r = await lib.selectPatch(s.row);
      return ok({ current: slotName(r.current), name: r.name });
    }),

    write: ({ slot, name, overwrite }: { slot: string; name: string; overwrite?: boolean }) => guard(async () => {
      const n = checkName(name, PATCH_NAME_MAX, 'patch');
      const s = existingSlot(await ampPatches(), slot);
      const empty = isEmptyPatchName(s.name);
      if (!empty && overwrite !== true) throw new LibraryError(`${slotName(s.row)} holds "${s.name}". ${ASK}`);
      await lib.writePatch(s.row, n);
      return ok({ slot: slotName(s.row), name: n, replaced: empty ? null : s.name });
    }),
  };
}

export function registerLibraryTools(server: McpServer, deps: LibraryToolDeps): void {
  const h = createLibraryHandlers(deps);
  const slot = z.string().describe('PANEL, A1..A4 or B1..B4 (A:CH1 style also accepted)');

  server.registerTool('katana_list_patches', {
    description: 'List the patches stored on the KATANA (PANEL, A1..B4) with their names, which are empty, and the selected slot.',
  }, () => h.listPatches());

  server.registerTool('katana_select_patch', {
    description: 'Switch the KATANA to a stored patch slot (like pressing a channel button).',
    inputSchema: { slot },
  }, args => h.selectPatch(args));

  server.registerTool('katana_write', {
    description: 'Save the current tone (edit buffer) to a patch slot on the KATANA under a name (max 16 ASCII chars), like the WRITE button. ' +
      'Refuses a slot that already holds a patch unless overwrite is true: ask the user first.',
    inputSchema: {
      slot,
      name: z.string().describe('Patch name, max 16 ASCII characters'),
      overwrite: z.boolean().optional().describe('Only after the user agreed to replace the stored patch'),
    },
  }, args => h.write(args));
}
