import { describe, expect, it } from 'vitest';
import { btsInstalled } from './bts-sandbox.js';
import { createLibrarySandbox, until } from './library-sandbox.js';

const TEN = ['PANEL TONE', 'CLEAN', 'INIT TONE SETTING', 'CRUNCH', 'LEAD', 'INIT TONE SETTING', 'B2', 'B3', 'B4', 'INIT TONE SETTING'];
const sentTo = (s: { dt1(): string[] }, addr: string) => () => s.dt1().some(d => d.startsWith(addr + ':'));

/** Makes Librarian.read/write/temporaryWrite finish immediately (their MIDI loop needs real timers). */
function instantLibrarian(s: ReturnType<typeof createLibrarySandbox>, outcome: 'end' | 'timeout' = 'end') {
  s.sb.run(`(function () {
    var lib = librarianCommonInfo.librarians[0];
    function fake(msg) { return function (a) { __calls.push(msg + ' ' + JSON.stringify(a && a.paramSet ? 'cell' : a)); var self = this; setTimeout(function () { self.broadcast(msg, ${JSON.stringify(outcome)}); }, 0); }; }
    lib.read = fake('librarian_read');
    lib.write = fake('librarian_write');
    lib.temporaryWrite = fake('librarian_temporaryWrite');
  })()`);
}

