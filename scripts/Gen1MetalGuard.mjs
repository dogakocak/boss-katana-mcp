// Manual hardware harness only; never loaded by normal server startup or npm tests.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { GEN1_PARAMETERS } from '../dist/gen1/parameters.js';
import { METAL_TONE } from '../dist/gen1/tones.js';
import { decodeData, encodeData, encodeRead, identityRequest } from '../dist/gen1/protocol.js';

if (!process.env.KATANA_METAL_AUDIT || process.env.KATANA_GEN1_ALLOW_WRITES !== '1' ||
    process.env.KATANA_GEN1_LOW_MASTER_CONFIRMED !== '1') throw new Error('Manual write gates missing');
const hex = data => Array.from(data, n => n.toString(16).padStart(2, '0').toUpperCase()).join(' ');
const allowed = new Map([[hex(identityRequest()), { key: 'Identity', kind: 'identity' }]]);
for (const key of [...METAL_TONE.map(c => c.key), 'TemporaryLevel']) {
  const p = GEN1_PARAMETERS.find(p => p.key === key);
  allowed.set(hex(encodeRead(p.address, 1)), { key, kind: 'read' });
  for (const value of key === 'TemporaryLevel' ? [0, 1, 2, 3, 4, 5] : [METAL_TONE.find(c => c.key === key).value])
    allowed.set(hex(encodeData(p.address, [value])), { key, kind: 'write', value });
}
const fd = fs.openSync(process.env.KATANA_METAL_AUDIT, 'wx');
let sequence = 0;
const counts = new Map();
const observed = new Map();
const levelParameter = GEN1_PARAMETERS.find(p => p.key === 'TemporaryLevel');
function log(event) {
  fs.writeSync(fd, JSON.stringify({ sequence: ++sequence, timeUtc: new Date().toISOString(), ...event }) + '\n');
  fs.fsyncSync(fd);
}
const require = createRequire(import.meta.url);
const midi = require('@julusian/midi');
const send = midi.Output.prototype.sendMessage;
midi.Output.prototype.sendMessage = function (data) {
  const frame = hex(data), rule = allowed.get(frame);
  const counter = rule && `${rule.kind}:${rule.key}`;
  const count = (counts.get(counter) ?? 0) + 1;
  const maximum = rule?.kind === 'write' ? (rule.key === 'TemporaryLevel' ? 2 : 1)
    : rule?.kind === 'identity' ? 1 : rule?.key === 'TemporaryLevel' ? 32 : 8;
  const unsafeWrite = rule?.kind === 'write' && (rule.key !== 'TemporaryLevel'
    ? observed.get('TemporaryLevel') !== 0
    : rule.value > 0 && !METAL_TONE.every(c => observed.get(c.key) === c.value));
  if (!rule || count > maximum || unsafeWrite) {
    log({ direction: 'BLOCKED_TX', hex: frame });
    throw new Error('Unapproved or repeated frame blocked before native send');
  }
  counts.set(counter, count);
  log({ direction: 'TX_ATTEMPT', ...rule, hex: frame });
  const result = send.call(this, data);
  log({ direction: 'TX_NATIVE_RETURNED', ...rule, hex: frame });
  return result;
};
const emit = midi.Input.prototype.emit;
midi.Input.prototype.emit = function (event, ...args) {
  if (event === 'message') {
    log({ direction: 'RX', hex: hex(args[1]) });
    for (const key of [...METAL_TONE.map(c => c.key), levelParameter.key]) {
      const p = GEN1_PARAMETERS.find(p => p.key === key);
      try { observed.set(key, decodeData(args[1], p.address, 1)); } catch { /* Adapter validates unexpected data. */ }
    }
  }
  return emit.call(this, event, ...args);
};
log({ direction: 'GUARD_READY', mode: 'approved-metal-only', allowedFrames: allowed.size });
process.once('exit', () => { fs.fsyncSync(fd); fs.closeSync(fd); });
