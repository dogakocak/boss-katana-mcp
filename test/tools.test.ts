import { describe, expect, it } from 'vitest';
import type { BtsClient } from '../src/bts.js';
import { BtsUnavailableError } from '../src/cdp.js';
import { agentCall, type Leaf, type WriteChange } from '../src/page-agent.js';
import { createHandlers } from '../src/tools.js';
import { btsInstalled, createSandbox } from './bts-sandbox.js';

/** BtsClient backed by the real BTS scripts in a vm sandbox. */
function sandboxBts(connected = true): BtsClient & { sb: ReturnType<typeof createSandbox> } {
  const sb = createSandbox();
  if (connected) sb.run('window.currentMIDIConnect = {}');
  return {
    sb,
    status: async () => sb.run(agentCall('status')),
    index: async () => sb.run<Leaf[]>(agentCall('index')),
    read: async (pids: string[]) => sb.run(agentCall('read', pids)),
    write: async (c: WriteChange[]) => sb.run(agentCall('write', c)),
    connect: async () => ({ started: false, already: true }),
    controls: async (defs) => ({ gafc: true, readings: defs.map(d => ({ key: d.key, value: 0, label: 'X' })) }),
  };
}
const json = (r: { content: { text: string }[] }) => JSON.parse(r.content[0].text);
const noLaunch = async () => ({ ok: true, message: '' });

describe.skipIf(!btsInstalled)('tools', () => {
  it('get returns friendly values for requested sections', async () => {
    const h = createHandlers({ bts: sandboxBts(), launch: noLaunch });
    const out = json(await h.get({ sections: ['amp'] }));
    expect(out.amp).toMatchObject({ 'amp.type': 'CLEAN', 'amp.volume': 50 });
    expect(out.booster).toBeUndefined();
  });

  it('set writes, reads back and reports', async () => {
    const bts = sandboxBts();
    const h = createHandlers({ bts, launch: noLaunch });
    const out = json(await h.set({ changes: { 'amp.volume': 12, 'booster.type': 'BLUES DRIVE' } }));
    expect(out.applied).toEqual({ 'amp.volume': 12, 'booster.type': 'BLUES DRIVE' });
    expect(out.warnings).toEqual([]);
    expect(bts.sb.run('Parameter.value("PATCH%AMP%1", INTEGER1x7, 0)')).toBe(12);
  });

  it('set writes nothing when any change is invalid', async () => {
    const bts = sandboxBts();
    const h = createHandlers({ bts, launch: noLaunch });
    const r = await h.set({ changes: { 'amp.volume': 12, 'amp.gain': 500 } });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('amp.gain: 500 is out of range 0..100');
    expect(bts.sb.run('Parameter.value("PATCH%AMP%1", INTEGER1x7, 0)')).toBe(50);
  });

  it('set warns when no amp is connected', async () => {
    const h = createHandlers({ bts: sandboxBts(false), launch: noLaunch });
    const out = json(await h.set({ changes: { 'amp.volume': 20 } }));
    expect(out.warnings[0]).toContain('No KATANA is connected');
  });

  it('get shows only the active MOD type details', async () => {
    const h = createHandlers({ bts: sandboxBts(), launch: noLaunch });
    await h.set({ changes: { 'mod.type': 'PHASER' } });
    const keys = Object.keys(json(await h.get({ sections: ['mod'] })).mod);
    expect(keys.some(k => k.startsWith('mod.phaser_'))).toBe(true);
    expect(keys.some(k => k.startsWith('mod.2x2chorus_'))).toBe(false);
  });

  it('list_params shows ranges and options', async () => {
    const h = createHandlers({ bts: sandboxBts(), launch: noLaunch });
    const out = json(await h.listParams({ section: 'reverb' }));
    expect(out.find((p: { key: string }) => p.key === 'reverb.type').options).toContain('SPRING');
  });

  it('turns BtsUnavailableError into a readable tool error', async () => {
    const down: BtsClient = {
      status: async () => { throw new BtsUnavailableError('BOSS TONE STUDIO is not reachable'); },
      index: async () => [], read: async () => ({}), write: async () => ({}), connect: async () => ({ started: false }),
      controls: async () => ({ gafc: true, readings: [] }),
    };
    const r = await createHandlers({ bts: down, launch: noLaunch }).status();
    expect(r).toEqual({ isError: true, content: [{ type: 'text', text: 'BOSS TONE STUDIO is not reachable' }] });
  });

  it('launch connects the amp and reports it', async () => {
    const h = createHandlers({
      bts: sandboxBts(), launch: async () => ({ ok: true, message: 'BOSS TONE STUDIO started.' }),
      connect: async () => ({ ampConnected: true, patchName: 'DELI' }),
    });
    expect(json(await h.launch())).toEqual({ ok: true, message: 'BOSS TONE STUDIO started.', ampConnected: true, patchName: 'DELI' });
  });

  it('launch does not try to connect when BTS could not be opened', async () => {
    let tried = false;
    const h = createHandlers({
      bts: sandboxBts(), launch: async () => ({ ok: false, message: 'not found' }),
      connect: async () => { tried = true; return { ampConnected: false, patchName: '' }; },
    });
    expect((await h.launch()).isError).toBe(true);
    expect(tried).toBe(false);
  });

  it('controls reports assignments with a note and a warning when no amp is connected', async () => {
    const h = createHandlers({ bts: sandboxBts(false), launch: noLaunch });
    const out = json(await h.controls());
    expect(out.patch['amp.foot_sw_tip']).toBe('X');
    expect(out.system['gafc.panel']).toBe('X');
    expect(out.note).toContain('physically plugged in');
    expect(out.warnings[0]).toContain('No KATANA is connected');
  });
});