describe.skipIf(!btsInstalled)('library agent: amp operations', () => {
  it('writes the edit buffer to a slot like the WRITE dialog: name, PATCH_WRITE, export, then selects it', async () => {
    const s = createLibrarySandbox({ names: TEN });
    const done = s.lib.writePatch(6, 'CLAUDE LEAD');
    await until(sentTo(s, '7F000104'));
    s.reply('7F000104', '0006');
    await until(sentTo(s, '7F01010A'));
    s.reply('7F01010A', '4006');
    expect(await done).toEqual({ row: 6, name: 'CLAUDE LEAD' });
    expect(s.dt1()).toEqual(['20000000:434C41554445204C4541442020202020', '7F000104:0006', '7F010109:01', '7F01010A:4006']);
    expect(s.sb.run('patchModelController.getPatchName(6)')).toBe('CLAUDE LEAD');
    expect(s.calls()[0]).toBe('openLoading');
    expect(s.calls()).toContain('closeLoading');
  });

  it('fails with the step that got no reply and closes the loading popup', async () => {
    const s = createLibrarySandbox({ names: TEN });
    s.sb.run('ProductSetting.timeout = 0.05');
    await expect(s.lib.writePatch(6, 'X')).rejects.toThrow('PATCH_WRITE: the amp did not reply');
    expect(s.calls()).toContain('closeLoading');
  });

  it('unmutes the preview after a failed export, so the amp is not left muted', async () => {
    const s = createLibrarySandbox({ names: TEN });
    const done = s.lib.writePatch(6, 'CLAUDE LEAD');
    await until(sentTo(s, '7F000104'));
    s.reply('7F000104', '0006');
    s.sb.run('ProductSetting.timeout = 0.05');
    await expect(done).rejects.toThrow('CMDID_EXPORT: the amp did not reply');
    const muteIdx = s.dt1().indexOf('7F010109:01');
    const unmuteIdx = s.dt1().indexOf('7F010109:00');
    expect(muteIdx).toBeGreaterThanOrEqual(0);
    expect(unmuteIdx).toBeGreaterThan(muteIdx);
  });

  it('refuses amp work when no amp is connected or the librarian is busy', async () => {
    const off = createLibrarySandbox({ connected: false });
    await expect(off.lib.writePatch(1, 'X')).rejects.toThrow('No KATANA is connected');
    const busy = createLibrarySandbox();
    busy.sb.run('librarianCommonInfo.librarians[0].timerId = 1');
    await expect(busy.lib.selectPatch(1)).rejects.toThrow('transferring data');
    expect(busy.dt1()).toEqual([]);
  });

  it('selects a slot with PATCH_SELECT', async () => {
    const s = createLibrarySandbox({ names: TEN });
    expect(await s.lib.selectPatch(4)).toEqual({ current: 4, name: 'LEAD' });
    expect(s.dt1()).toEqual(['7F000100:0004']);
    expect(s.sb.run('patchModelController.getCurrentPatchNum()')).toBe(4);
  });

  it('loads a liveset patch into the edit buffer the way a LIBRARIAN click does', async () => {
    const s = createLibrarySandbox({ names: TEN });
    instantLibrarian(s);
    await s.lib.addCurrent(0, 'STORED', 0); // amp volume 50
    s.sb.run('Parameter.setValue("PATCH%AMP%1", INTEGER1x7, 0, 12)');
    expect(await s.lib.loadPatch(0, 0)).toEqual({ liveset: 'LIVESET 1', patch: 'STORED' });
    expect(s.sb.run('Parameter.value("PATCH%AMP%1", INTEGER1x7, 0)')).toBe(50);
    expect(s.calls()).toEqual(expect.arrayContaining(['librarian_temporaryWrite "cell"', 'readEditor 0', 'setupKnobModFxTargetList']));
    await until(() => s.dt1().includes('7F010109:00')); // preview unmuted again
    expect(s.dt1().filter(d => d.startsWith('7F010109:'))).toEqual(['7F010109:01', '7F010109:00']);
  });

  it('writes liveset patches to consecutive slots and sends one multi-patch export', async () => {
    const s = createLibrarySandbox({ names: TEN });
    instantLibrarian(s);
    for (const [i, n] of ['ONE', 'TWO', 'THREE'].entries()) await s.lib.addCurrent(0, n, i);
    const done = s.lib.toAmp(0, [0, 1, 2], [5, 6, 7]);
    await until(sentTo(s, '7F01010A'));
    s.reply('7F01010A', '7F7F');
    expect(await done).toEqual({ rows: [5, 6, 7], names: ['ONE', 'TWO', 'THREE'] });
    expect(s.calls()).toContain('librarian_write [5,6,7]');
    expect(s.dt1()).toContain('7F01010A:7F7F');
    expect(s.sb.run('librarianCommonInfo.instLiveset.cell(0, 6).value(0).trim()')).toBe('TWO');
  });

  it('uses two single exports for two patches, like BTS', async () => {
    const s = createLibrarySandbox({ names: TEN });
    instantLibrarian(s);
    await s.lib.addCurrent(0, 'ONE', 0);
    await s.lib.addCurrent(0, 'TWO', 1);
    const done = s.lib.toAmp(0, [0, 1], [1, 2]);
    await until(sentTo(s, '7F01010A'));
    s.reply('7F01010A', '0001');
    await until(() => s.dt1().includes('7F01010A:4002'));
    s.reply('7F01010A', '4002');
    await done;
    expect(s.dt1().filter(d => d.startsWith('7F01010A:'))).toEqual(['7F01010A:0001', '7F01010A:4002']);
  });

  it('reads amp slots into a liveset', async () => {
    const s = createLibrarySandbox({ names: TEN });
    instantLibrarian(s);
    s.sb.run('librarianCommonInfo.instLiveset.cell(0, 3).setValue(0, "CRUNCH")');
    s.sb.run('librarianCommonInfo.instLiveset.cell(0, 4).setValue(0, "LEAD")');
    expect(await s.lib.fromAmp([3, 4], 0)).toEqual({ liveset: 'LIVESET 1', added: ['CRUNCH', 'LEAD'] });
    expect(s.calls()).toContain('librarian_read [3,4]');
    // storage2 is double-JSON-encoded (see storedLiveset in library-agent.test.ts); a single
    // JSON.parse here yields the inner JSON *string*, not the liveset object.
    expect(JSON.parse(JSON.parse(s.storage['0'])).data[0]).toHaveLength(2);
  });

  it('reports an amp read timeout', async () => {
    const s = createLibrarySandbox({ names: TEN });
    instantLibrarian(s, 'timeout');
    await expect(s.lib.fromAmp([3], 0)).rejects.toThrow('librarian_read: the amp did not reply');
  });

  it('refuses a second amp operation while a write is waiting for the amp', async () => {
    const s = createLibrarySandbox({ names: TEN });
    const first = s.lib.writePatch(6, 'A');
    await until(sentTo(s, '7F000104'));
    await expect(s.lib.writePatch(7, 'B')).rejects.toThrow('transferring data');
    await expect(s.lib.selectPatch(1)).rejects.toThrow('transferring data');
    s.reply('7F000104', '0006');
    await until(sentTo(s, '7F01010A'));
    s.reply('7F01010A', '4006');
    expect(await first).toEqual({ row: 6, name: 'A' });
    expect(await s.lib.selectPatch(1)).toEqual({ current: 1, name: 'CLEAN' });
  });

  it('stops a timed-out transfer from saving later', async () => {
    const s = createLibrarySandbox({ names: TEN });
    s.sb.run('window.__katanaTransferMs = 50');
    s.sb.run(`(function () {
      var lib = librarianCommonInfo.librarians[0];
      lib.read = function () {
        var self = this;
        setTimeout(function () { self.broadcast('librarian_read', 'end'); }, 150);
      };
    })()`);
    await expect(s.lib.fromAmp([3], 0)).rejects.toThrow('did not finish within');
    await new Promise(resolve => setTimeout(resolve, 250));
    expect((await s.lib.livesets())[0].patches).toHaveLength(0);
    // The late 'end' must have cleared inFlight, so a later transfer is not blocked forever.
    instantLibrarian(s);
    await expect(s.lib.fromAmp([3], 0)).resolves.toMatchObject({ liveset: 'LIVESET 1' });
  });
});
