import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod';
import { BtsUnavailableError } from './cdp.js';
import { type LibraryClient, LibraryError, type LivesetInfo, type PatchesInfo, type SlotInfo } from './library.js';
import {
  checkName, findRef, isEmptyPatchName, isNumberRef, LIVESET_NAME_MAX, MAX_PATCHES, PATCH_NAME_MAX, type Ref, resolveRef,
} from './library-refs.js';
import { readTsl, resolveTslPath, writeTsl } from './tsl-file.js';
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

export function createLibraryHandlers({ lib, home }: LibraryToolDeps) {
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

  function transferableSlot(p: PatchesInfo, slot: string): SlotInfo {
    const s = existingSlot(p, slot);
    if (!s.transferable) throw new LibraryError('PANEL cannot receive liveset patches; use A1 or later (katana_write can save to PANEL).');
    return s;
  }

  async function liveset(ref: Ref): Promise<{ index: number; info: LivesetInfo }> {
    const list = await lib.livesets();
    const index = resolveRef(list.map(l => l.name), ref, 'liveset');
    return { index, info: list[index] };
  }

  /**
   * An existing liveset, or a new one when `ref` is a name nobody has. `create()` is
   * lazy so callers can validate (e.g. the 15-patch cap) against `info`/`created`
   * before anything is actually created.
   */
  async function livesetOrNew(ref: Ref): Promise<{ info: LivesetInfo; created: boolean; create: () => Promise<number> }> {
    const list = await lib.livesets();
    const found = findRef(list.map(l => l.name), ref, 'liveset');
    if (found !== undefined) return { info: list[found], created: false, create: async () => found };
    const name = checkName(String(ref), LIVESET_NAME_MAX, 'liveset');
    return { info: { id: -1, name, patches: [] }, created: true, create: () => lib.createLiveset(name) };
  }

  const patchRef = (info: LivesetInfo, ref: Ref) => resolveRef(info.patches, ref, `patch in "${info.name}"`);

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

    livesetList: () => guard(async () =>
      ok((await lib.livesets()).map((l, i) => ({ liveset: i + 1, name: l.name, patches: l.patches })))),

    livesetCreate: ({ name }: { name: string }) => guard(async () => {
      const n = checkName(name, LIVESET_NAME_MAX, 'liveset');
      return ok({ liveset: (await lib.createLiveset(n)) + 1, name: n });
    }),

    livesetRename: ({ liveset: ref, name }: { liveset: Ref; name: string }) => guard(async () => {
      const n = checkName(name, LIVESET_NAME_MAX, 'liveset');
      const { index } = await liveset(ref);
      await lib.renameLiveset(index, n);
      return ok({ liveset: index + 1, name: n });
    }),

    livesetDelete: ({ liveset: ref }: { liveset: Ref }) => guard(async () => {
      if (isNumberRef(ref)) {
        throw new LibraryError("Deleting needs the liveset's exact name (numbers shift when livesets are added); use katana_liveset_list to get it.");
      }
      const { index, info } = await liveset(ref);
      await lib.deleteLiveset(index);
      return ok({ deleted: info.name });
    }),

    livesetAddCurrent: ({ liveset: ref, name, position, overwrite }: { liveset: Ref; name: string; position?: number; overwrite?: boolean }) =>
      guard(async () => {
        const n = checkName(name, PATCH_NAME_MAX, 'patch');
        const t = await livesetOrNew(ref);
        const rows = t.info.patches.length;
        const pos = position === undefined ? rows : position - 1;
        if (!Number.isInteger(pos) || pos < 0 || pos > rows) {
          throw new LibraryError(`Position ${position} is outside liveset "${t.info.name}"; use 1..${rows + 1}.`);
        }
        if (pos === rows && rows >= MAX_PATCHES) throw new LibraryError(`Liveset "${t.info.name}" is full (${MAX_PATCHES} patches).`);
        const old = pos < rows ? t.info.patches[pos] : undefined;
        const replaced = old !== undefined && !isEmptyPatchName(old) ? old : null;
        if (replaced !== null && overwrite !== true) {
          throw new LibraryError(`Patch ${pos + 1} of "${t.info.name}" is "${replaced}". ${ASK}`);
        }
        const index = await t.create();
        await lib.addCurrent(index, n, pos);
        return ok({ liveset: t.info.name, created: t.created, position: pos + 1, name: n, replaced });
      }),

    livesetLoad: ({ liveset: ref, patch }: { liveset: Ref; patch: Ref }) => guard(async () => {
      const { index, info } = await liveset(ref);
      const r = await lib.loadPatch(index, patchRef(info, patch));
      return ok({ ...r, note: 'Loaded into the edit buffer only; it is not saved to the amp until written (katana_write).' });
    }),

    livesetToAmp: ({ liveset: ref, patches, startSlot, overwrite }: { liveset: Ref; patches?: Ref[]; startSlot: string; overwrite?: boolean }) =>
      guard(async () => {
        const p = await ampPatches();
        const { index, info } = await liveset(ref);
        const idxs = patches?.length ? patches.map(r => patchRef(info, r)) : info.patches.map((_, i) => i);
        if (!idxs.length) throw new LibraryError(`Liveset "${info.name}" has no patches.`);
        const start = transferableSlot(p, startSlot);
        const free = p.slots.filter(s => s.exists && s.transferable && s.row >= start.row);
        if (free.length < idxs.length) {
          throw new LibraryError(`Only ${free.length} slots from ${slotName(start.row)} to ${slotName(free.at(-1)!.row)}; the liveset part has ${idxs.length} patches.`);
        }
        const rows = free.slice(0, idxs.length).map(s => s.row);
        const occupied = rows.filter(r => !isEmptyPatchName(p.slots[r].name));
        if (occupied.length && overwrite !== true) {
          throw new LibraryError(`These slots hold patches: ${occupied.map(r => `${slotName(r)} "${p.slots[r].name}"`).join(', ')}. ${ASK}`);
        }
        const r = await lib.toAmp(index, idxs, rows);
        return ok({ written: r.rows.map((row, k) => ({ slot: slotName(row), name: r.names[k] })) });
      }),

    livesetFromAmp: ({ slots, liveset: ref }: { slots?: string[]; liveset: Ref }) => guard(async () => {
      const p = await ampPatches();
      const rows = slots?.length
        ? slots.map(s => transferableSlot(p, s).row)
        : p.slots.filter(s => s.exists && s.transferable).map(s => s.row);
      const t = await livesetOrNew(ref);
      if (t.info.patches.length + rows.length > MAX_PATCHES) {
        throw new LibraryError(`Liveset "${t.info.name}" has ${t.info.patches.length} patches; adding ${rows.length} would exceed ${MAX_PATCHES}.`);
      }
      const index = await t.create();
      const r = await lib.fromAmp(rows, index);
      return ok({ liveset: r.liveset, created: t.created, added: rows.map((row, k) => ({ from: slotName(row), name: r.added[k] })) });
    }),

    livesetExport: ({ liveset: ref, path, overwrite }: { liveset: Ref; path?: string; overwrite?: boolean }) => guard(async () => {
      const { index, info } = await liveset(ref);
      const file = resolveTslPath(path, info.name, home);
      await writeTsl(file, await lib.livesetJson(index), overwrite === true);
      return ok({ liveset: info.name, path: file, patches: info.patches.length });
    }),

    livesetImport: ({ path, name }: { path: string; name?: string }) => guard(async () => {
      const t = await readTsl(path);
      let n: string;
      if (name !== undefined) {
        n = checkName(name, LIVESET_NAME_MAX, 'liveset');
      } else {
        try {
          n = checkName(t.name, LIVESET_NAME_MAX, 'liveset');
        } catch (e) {
          if (!(e instanceof LibraryError)) throw e;
          throw new LibraryError(`${e.message.replace(/^The liveset name/, 'The liveset name in the file').replace(/\.$/, '')}; pass name to import it under another name.`);
        }
      }
      const index = await lib.importJson(t.json, n);
      const l = (await lib.livesets())[index];
      return ok({ liveset: index + 1, name: l.name, patches: l.patches });
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

  const ref = z.union([z.string(), z.number().int()]);
  const livesetRefSchema = ref.describe('Liveset number from katana_liveset_list (1-based) or its exact name');
  const patchRefSchema = ref.describe('Patch number in the liveset (1-based) or its exact name');

  server.registerTool('katana_liveset_list', {
    description: 'List the livesets in BOSS TONE STUDIO\'s library (numbered from 1) with their patch names.',
  }, () => h.livesetList());

  server.registerTool('katana_liveset_create', {
    description: 'Create an empty liveset (max 64 ASCII chars). Library holds at most 50 livesets.',
    inputSchema: { name: z.string() },
  }, args => h.livesetCreate(args));

  server.registerTool('katana_liveset_rename', {
    description: 'Rename a liveset.',
    inputSchema: { liveset: livesetRefSchema, name: z.string() },
  }, args => h.livesetRename(args));

  server.registerTool('katana_liveset_delete', {
    description: 'Delete a liveset from the library. Confirm with the user first; it cannot be undone.',
    inputSchema: { liveset: z.string().describe('Exact liveset name (not a number)') },
  }, args => h.livesetDelete(args));

  server.registerTool('katana_liveset_add_current', {
    description: 'Store the current tone (edit buffer) as a patch in a liveset (created if the name is new). ' +
      'Appends by default; position replaces that patch, which needs overwrite after asking the user. Max 15 patches.',
    inputSchema: {
      liveset: livesetRefSchema,
      name: z.string().describe('Patch name, max 16 ASCII characters'),
      position: z.number().int().optional().describe('1-based position; omit to append'),
      overwrite: z.boolean().optional(),
    },
  }, args => h.livesetAddCurrent(args));

  server.registerTool('katana_liveset_load', {
    description: 'Load a liveset patch into the amp\'s edit buffer to play it (not saved to a slot).',
    inputSchema: { liveset: livesetRefSchema, patch: patchRefSchema },
  }, args => h.livesetLoad(args));

  server.registerTool('katana_liveset_to_amp', {
    description: 'Write liveset patches (all, or the listed ones) to consecutive amp slots starting at startSlot (A1 or later; PANEL cannot receive liveset patches). ' +
      'Refuses occupied slots unless overwrite is true: ask the user first.',
    inputSchema: {
      liveset: livesetRefSchema,
      patches: z.array(ref).optional().describe('Patches to send, in order, by 1-based number or exact name; omit for all'),
      startSlot: z.string().describe('First slot, e.g. A1 or B1'),
      overwrite: z.boolean().optional(),
    },
  }, args => h.livesetToAmp(args));

  server.registerTool('katana_liveset_from_amp', {
    description: 'Copy patches stored on the amp (all of A1..B4, or the listed slots) into a liveset (created if the name is new).',
    inputSchema: { slots: z.array(z.string()).optional(), liveset: livesetRefSchema },
  }, args => h.livesetFromAmp(args));

  server.registerTool('katana_liveset_export', {
    description: 'Save a liveset as a BOSS TONE STUDIO .tsl file. Default: Documents\\BOSS KATANA Tones\\<liveset>.tsl. ' +
      'Refuses an existing file unless overwrite is true.',
    inputSchema: {
      liveset: livesetRefSchema,
      path: z.string().optional().describe('File or folder path; .tsl is added if missing'),
      overwrite: z.boolean().optional(),
    },
  }, args => h.livesetExport(args));

  server.registerTool('katana_liveset_import', {
    description: 'Import a .tsl liveset file (KATANA Gen 3, or MkII files BOSS TONE STUDIO converts) as a new liveset.',
    inputSchema: { path: z.string(), name: z.string().optional().describe('Name for the new liveset; default: the name in the file') },
  }, args => h.livesetImport(args));
}
