import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createCdpBts } from '../src/bts.js';
import { createCdpLibrary } from '../src/library.js';
import { launch } from '../src/launcher.js';
import { createHandlers } from '../src/tools.js';
import { createLibraryHandlers } from '../src/library-tools.js';

const json = (r: { content: { text: string }[] }) => JSON.parse(r.content[0].text);

describe.skipIf(process.env.KATANA_E2E !== '1')('live BOSS TONE STUDIO', () => {
  it('launches or finds BTS', async () => {
    expect((await launch()).ok).toBe(true);
  });

  it('changes amp.volume by one and restores it', async () => {
    const h = createHandlers({ bts: createCdpBts(), launch: () => launch() });
    const before = json(await h.get({ sections: ['amp'] })).amp['amp.volume'] as number;
    const next = before === 100 ? 99 : before + 1;
    try {
      expect(json(await h.set({ changes: { 'amp.volume': next } })).applied['amp.volume']).toBe(next);
      expect(json(await h.get({ sections: ['amp'] })).amp['amp.volume']).toBe(next);
    } finally {
      const restore = await h.set({ changes: { 'amp.volume': before } });
      expect(restore.isError).not.toBe(true);
      expect(json(restore).applied['amp.volume']).toBe(before);
      expect(json(await h.get({ sections: ['amp'] })).amp['amp.volume']).toBe(before);
    }
  });
});

describe.skipIf(process.env.KATANA_E2E !== '1')('live librarian', () => {
  const lj = (r: { content: { text: string }[]; isError?: boolean }) => {
    if (r.isError) throw new Error(r.content[0].text);
    return JSON.parse(r.content[0].text);
  };

  it('adds the current tone to a temp liveset, exports, imports and cleans up', async () => {
    const home = mkdtempSync(join(tmpdir(), 'katana-e2e-'));
    const h = createLibraryHandlers({ lib: createCdpLibrary(), home });
    const name = `E2E ${Date.now() % 100000}`;
    try {
      lj(await h.livesetAddCurrent({ liveset: name, name: 'E2E TONE' }));
      const { path } = lj(await h.livesetExport({ liveset: name }));
      expect(lj(await h.livesetImport({ path, name: `${name} B` })).patches).toEqual(['E2E TONE']);
    } finally {
      for (const n of [`${name} B`, name]) await h.livesetDelete({ liveset: n });
    }
    expect(lj(await h.livesetList()).some((l: { name: string }) => l.name.startsWith(name))).toBe(false);
  });

  it.skipIf(!process.env.KATANA_E2E_WRITE_SLOT)('writes to the agreed slot and restores it', async () => {
    const slot = process.env.KATANA_E2E_WRITE_SLOT!;
    const h = createLibraryHandlers({ lib: createCdpLibrary() });
    const before = lj(await h.listPatches()).slots.find((s: { slot: string }) => s.slot === slot.toUpperCase());
    const backup = `E2E BACKUP ${Date.now() % 100000}`;
    lj(await h.livesetFromAmp({ liveset: backup, slots: [slot] }));
    try {
      lj(await h.write({ slot, name: 'E2E WRITE', overwrite: true }));
      expect(lj(await h.listPatches()).slots.find((s: { slot: string }) => s.slot === slot.toUpperCase()).name).toBe('E2E WRITE');
    } finally {
      lj(await h.livesetToAmp({ liveset: backup, startSlot: slot, overwrite: true }));
      await h.livesetDelete({ liveset: backup });
    }
    expect(lj(await h.listPatches()).slots.find((s: { slot: string }) => s.slot === slot.toUpperCase()).name).toBe(before.name);
  });
});
