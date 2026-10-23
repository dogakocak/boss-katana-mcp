import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { LibraryClient, LivesetInfo, PatchesInfo } from '../src/library.js';
import { createLibraryHandlers } from '../src/library-tools.js';
import { btsInstalled } from './bts-sandbox.js';
import { createLibrarySandbox } from './library-sandbox.js';

const json = (r: { content: { text: string }[] }) => JSON.parse(r.content[0].text);
const text = (r: { content: { text: string }[] }) => r.content[0].text;

const NAMES = ['PANEL TONE', 'CLEAN', 'INIT TONE SETTING', 'CRUNCH', 'LEAD', '', 'INIT TONE SETTING', 'B3', 'B4', 'INIT TONE SETTING'];
const PATCHES: PatchesInfo = {
  current: 1, model: 'KATANA-100', connected: true,
  slots: NAMES.map((name, row) => ({ row, name, exists: row < 9, transferable: row > 0 && row < 9 })),
};
const LIVESETS: LivesetInfo[] = [
  { id: 3, name: 'GIG', patches: ['INTRO', 'VERSE', 'SOLO'] },
  { id: 0, name: 'LIVESET 1', patches: [] },
];

function fakeLib(over: Partial<LibraryClient> = {}): LibraryClient & { log: unknown[][] } {
  const log: unknown[][] = [];
  const rec = <T>(name: string, value: T) => async (...args: unknown[]) => { log.push([name, ...args]); return value; };
  return {
    log,
    patches: async () => PATCHES,
    selectPatch: rec('selectPatch', { current: 1, name: '' }),
    writePatch: rec('writePatch', { row: 0, name: '' }),
    livesets: async () => LIVESETS,
    createLiveset: rec('createLiveset', 0),
    renameLiveset: rec('renameLiveset', null),
    deleteLiveset: rec('deleteLiveset', null),
    addCurrent: async (i, n, p) => { log.push(['addCurrent', i, n, p]); return p; },
    loadPatch: async (i, p) => { log.push(['loadPatch', i, p]); return { liveset: 'GIG', patch: 'VERSE' }; },
    toAmp: async (i, ps, rows) => { log.push(['toAmp', i, ps, rows]); return { rows, names: ps.map(p => LIVESETS[i].patches[p]) }; },
    fromAmp: async (rows, i) => { log.push(['fromAmp', rows, i]); return { liveset: 'GIG', added: rows.map(r => NAMES[r]) }; },
    livesetJson: rec('livesetJson', '{"name":"GIG"}'),
    importJson: rec('importJson', 0),
    ...over,
  };
}

