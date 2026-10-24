import { expect, it } from 'vitest';
import { Gen1MidiAdapter, type Gen1Options, type MidiBackend } from '../src/gen1/adapter.js';
import { parameter, validateWrite } from '../src/gen1/parameters.js';
import { encodeData } from '../src/gen1/protocol.js';
import { METAL_TONE } from '../src/gen1/tones.js';
import { createGen1Handlers } from '../src/gen1/tools.js';

function rig(options: Gen1Options = {}) {
  const memory = new Map<string, number>();
  const addr = (key: string) => parameter(key, true).address.join(',');
  memory.set(addr('TemporaryLevel'), 49);
  for (const c of METAL_TONE) memory.set(addr(c.key), c.key === 'TemporaryAmpType' ? 11 : c.key.endsWith('On') ? 1 : 50);
  const sent: number[][] = [];
  let hook: ((message: readonly number[]) => void | Promise<void>) | undefined;
  const backend: MidiBackend = {
    list: async () => ({ inputs: ['KATANA'], outputs: ['KATANA'] }),
    open: async () => ({
      exchange: async message => {
        sent.push([...message]);
        if (message[1] === 0x7e) return [0xf0, 0x7e, 0, 6, 2, 0x41, 0x33, 3, 0, 0, 0, 0, 0, 0, 0xf7];
        return encodeData(message.slice(8, 12), [memory.get(message.slice(8, 12).join(',')) ?? 0]);
      },
      send: async message => {
        sent.push([...message]);
        if (hook) await hook(message);
        memory.set(message.slice(8, 12).join(','), message[12]);
      },
      close: async () => undefined,
    }),
  };
  return { adapter: new Gen1MidiAdapter(backend, { hardwareEnabled: true, modelConfirmed: true,
    allowWrites: true, lowMasterConfirmed: true, ...options }), sent, memory, addr,
    onSend: (fn: typeof hook) => { hook = fn; }, writes: () => sent.filter(m => m[7] === 0x12) };
}

