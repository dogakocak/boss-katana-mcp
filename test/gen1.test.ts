import { describe, expect, it } from 'vitest';
import { Gen1MidiAdapter, selectPorts, type Gen1Options, type MidiBackend, type MidiConnection } from '../src/gen1/adapter.js';
import { checksum, decodeData, encodeData, encodeRead, identityRequest, verifyIdentity } from '../src/gen1/protocol.js';
import { GEN1_PARAMETERS, parameter, validateWrite } from '../src/gen1/parameters.js';
import { createGen1Handlers } from '../src/gen1/tools.js';

const identity = [0xf0, 0x7e, 0, 6, 2, 0x41, 0x33, 3, 0, 0, 0, 0, 0, 0, 0xf7];
const gain = [0x60, 0, 0, 0x52];

function rig(options: Gen1Options = {}) {
  const sent: number[][] = [];
  let raw = 96, exchanges = 0, closes = 0, opens = 0, lists = 0;
  let active = 0, maxActive = 0;
  let response: ((m: readonly number[]) => Promise<number[]>) | undefined;
  const connection: MidiConnection = {
    async exchange(message) {
      sent.push([...message]); exchanges++; active++; maxActive = Math.max(maxActive, active);
      try {
        await Promise.resolve();
        if (response) return await response(message);
        if (message[1] === 0x7e) return [...identity];
        return encodeData(message.slice(8, 12), message[15] === 2 ? [2, 0x56] : [raw]);
      } finally { active--; }
    },
    async send(message) { sent.push([...message]); raw = message[12]; },
    async close() { closes++; },
  };
  const backend: MidiBackend = {
    async list() { lists++; return { inputs: ['other', 'KATANA'], outputs: ['KATANA'] }; },
    async open() { opens++; return connection; },
  };
  const adapter = new Gen1MidiAdapter(backend, { hardwareEnabled: true, modelConfirmed: true, ...options });
  return { adapter, sent, backend,
    stats: () => ({ exchanges, closes, opens, lists, maxActive }),
    respond: (fn?: typeof response) => { response = fn; },
    setRaw: (n: number) => { raw = n; },
  };
}

describe('Gen 1 protocol (offline observed vectors)', () => {
  it('encodes the captured temporary gain RQ1 and DT1', () => {
    expect(encodeRead(gain, 1)).toEqual([0xf0, 0x41, 0, 0, 0, 0, 0x33, 0x11, 0x60, 0, 0, 0x52, 0, 0, 0, 1, 0x4d, 0xf7]);
    expect(encodeData(gain, [95])).toEqual([0xf0, 0x41, 0, 0, 0, 0, 0x33, 0x12, 0x60, 0, 0, 0x52, 95, 0x6f, 0xf7]);
    expect(identityRequest()).toEqual([0xf0, 0x7e, 0x7f, 6, 1, 0xf7]);
  });
  it.each([[[], 0], [[0], 0], [[127, 1], 0], [[0x60, 0, 0, 0x52, 1], 0x4d]] as const)('checksum %j', (bytes, expected) => {
    expect(checksum(bytes)).toBe(expected);
  });
  it.each([-1, 128, 1.5, NaN, Infinity])('rejects invalid byte %s', n => {
    expect(() => checksum([n])).toThrow();
    expect(() => encodeData(gain, [n])).toThrow();
  });
  it.each([0, 3, 1.5, NaN])('rejects unsupported read size %s', n => expect(() => encodeRead(gain, n)).toThrow());
  it('decodes the independently observed two-byte DelayTime=342', () => {
    // This is a recorded vector, not generated with the encoder under test.
    expect(decodeData([0xf0, 0x41, 0, 0, 0, 0, 0x33, 0x12, 0x60, 0, 5, 0x62, 2, 0x56, 0x61, 0xf7], [0x60, 0, 5, 0x62], 2)).toBe(342);
  });
  it.each([0, 1, 2, 6, 7, 8, 12, 13, 14])('rejects mutated DT1 byte %s', i => {
    const message = encodeData(gain, [96]); message[i] ^= 1;
    expect(() => decodeData(message, gain, 1)).toThrow();
  });
  it('rejects wrong length, extra/truncated and 8-bit data with a matching modulo checksum', () => {
    const msg = encodeData(gain, [96]);
    expect(() => decodeData(msg.slice(0, -1), gain, 1)).toThrow();
    expect(() => decodeData([...msg, 0], gain, 1)).toThrow();
    msg[12] += 128;
    expect(() => decodeData(msg, gain, 1)).toThrow();
  });
  it('verifies only the observed family/member, permits unknown revision bytes', () => {
    verifyIdentity(identity);
    const revision = [...identity]; revision[10] = 12; verifyIdentity(revision);
    for (const i of [0, 2, 5, 6, 7, 8, 9, 14]) {
      const other = [...identity]; other[i] ^= 1;
      expect(() => verifyIdentity(other)).toThrow('Unsupported');
    }
  });
});