describe('library tools: livesets', () => {
  it('lists livesets 1-based', async () => {
    expect(json(await createLibraryHandlers({ lib: fakeLib() }).livesetList())).toEqual([
      { liveset: 1, name: 'GIG', patches: ['INTRO', 'VERSE', 'SOLO'] },
      { liveset: 2, name: 'LIVESET 1', patches: [] },
    ]);
  });

  it('creates, renames and deletes by number or name', async () => {
    const lib = fakeLib();
    const h = createLibraryHandlers({ lib });
    expect(json(await h.livesetCreate({ name: 'NEW' }))).toEqual({ liveset: 1, name: 'NEW' });
    expect(json(await h.livesetRename({ liveset: 'gig', name: 'GIG 24' }))).toEqual({ liveset: 1, name: 'GIG 24' });
    expect(json(await h.livesetDelete({ liveset: 'LIVESET 1' }))).toEqual({ deleted: 'LIVESET 1' });
    expect(lib.log).toEqual([['createLiveset', 'NEW'], ['renameLiveset', 0, 'GIG 24'], ['deleteLiveset', 1]]);
  });

  it('refuses to delete by number, since numbers shift when livesets are added', async () => {
    const lib = fakeLib();
    const h = createLibraryHandlers({ lib });
    expect(text(await h.livesetDelete({ liveset: 2 }))).toBe(
      "Deleting needs the liveset's exact name (numbers shift when livesets are added); use katana_liveset_list to get it.",
    );
    expect(lib.log).toEqual([]);
  });

  it('appends the current tone, creating the liveset when the name is new', async () => {
    const lib = fakeLib();
    const h = createLibraryHandlers({ lib });
    expect(json(await h.livesetAddCurrent({ liveset: 'GIG', name: 'OUTRO' }))).toMatchObject({ liveset: 'GIG', created: false, position: 4, replaced: null });
    expect(json(await h.livesetAddCurrent({ liveset: 'BLUES NIGHT', name: 'SLOW' }))).toMatchObject({ liveset: 'BLUES NIGHT', created: true, position: 1 });
    expect(lib.log).toEqual([['addCurrent', 0, 'OUTRO', 3], ['createLiveset', 'BLUES NIGHT'], ['addCurrent', 0, 'SLOW', 0]]);
  });

  it('validates addCurrent position before creating a new liveset, so a bad position leaves no orphan', async () => {
    const lib = fakeLib();
    const h = createLibraryHandlers({ lib });
    expect(text(await h.livesetAddCurrent({ liveset: 'NEW ONE', name: 'X', position: 3 })))
      .toContain('is outside liveset "NEW ONE"');
    expect(lib.log.some(l => l[0] === 'createLiveset')).toBe(false);
  });

  it('refuses to replace a liveset patch unless asked', async () => {
    const lib = fakeLib();
    const h = createLibraryHandlers({ lib });
    expect(text(await h.livesetAddCurrent({ liveset: 1, name: 'X', position: 2 })))
      .toBe('Patch 2 of "GIG" is "VERSE". Ask the user, then call again with overwrite: true.');
    expect(json(await h.livesetAddCurrent({ liveset: 1, name: 'X', position: 2, overwrite: true }))).toMatchObject({ position: 2, replaced: 'VERSE' });
    expect(text(await h.livesetAddCurrent({ liveset: 1, name: 'X', position: 9 }))).toBe('Position 9 is outside liveset "GIG"; use 1..4.');
  });

  it('loads a patch by name', async () => {
    const lib = fakeLib();
    const out = json(await createLibraryHandlers({ lib }).livesetLoad({ liveset: 'GIG', patch: 'verse' }));
    expect(out).toMatchObject({ liveset: 'GIG', patch: 'VERSE' });
    expect(out.note).toContain('not saved');
    expect(lib.log).toEqual([['loadPatch', 0, 1]]);
  });

  it('writes a liveset to consecutive transferable slots, refusing occupied ones without overwrite', async () => {
    const lib = fakeLib();
    const h = createLibraryHandlers({ lib });
    const refused = await h.livesetToAmp({ liveset: 'GIG', startSlot: 'A2' });
    expect(text(refused)).toBe('These slots hold patches: A3 "CRUNCH", A4 "LEAD". Ask the user, then call again with overwrite: true.');
    expect(json(await h.livesetToAmp({ liveset: 'GIG', startSlot: 'B1', patches: [1, 'SOLO'] }))).toEqual({
      written: [{ slot: 'B1', name: 'INTRO' }, { slot: 'B2', name: 'SOLO' }],
    });
    expect(lib.log).toEqual([['toAmp', 0, [0, 2], [5, 6]]]);
    expect(text(await h.livesetToAmp({ liveset: 'GIG', startSlot: 'PANEL' }))).toContain('PANEL cannot receive liveset patches');
    expect(text(await h.livesetToAmp({ liveset: 'GIG', startSlot: 'B3', overwrite: true }))).toBe('Only 2 slots from B3 to B4; the liveset part has 3 patches.');
  });

  it('reads amp slots into a liveset (all transferable slots by default)', async () => {
    const lib = fakeLib();
    const h = createLibraryHandlers({ lib });
    expect(json(await h.livesetFromAmp({ liveset: 'GIG', slots: ['A3', 'a4'] }))).toEqual({
      liveset: 'GIG', created: false, added: [{ from: 'A3', name: 'CRUNCH' }, { from: 'A4', name: 'LEAD' }],
    });
    await h.livesetFromAmp({ liveset: 'AMP BACKUP' });
    expect(lib.log.at(-1)).toEqual(['fromAmp', [1, 2, 3, 4, 5, 6, 7, 8], 0]);
    expect(text(await h.livesetFromAmp({ liveset: 'GIG', slots: ['PANEL'] }))).toContain('PANEL cannot');
  });

  it('refuses addCurrent on a liveset that already has 15 patches', async () => {
    const lib = fakeLib({
      livesets: async () => [{ id: 1, name: 'FULL', patches: Array.from({ length: 15 }, (_, i) => `P${i}`) }],
    });
    const h = createLibraryHandlers({ lib });
    expect(text(await h.livesetAddCurrent({ liveset: 'FULL', name: 'X' }))).toContain('is full (15 patches)');
    expect(lib.log).toEqual([]);
  });

  it('refuses fromAmp when it would push a liveset past 15 patches', async () => {
    const lib = fakeLib({
      livesets: async () => [{ id: 1, name: 'TEN', patches: Array.from({ length: 10 }, (_, i) => `P${i}`) }],
    });
    const h = createLibraryHandlers({ lib });
    expect(text(await h.livesetFromAmp({ liveset: 'TEN' }))).toContain('would exceed 15');
    expect(lib.log).toEqual([]);
  });

  it('checks fromAmp capacity before creating a new liveset, so a rejected call leaves no orphan', async () => {
    const lib = fakeLib();
    const h = createLibraryHandlers({ lib });
    expect(text(await h.livesetFromAmp({ liveset: 'NEW SET', slots: Array.from({ length: 16 }, () => 'A1') })))
      .toContain('would exceed 15');
    expect(lib.log).toEqual([]);
  });

  it('creates a new liveset then copies from amp when capacity allows', async () => {
    const lib = fakeLib();
    const h = createLibraryHandlers({ lib });
    expect(json(await h.livesetFromAmp({ liveset: 'NEW SET' }))).toMatchObject({ created: true });
    expect(lib.log).toEqual([['createLiveset', 'NEW SET'], ['fromAmp', [1, 2, 3, 4, 5, 6, 7, 8], 0]]);
  });

  it('exports to the default folder and refuses to overwrite a file', async () => {
    const home = mkdtempSync(join(tmpdir(), 'katana-home-'));
    const h = createLibraryHandlers({ lib: fakeLib(), home });
    const out = json(await h.livesetExport({ liveset: 'GIG' }));
    expect(out.path).toBe(join(home, 'Documents', 'BOSS KATANA Tones', 'GIG.tsl'));
    expect(readFileSync(out.path, 'utf8')).toBe('{"name":"GIG"}');
    expect(text(await h.livesetExport({ liveset: 'GIG' }))).toContain('already exists. Ask the user');
  });

  it('imports a .tsl file as a new liveset', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'katana-imp-'));
    const file = join(dir, 'gig.tsl');
    const tsl = JSON.stringify({ name: 'GIG', formatRev: '0000', device: 'KATANA Gen3', data: [[{ memo: '', paramSet: {} }]] });
    writeFileSync(file, tsl, 'utf8');
    const lib = fakeLib();
    const out = json(await createLibraryHandlers({ lib }).livesetImport({ path: file, name: 'GIG COPY' }));
    expect(lib.log).toEqual([['importJson', tsl, 'GIG COPY']]);
    expect(out).toEqual({ liveset: 1, name: 'GIG', patches: ['INTRO', 'VERSE', 'SOLO'] });
  });

  it('refuses to import under the file\'s own name when BTS cannot store it, unless given a name', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'katana-imp-'));
    const file = join(dir, 'bad.tsl');
    const tsl = JSON.stringify({ name: 'Çok Güzel', formatRev: '0000', device: 'KATANA Gen3', data: [[{ memo: '', paramSet: {} }]] });
    writeFileSync(file, tsl, 'utf8');
    const lib = fakeLib();
    const out = text(await createLibraryHandlers({ lib }).livesetImport({ path: file }));
    expect(out).toBe(
      'The liveset name in the file "Çok Güzel" has characters the KATANA cannot store; use plain ASCII letters, digits and punctuation; pass name to import it under another name.',
    );
    expect(lib.log).toEqual([]);
  });
});

describe.skipIf(!btsInstalled)('library tools over the real BTS librarian', () => {
  it('adds the current tone, exports it and imports it back', async () => {
    const home = mkdtempSync(join(tmpdir(), 'katana-rt-'));
    const { lib } = createLibrarySandbox();
    const h = createLibraryHandlers({ lib, home });
    await h.livesetAddCurrent({ liveset: 'ROUND TRIP', name: 'CLAUDE' });
    const { path } = json(await h.livesetExport({ liveset: 'ROUND TRIP' }));
    expect(json(await h.livesetImport({ path, name: 'ROUND TRIP 2' }))).toEqual({ liveset: 1, name: 'ROUND TRIP 2', patches: ['CLAUDE'] });
    expect(json(await h.livesetList()).map((l: { name: string }) => l.name)).toEqual(['ROUND TRIP 2', 'ROUND TRIP', 'LIVESET 1']);
  });
});