it('uses temporary Brown=23 rather than panel Brown=4; rejects hidden and invalid algorithms', () => {
  expect(METAL_TONE.find(c => c.key === 'TemporaryAmpType')?.value).toBe(23);
  for (const code of [1, 8, 11, 24, 23]) expect(validateWrite('TemporaryAmpType', code)).toBeDefined();
  for (const code of [4, 5, 7, 27, 28, -1]) expect(() => validateWrite('TemporaryAmpType', code)).toThrow();
});
it.each(['TemporaryBass', 'TemporaryMiddle', 'TemporaryTreble', 'TemporaryPresence', 'NoiseSuppressorThreshold'])('bounds raw $0 by its editor definition', key => {
  expect(validateWrite(key, 100)).toBeDefined();
  for (const v of [-1, 101, 1.5, NaN]) expect(() => validateWrite(key, v)).toThrow();
});
it.each(['BoosterOn', 'ModOn', 'FxOn', 'DelayOn', 'ReverbOn', 'NoiseSuppressorOn'])('restricts $0 to boolean codes', key => {
  expect(validateWrite(key, 0)).toBeDefined(); expect(validateWrite(key, 1)).toBeDefined();
  expect(() => validateWrite(key, 2)).toThrow();
});
it('enforces the output ceiling and keeps all panel/system fields read-only', () => {
  expect(validateWrite('TemporaryLevel', 10)).toBeDefined();
  expect(() => validateWrite('TemporaryLevel', 11)).toThrow('ceiling');
  for (const key of ['Volume', 'PanelGain', 'AmpType', 'Bass', 'Reverb', '7F000104']) expect(() => validateWrite(key, 0)).toThrow();
});
it.each(['DelayLevel', 'ReverbLevel'])('bounds $0 writes independently of the full source range', async key => {
  expect(validateWrite(key, 0)).toBeDefined();
  expect(validateWrite(key, 50)).toBeDefined();
  for (const value of [-1, 51, 100, NaN, 1.5]) expect(() => validateWrite(key, value)).toThrow();
  const r = rig(); await r.adapter.connect();
  const h = createGen1Handlers(r.adapter);
  expect((await h.set({ key, value: 15 })).isError).toBeUndefined();
  expect(r.memory.get(r.addr(key))).toBe(15);
  expect(r.memory.get(r.addr('TemporaryLevel'))).toBe(49);
});
it('defaults to a zero-I/O plan even without hardware or write permissions', async () => {
  const r = rig({ hardwareEnabled: false, allowWrites: false });
  expect(await r.adapter.applyTone('metal')).toMatchObject({ dryRun: true, deviceIO: false });
  expect(r.sent).toHaveLength(0);
  const h = createGen1Handlers(r.adapter);
  expect((await h.tone({ name: 'metal', dryRun: false })).isError).toBe(true);
  expect(r.sent).toHaveLength(0);
});
it('rejects malformed plans before any MIDI including on an active session', async () => {
  const r = rig(); await r.adapter.connect(); const h = createGen1Handlers(r.adapter);
  for (const args of [{ name: 'other' }, { name: 'metal', outputLevel: 11 }, { name: 'metal', outputLevel: NaN }]) {
    expect((await h.tone({ ...args, dryRun: false })).isError).toBe(true);
  }
  expect(r.sent).toHaveLength(1);
});
it.each([{ allowWrites: false }, { lowMasterConfirmed: false }])('requires every write gate %j before pre-reads', async options => {
  const r = rig(options); await r.adapter.connect();
  await expect(r.adapter.applyTone('metal', 5, false)).rejects.toThrow('Writes disabled');
  expect(r.sent).toHaveLength(1);
});
it('backs up every original value, mutes first, verifies and finishes below the ceiling without saving', async () => {
  const r = rig(); await r.adapter.connect();
  expect(await r.adapter.applyTone('metal', 5, false)).toMatchObject({ before: { TemporaryLevel: 49, TemporaryAmpType: 11 },
    finalLevel: 5, readbackVerified: true, savedToPatch: false, audibleResultVerified: false });
  const writes = r.writes();
  expect(writes[0].slice(8, 13)).toEqual([0x60, 0, 0, 0x58, 0]);
  expect(writes.at(-1)?.slice(8, 13)).toEqual([0x60, 0, 0, 0x58, 5]);
  expect(writes.every(m => m[8] === 0x60 && m.length === 15)).toBe(true);
  expect(r.sent.findIndex(m => m[7] === 0x12)).toBe(16); // identity + 14 backup reads + fresh LEVEL read
  for (const c of METAL_TONE) expect(r.memory.get(r.addr(c.key))).toBe(c.value);
});
it.each([0, 2])('never raises a previously quiet LEVEL=%s', async previous => {
  const r = rig(); r.memory.set(r.addr('TemporaryLevel'), previous); await r.adapter.connect();
  expect(await r.adapter.applyTone('metal', 5, false)).toMatchObject({ finalLevel: previous });
});
it('rejects an invalid final preflight field before sending any DT1', async () => {
  const r = rig(); r.memory.set(r.addr('NoiseSuppressorThreshold'), 101); await r.adapter.connect();
  await expect(r.adapter.applyTone('metal', 5, false)).rejects.toThrow('preflight');
  expect(r.writes()).toHaveLength(0); expect(r.adapter.status()).toMatchObject({ locked: true });
});
it('does not interleave a queued MCP read/write with the tone sequence', async () => {
  const r = rig(); await r.adapter.connect();
  await Promise.all([r.adapter.applyTone('metal', 5, false), r.adapter.write('TemporaryGain', 80)]);
  expect(r.memory.get(r.addr('TemporaryGain'))).toBe(80);
  expect(r.writes().at(-2)?.slice(8, 13)).toEqual([0x60, 0, 0, 0x58, 5]);
  expect(r.writes().at(-1)?.slice(8, 13)).toEqual([0x60, 0, 0, 0x52, 80]);
});
it('records completed steps and original values on partial failure; no retry, rollback or unmute', async () => {
  const r = rig(); await r.adapter.connect();
  r.onSend(m => { if (m[11] === 0x54) throw new Error('unplugged'); });
  const h = createGen1Handlers(r.adapter);
  const result = await h.tone({ name: 'metal', dryRun: false });
  expect(result.isError).toBe(true);
  expect(result.content[0].text).toContain('"stage":"TemporaryBass"');
  expect(result.content[0].text).toContain('"TemporaryLevel":49');
  expect(r.memory.get(r.addr('TemporaryLevel'))).toBe(0);
  const count = r.writes().length;
  await expect(r.adapter.applyTone('metal', 5, false)).rejects.toThrow('locked');
  expect(r.writes()).toHaveLength(count);
});
it('detects model-switch LEVEL side effects and stops before further changes', async () => {
  const r = rig(); await r.adapter.connect();
  r.onSend(m => { if (m[11] === 0x51) r.memory.set(r.addr('TemporaryLevel'), 80); });
  await expect(r.adapter.applyTone('metal', 5, false)).rejects.toThrow('LEVEL changed');
  expect(r.writes()).toHaveLength(2);
});
it('times out an uncertain send without retransmission or further device I/O', async () => {
  const r = rig({ timeoutMs: 100 }); await r.adapter.connect();
  r.onSend(() => new Promise(() => undefined));
  await expect(r.adapter.applyTone('metal', 5, false)).rejects.toThrow('write timeout');
  expect(r.writes()).toHaveLength(1);
  expect(r.adapter.status()).toMatchObject({ locked: true, connected: false });
});
it('catches a later write resetting an earlier field before raising LEVEL', async () => {
  const r = rig(); await r.adapter.connect();
  r.onSend(m => { if (m[11] === 0x57) r.memory.set(r.addr('TemporaryGain'), 84); });
  await expect(r.adapter.applyTone('metal', 5, false)).rejects.toThrow('Final readback mismatch');
  expect(r.memory.get(r.addr('TemporaryLevel'))).toBe(0);
  expect(r.writes().filter(m => m[11] === 0x58)).toHaveLength(1);
});
