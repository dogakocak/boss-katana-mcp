import { describe, expect, it } from 'vitest';
import { PAGE_AGENT_SOURCE } from '../src/page-agent.js';
import { btsInstalled } from './bts-sandbox.js';
import { createLibrarySandbox } from './library-sandbox.js';

const TEN = ['PANEL TONE', 'CLEAN', 'INIT TONE SETTING', 'CRUNCH', 'LEAD', 'INIT TONE SETTING', 'B2', 'B3', 'B4', 'INIT TONE SETTING'];

// BTS's own LibrarianModel.toJSON() already returns a JSON *string*; librarianServices.saveToStorage2
// then does JSON.stringify(liveset), which (since liveset has that toJSON) JSON-encodes that string
// again. So storage2 holds a doubly-encoded value, and this is what loadLivesetList's readStorage2 +
// LibrarianModel.load() expect back (readStorage2 undoes one layer, load() the other). Verified against
// the installed BOSS TONE STUDIO scripts (librarian_model.js toJSON/load, librarian_services.js
// saveToStorage2/readStorage2/loadLivesetList): a single JSON.parse on storage2's raw value yields the
// *inner JSON string*, not the liveset object, so reading it back here needs one extra JSON.parse.
function storedLiveset(raw: string): { name: string; data: unknown[][] } {
  return JSON.parse(JSON.parse(raw));
}

describe.skipIf(!btsInstalled)('library agent: library-only operations', () => {
  it('installs next to the tone agent and survives reinstalling', () => {
    const { sb } = createLibrarySandbox();
    sb.run(PAGE_AGENT_SOURCE);
    sb.run('window.__katanaClaude.lib.marker = 1');
    sb.run(PAGE_AGENT_SOURCE);
    expect(sb.run('window.__katanaClaude.lib.marker')).toBe(1);
    expect(sb.run('typeof window.__katanaClaude.read')).toBe('function');
  });

  it('lists slots with names, model and existence', async () => {
    const { lib } = createLibrarySandbox({ names: TEN, model: '05' });
    const p = await lib.patches();
    expect(p).toMatchObject({ current: 0, model: 'KATANA-50', connected: true });
    expect(p.slots[1]).toEqual({ row: 1, name: 'CLEAN', exists: true, transferable: true });
    expect(p.slots[0]).toMatchObject({ row: 0, exists: true, transferable: false });
    expect(p.slots[3]).toMatchObject({ row: 3, exists: false });
  });

  it('creates, renames and deletes livesets in BTS storage and redraws the LIBRARIAN page', async () => {
    const s = createLibrarySandbox();
    expect(await s.lib.createLiveset('GIG')).toBe(0);
    expect((await s.lib.livesets()).map(l => l.name)).toEqual(['GIG', 'LIVESET 1']);
    const id = (await s.lib.livesets())[0].id;
    expect(storedLiveset(s.storage[String(id)]).name).toBe('GIG');
    expect(JSON.parse(s.storage.ID_LIST).list).toEqual([id, 0]);
    await s.lib.renameLiveset(0, 'GIG 2');
    expect(storedLiveset(s.storage[String(id)]).name).toBe('GIG 2');
    await s.lib.deleteLiveset(0);
    expect((await s.lib.livesets()).map(l => l.name)).toEqual(['LIVESET 1']);
    expect(JSON.parse(s.storage.ID_LIST).list).toEqual([0]);
    expect(s.calls().filter(c => c === 'redraw')).toHaveLength(3);
    expect(s.storage[String(id)]).toBe('');
  });

  it('refuses a 51st liveset', async () => {
    const s = createLibrarySandbox();
    for (let i = 0; i < 49; i++) await s.lib.createLiveset(`L${i}`);
    await expect(s.lib.createLiveset('ONE TOO MANY')).rejects.toThrow('The library is full (50 livesets).');
  });

  it('adds the current tone as a patch equal to the edit buffer, named as asked', async () => {
    const s = createLibrarySandbox();
    s.sb.run('Parameter.setValue("PATCH%AMP%1", INTEGER1x7, 0, 12)'); // amp volume 12 in the edit buffer
    expect(await s.lib.addCurrent(0, 'CLAUDE LEAD', 0)).toBe(0);
    expect((await s.lib.livesets())[0].patches).toEqual(['CLAUDE LEAD']);
    expect(s.sb.run(`(function () {
      var cell = librarianCommonInfo.livesetList[0].cell(0, 0), cfg = ProductSetting.librarian[0].config;
      return cfg.blockSet.every(function (bid) {
        if (bid === 'PATCH%COM') return true;
        return cell.paramSet[bid].join() === Parameter.paramSet[cfg.temporarySet[bid]].join();
      }) && cell.paramSet['PATCH%AMP'][1] === '0C';
    })()`)).toBe(true);
    expect(storedLiveset(s.storage['0']).data[0]).toHaveLength(1);
  });

  it('replaces the patch at a position and refuses a 16th patch', async () => {
    const s = createLibrarySandbox();
    for (let i = 0; i < 15; i++) await s.lib.addCurrent(0, `P${i}`, i);
    await s.lib.addCurrent(0, 'NEW 3', 2);
    expect((await s.lib.livesets())[0].patches[2]).toBe('NEW 3');
    await expect(s.lib.addCurrent(0, 'P15', 15)).rejects.toThrow('is full (15 patches)');
  });

  it('round-trips a liveset through BTS\'s .tsl JSON', async () => {
    const s = createLibrarySandbox();
    await s.lib.addCurrent(0, 'ONE', 0);
    await s.lib.addCurrent(0, 'TWO', 1);
    const json = await s.lib.livesetJson(0);
    expect(JSON.parse(json)).toMatchObject({ name: 'LIVESET 1', device: 'KATANA Gen3', formatRev: '0000' });
    expect(await s.lib.importJson(json, 'COPY')).toBe(0);
    const list = await s.lib.livesets();
    expect(list[0]).toMatchObject({ name: 'COPY', patches: ['ONE', 'TWO'] });
    expect(list[0].id).not.toBe(list[1].id);
  });

  it('reports a file BTS cannot read', async () => {
    const s = createLibrarySandbox();
    await expect(s.lib.importJson(JSON.stringify({ name: 'X', formatRev: '0000', device: 'GT-1000', data: [[]] }), null))
      .rejects.toThrow('BOSS TONE STUDIO cannot read this file');
  });

  it('reports bad indexes', async () => {
    const s = createLibrarySandbox();
    await expect(s.lib.renameLiveset(5, 'X')).rejects.toThrow('No liveset at index 5');
  });
});