describe('Gen 1 evidence and safety policy', () => {
  it('keeps panel/research reads and adds isolated source-backed temporary controls', () => {
    expect(GEN1_PARAMETERS).toHaveLength(32);
    expect(GEN1_PARAMETERS.filter(p => !p.research)).toHaveLength(23);
    expect(() => parameter('DelayTime')).toThrow('explicitResearch');
    expect(parameter('DelayTime', true).length).toBe(2);
    expect(() => parameter('PRMID_PATCH_AMP_VOLUME')).toThrow('Unknown');
    expect(Object.isFrozen(parameter('Volume').address)).toBe(true);
  });
  it.each(GEN1_PARAMETERS.filter(p => !p.rawRange))('rejects all writes to $key', p => {
    expect(() => validateWrite(p.key, 0)).toThrow('read-only');
  });
  it.each([-1, 121, 127, 128, NaN, 95.5])('rejects out-of-source-range gain %s', n => expect(() => validateWrite('TemporaryGain', n)).toThrow());
  it('accepts editor-backed raw gain range, including the previously observed pair', () => {
    expect(validateWrite('TemporaryGain', 0).key).toBe('TemporaryGain');
    expect(validateWrite('TemporaryGain', 120).key).toBe('TemporaryGain');
    expect(validateWrite('TemporaryGain', 95).key).toBe('TemporaryGain');
    expect(validateWrite('TemporaryGain', 96).key).toBe('TemporaryGain');
  });
  it.each([0, 99, 10001, NaN])('rejects invalid timeout %s', timeoutMs => expect(() => rig({ timeoutMs })).toThrow());
});

