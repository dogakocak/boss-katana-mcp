import { describe, expect, it } from 'vitest';
import { type LibraryClient, LibraryError, type PatchesInfo } from '../src/library.js';
import { createLibraryHandlers } from '../src/library-tools.js';

const json = (r: { content: { text: string }[] }) => JSON.parse(r.content[0].text);
const text = (r: { content: { text: string }[] }) => r.content[0].text;

const NAMES = ['PANEL TONE', 'CLEAN', 'INIT TONE SETTING', 'CRUNCH', 'LEAD', '', 'B2', 'B3', 'B4', 'INIT TONE SETTING'];
function patchesInfo(connected = true): PatchesInfo {
  return {
    current: 1, model: 'KATANA-100', connected,
    slots: NAMES.map((name, row) => ({ row, name, exists: row < 9, transferable: row > 0 && row < 9 })),
  };
}

/** LibraryClient fake that records calls; override what a test needs. */
function fakeLib(over: Partial<LibraryClient> = {}): LibraryClient & { log: unknown[][] } {
  const log: unknown[][] = [];
  const rec = <T>(name: string, value: T) => async (...args: unknown[]) => { log.push([name, ...args]); return value; };
  return {
    log,
    patches: async () => patchesInfo(),
    selectPatch: rec('selectPatch', { current: 4, name: 'LEAD' }),
    writePatch: async (row, name) => { log.push(['writePatch', row, name]); return { row, name }; },
    livesets: async () => [],
    createLiveset: rec('createLiveset', 0),
    renameLiveset: rec('renameLiveset', null),
    deleteLiveset: rec('deleteLiveset', null),
    addCurrent: async (i, n, p) => { log.push(['addCurrent', i, n, p]); return p; },
    loadPatch: rec('loadPatch', { liveset: '', patch: '' }),
    toAmp: rec('toAmp', { rows: [], names: [] }),
    fromAmp: rec('fromAmp', { liveset: '', added: [] }),
    livesetJson: rec('livesetJson', '{}'),
    importJson: rec('importJson', 0),
    ...over,
  };
}

describe('library tools: amp slots', () => {
  it('lists existing slots with empty flags and the current slot', async () => {
    const out = json(await createLibraryHandlers({ lib: fakeLib() }).listPatches());
    expect(out.model).toBe('KATANA-100');
    expect(out.current).toBe('A1');
    expect(out.slots).toHaveLength(9);
    expect(out.slots[2]).toEqual({ slot: 'A2', name: 'INIT TONE SETTING', empty: true });
    expect(out.slots[3]).toEqual({ slot: 'A3', name: 'CRUNCH', empty: false });
  });

  it('needs a connected amp for slot tools', async () => {
    const r = await createLibraryHandlers({ lib: fakeLib({ patches: async () => patchesInfo(false) }) }).listPatches();
    expect(r.isError).toBe(true);
    expect(text(r)).toContain('No KATANA is connected');
  });

  it('selects a slot by name', async () => {
    const lib = fakeLib();
    expect(json(await createLibraryHandlers({ lib }).selectPatch({ slot: 'a:ch4' }))).toEqual({ current: 'A4', name: 'LEAD' });
    expect(lib.log).toEqual([['selectPatch', 4]]);
  });

  it('writes to an empty slot', async () => {
    const lib = fakeLib();
    const out = json(await createLibraryHandlers({ lib }).write({ slot: 'B1', name: ' CLAUDE LEAD ' }));
    expect(out).toEqual({ slot: 'B1', name: 'CLAUDE LEAD', replaced: null });
    expect(lib.log).toEqual([['writePatch', 5, 'CLAUDE LEAD']]);
  });

  it('refuses to overwrite a stored patch unless asked, then overwrites', async () => {
    const lib = fakeLib();
    const h = createLibraryHandlers({ lib });
    const r = await h.write({ slot: 'A3', name: 'NEW' });
    expect(r.isError).toBe(true);
    expect(text(r)).toBe('A3 holds "CRUNCH". Ask the user, then call again with overwrite: true.');
    expect(lib.log).toEqual([]);
    expect(json(await h.write({ slot: 'A3', name: 'NEW', overwrite: true }))).toEqual({ slot: 'A3', name: 'NEW', replaced: 'CRUNCH' });
  });

  it('rejects slots the model does not have and bad names before writing', async () => {
    const lib = fakeLib({ patches: async () => ({ ...patchesInfo(), slots: patchesInfo().slots.map(s => ({ ...s, exists: s.exists && ![3, 4, 7, 8].includes(s.row) })) }) });
    const h = createLibraryHandlers({ lib });
    expect(text(await h.write({ slot: 'A4', name: 'X' }))).toBe('KATANA-100 has no slot A4; valid: PANEL, A1, A2, B1, B2.');
    expect(text(await h.write({ slot: 'A1', name: 'Çok' }))).toContain('plain ASCII');
    expect(text(await h.write({ slot: 'Z9', name: 'X' }))).toContain('PANEL, A1..A4 or B1..B4');
    expect(lib.log).toEqual([]);
  });

  it('passes page-agent failures through as tool errors', async () => {
    const lib = fakeLib({ writePatch: async () => { throw new LibraryError('PATCH_WRITE: the amp did not reply'); } });
    const r = await createLibraryHandlers({ lib }).write({ slot: 'B1', name: 'X' });
    expect(r).toEqual({ isError: true, content: [{ type: 'text', text: 'PATCH_WRITE: the amp did not reply' }] });
  });
});