describe('Gen 1 mock integration (no native module or hardware)', () => {
  it('does zero backend I/O by default, including status/list and blocked connect/discovery', async () => {
    const r = rig({ hardwareEnabled: false }); const h = createGen1Handlers(r.adapter);
    expect((await h.status()).isError).toBeUndefined();
    expect((await h.list()).isError).toBeUndefined();
    expect((await h.discover()).isError).toBe(true);
    expect((await h.connect()).isError).toBe(true);
    expect(r.stats()).toMatchObject({ lists: 0, opens: 0, exchanges: 0 });
  });
  it('requires physical label confirmation before identity inquiry', async () => {
    const r = rig({ modelConfirmed: false }); await expect(r.adapter.connect()).rejects.toThrow('physical');
    expect(r.stats().lists).toBe(0);
  });
  it('discovers without opening ports or transmitting', async () => {
    const r = rig(); expect(await r.adapter.discover()).toMatchObject({ modelVerified: false });
    expect(r.stats()).toMatchObject({ opens: 0, exchanges: 0 });
  });
  it.each([
    { inputs: [], outputs: [] }, { inputs: ['KATANA'], outputs: [] },
    { inputs: ['KATANA', 'katana'], outputs: ['KATANA'] },
    { inputs: ['KATANA'], outputs: ['KATANA', 'KATANA'] },
    { inputs: ['KATANA-50 Gen 3'], outputs: ['KATANA'] },
  ])('rejects disconnected/ambiguous/non-exact ports %j', ports => expect(() => selectPorts(ports)).toThrow());
  it('rejects unsupported model before parameter I/O and closes resources', async () => {
    const r = rig(); r.respond(async () => { const m = [...identity]; m[6]++; return m; });
    await expect(r.adapter.connect()).rejects.toThrow('Unsupported');
    expect(r.sent).toHaveLength(1); expect(r.stats().closes).toBe(1);
    await expect(r.adapter.connect()).rejects.toThrow('locked');
  });
  it('reads all evidenced addresses sequentially and explicitly opts into research', async () => {
    const r = rig(); await r.adapter.connect();
    for (const p of GEN1_PARAMETERS) {
      expect(await r.adapter.read(p.key, p.research)).toMatchObject({ key: p.key, raw: p.length === 2 ? 342 : 96 });
    }
    expect(r.sent.filter(m => m[7] === 0x12)).toHaveLength(0);
    await r.adapter.disconnect();
  });
  it('serializes concurrent reads and a write/readback transaction', async () => {
    const r = rig({ allowWrites: true, lowMasterConfirmed: true }); await r.adapter.connect();
    const result = await Promise.all([r.adapter.read('Volume'), r.adapter.write('TemporaryGain', 95), r.adapter.read('TemporaryGain')]);
    expect(result[1]).toMatchObject({ before: 96, raw: 95, readbackVerified: true });
    expect(result[2]).toMatchObject({ raw: 95 });
    expect(r.stats().maxActive).toBe(1);
    expect(r.sent.slice(-4).map(m => m[7])).toEqual([0x11, 0x12, 0x11, 0x11]);
  });
  it.each([{ allowWrites: false, lowMasterConfirmed: true }, { allowWrites: true, lowMasterConfirmed: false }])('requires both write gates %j', async options => {
    const r = rig(options); await r.adapter.connect();
    await expect(r.adapter.write('TemporaryGain', 95)).rejects.toThrow('Writes disabled');
    expect(r.sent).toHaveLength(1);
  });
  it('rejects invalid requests through MCP without I/O', async () => {
    const r = rig(); const h = createGen1Handlers(r.adapter);
    expect((await h.set({ key: 'Volume', value: 0 })).isError).toBe(true);
    expect((await h.read({ key: 'DelayTime' })).isError).toBe(true);
    expect(r.stats().exchanges).toBe(0);
  });
  it('requires connection and supports explicit reconnect after clean disconnect', async () => {
    const r = rig(); await expect(r.adapter.read('Volume')).rejects.toThrow('disconnected');
    await r.adapter.connect(); await r.adapter.disconnect(); await r.adapter.connect();
    expect(r.stats().opens).toBe(2);
  });
  it('locks on timeout, rejects queued requests and does not reconnect or retry after a late reply', async () => {
    const r = rig({ timeoutMs: 100 }); await r.adapter.connect();
    let late!: (data: number[]) => void;
    r.respond(() => new Promise(resolve => { late = resolve; }));
    const results = await Promise.allSettled([r.adapter.read('Volume'), r.adapter.read('Volume')]);
    expect(results.every(x => x.status === 'rejected')).toBe(true);
    late(encodeData(parameter('Volume').address, [49]));
    await r.adapter.disconnect();
    await expect(r.adapter.connect()).rejects.toThrow('locked');
    expect(r.stats()).toMatchObject({ opens: 1, exchanges: 2, closes: 1 });
  });
  it('locks on unplug/send error and never attempts write retry', async () => {
    const r = rig(); await r.adapter.connect(); r.respond(async () => { throw new Error('Device disconnected'); });
    await expect(r.adapter.read('Volume')).rejects.toThrow('Device disconnected');
    expect(r.adapter.status()).toMatchObject({ connected: false, locked: true });
  });
  it('does not send DT1 when pre-read gain is outside the source-backed range', async () => {
    const r = rig({ allowWrites: true, lowMasterConfirmed: true }); await r.adapter.connect(); r.setRaw(121);
    await expect(r.adapter.write('TemporaryGain', 95)).rejects.toThrow('no DT1');
    expect(r.sent.filter(m => m[7] === 0x12)).toHaveLength(0);
  });
  it('locks after readback mismatch without rollback or replay', async () => {
    const r = rig({ allowWrites: true, lowMasterConfirmed: true }); await r.adapter.connect();
    r.respond(async m => encodeData(m.slice(8, 12), [96]));
    await expect(r.adapter.write('TemporaryGain', 95)).rejects.toThrow('Readback mismatch');
    expect(r.sent.filter(m => m[7] === 0x12)).toHaveLength(1);
    await expect(r.adapter.write('TemporaryGain', 95)).rejects.toThrow('locked');
  });
  it('does not issue DT1 for an unchanged value, still checks readback', async () => {
    const r = rig({ allowWrites: true, lowMasterConfirmed: true }); await r.adapter.connect();
    expect(await r.adapter.write('TemporaryGain', 96)).toMatchObject({ raw: 96, readbackVerified: true });
    expect(r.sent.filter(m => m[7] === 0x12)).toHaveLength(0);
  });
  it('locks and closes after wrong DT1/checksum', async () => {
    const r = rig(); await r.adapter.connect();
    r.respond(async m => { const msg = encodeData(m.slice(8, 12), [49]); msg[13] ^= 1; return msg; });
    await expect(r.adapter.read('Volume')).rejects.toThrow('checksum');
    expect(r.stats().closes).toBe(1);
  });
  it('does not reconnect after native cleanup fails', async () => {
    const r = rig();
    r.backend.open = async () => ({
      exchange: async () => [...identity], send: async () => undefined,
      close: async () => { throw new Error('native close failed'); },
    });
    await r.adapter.connect();
    await expect(r.adapter.disconnect()).rejects.toThrow('native close failed');
    await expect(r.adapter.connect()).rejects.toThrow('locked');
  });
});
