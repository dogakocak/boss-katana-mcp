import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';

// One explicitly authorized read-only run. No write API is invoked.
if (process.argv[3] !== '--read-only-hardware-confirmed')
  throw new Error('Explicit read-only hardware-run flag required.');
const repo = path.resolve(process.argv[2]);
const evidence = path.dirname(fileURLToPath(import.meta.url));
const load = rel => import(pathToFileURL(path.join(repo, rel)).href);
const { Gen1MidiAdapter } = await load('dist/gen1/adapter.js');
const { createNativeMidiBackend } = await load('dist/gen1/native-midi.js');
const { GEN1_PARAMETERS } = await load('dist/gen1/parameters.js');
const { encodeRead, identityRequest } = await load('dist/gen1/protocol.js');
const hex = bytes => Array.from(bytes, n => n.toString(16).padStart(2, '0').toUpperCase()).join(' ');
const permittedTx = new Set([hex(identityRequest()), ...GEN1_PARAMETERS.map(p => hex(encodeRead(p.address, p.length)))]);
const auditFd = fs.openSync(path.join(evidence, 'midi-audit.jsonl'), 'wx');
const reportFd = fs.openSync(path.join(evidence, 'report.json'), 'wx');
let seq = 0, phase = 'preflight', txAttempts = 0, txReturned = 0, rxCount = 0, forbiddenAttempts = 0;
const started = performance.now();
const report = {
  startedAtUtc: new Date().toISOString(), timeZone: 'Europe/Istanbul',
  sourceRevision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(),
  nodeVersion: process.version, platform: process.platform, architecture: process.arch,
  mode: 'physical-read-only', hardwareWritesEnabled: false, automaticRetries: false,
  physicalModelBasis: 'User-specified KATANA-50 Gen 1; prior operator label confirmation. Inquiry only verifies observed Roland family/member.',
  firmware: 'unknown', discovery: null, connection: null, identityHex: null,
  reads: [], sentinelsMatched: null, failure: null, cleanupFailure: null, status: 'RUNNING',
  sourceHashes: Object.fromEntries(['src/gen1/adapter.ts', 'src/gen1/native-midi.ts', 'src/gen1/protocol.ts', 'src/gen1/parameters.ts',
    'dist/gen1/adapter.js', 'dist/gen1/native-midi.js', 'dist/gen1/protocol.js', 'dist/gen1/parameters.js']
    .map(rel => [rel, createHash('sha256').update(fs.readFileSync(path.join(repo, rel))).digest('hex')])),
};
function audit(event) {
  fs.writeSync(auditFd, JSON.stringify({ sequence: ++seq, timeUtc: new Date().toISOString(),
    elapsedMs: performance.now() - started, phase, ...event }) + '\n');
}
function saveReport() {
  const json = JSON.stringify(report, null, 2) + '\n';
  fs.ftruncateSync(reportFd, 0);
  fs.writeSync(reportFd, json, 0, 'utf8');
  fs.fsyncSync(reportFd);
}
const preflight = JSON.parse(fs.readFileSync(path.join(evidence, 'preflight.json'), 'utf8').replace(/^\uFEFF/, ''));
report.preflight = preflight;
saveReport();
let adapter;
try {
  if (preflight.devices.length !== 1 || preflight.devices[0].Status !== 'OK')
    throw new Error('Expected one present OK USB VID_0582/PID_01D8 device.');
  if (preflight.conflictingApps.length) throw new Error('Close Tone Studio/TONEFORGE before accessing MIDI.');
  const require = createRequire(path.join(repo, 'package.json'));
  report.midiPackageVersion = require('@julusian/midi/package.json').version;
  const midi = require('@julusian/midi');
  class AuditedInput extends midi.Input {
    constructor() {
      super();
      this.on('message', (delta, bytes) => {
        rxCount++;
        audit({ direction: 'RX', hex: hex(bytes), deltaTime: delta });
        if (phase === 'connect' && bytes[1] === 0x7e) report.identityHex = hex(bytes);
      });
    }
  }
  class ReadOnlyOutput extends midi.Output {
    sendMessage(bytes) {
      const messageHex = hex(bytes);
      if (!permittedTx.has(messageHex)) {
        forbiddenAttempts++;
        audit({ direction: 'BLOCKED_TX', hex: messageHex });
        throw new Error('Read-only sink rejected non-allowlisted message before native send.');
      }
      txAttempts++;
      audit({ direction: 'TX_ATTEMPT', hex: messageHex });
      const result = super.sendMessage(bytes);
      txReturned++;
      audit({ direction: 'TX_NATIVE_RETURNED', hex: messageHex });
      return result;
    }
  }
  const native = createNativeMidiBackend(async () => ({ Input: AuditedInput, Output: ReadOnlyOutput }));
  const readOnlyBackend = {
    list: () => native.list(),
    async open(input, output) {
      const connection = await native.open(input, output);
      return {
        exchange: (message, timeout) => connection.exchange(message, timeout),
        send: async () => { throw new Error('Physical write API unavailable in read-only test.'); },
        close: () => connection.close(),
      };
    },
  };
  adapter = new Gen1MidiAdapter(readOnlyBackend, {
    hardwareEnabled: true, modelConfirmed: true, allowWrites: false, lowMasterConfirmed: false, timeoutMs: 2000,
  });
  report.initialStatus = adapter.status();
  phase = 'discover';
  report.discovery = await adapter.discover();
  console.log('DISCOVERY', JSON.stringify(report.discovery));
  saveReport();
  phase = 'connect';
  report.connection = await adapter.connect();
  console.log('IDENTITY', report.identityHex, 'CONNECTION', JSON.stringify(report.connection));
  if (!report.identityHex) throw new Error('Identity RX not captured.');
  saveReport();
  const sentinelKeys = ['AmpType', 'PanelGain', 'SignalChainPattern'];
  const schedule = [...sentinelKeys.map(key => ({ key, sentinel: 'start' })),
    ...GEN1_PARAMETERS.filter(p => !sentinelKeys.includes(p.key)).map(p => ({ key: p.key, sentinel: null })),
    ...sentinelKeys.map(key => ({ key, sentinel: 'end' }))];
  for (const step of schedule) {
    const p = GEN1_PARAMETERS.find(p => p.key === step.key);
    phase = `read:${step.key}:${step.sentinel ?? 'single'}`;
    const begin = performance.now();
    const value = await adapter.read(step.key, p.research);
    const record = { ...step, address: hex(p.address), length: p.length, explicitResearch: p.research,
      raw: value.raw, elapsedMs: performance.now() - begin, result: 'PASS' };
    report.reads.push(record);
    console.log('READ', JSON.stringify(record));
    saveReport();
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  report.sentinelsMatched = sentinelKeys.every(key => report.reads.find(x => x.key === key && x.sentinel === 'start').raw ===
    report.reads.find(x => x.key === key && x.sentinel === 'end').raw);
  if (!report.sentinelsMatched) throw new Error('Sentinels changed during sequential read; not a stable snapshot.');
  report.status = 'PASS';
} catch (error) {
  report.failure = error instanceof Error ? error.message : String(error);
  report.status = 'FAIL';
  report.failedPhase = phase;
  console.error('STOP', phase, report.failure);
  process.exitCode = 1;
} finally {
  phase = 'disconnect';
  if (adapter) {
    report.beforeDisconnect = adapter.status();
    try { report.afterDisconnect = await adapter.disconnect(); }
    catch (error) { report.cleanupFailure = String(error); report.status = 'FAIL'; process.exitCode = 1; }
  }
  report.completedAtUtc = new Date().toISOString();
  report.elapsedMs = performance.now() - started;
  report.uniqueAddressesRead = new Set(report.reads.map(x => x.address)).size;
  report.skippedKeys = GEN1_PARAMETERS.filter(p => !report.reads.some(x => x.key === p.key)).map(p => p.key);
  report.txAttempts = txAttempts;
  report.txNativeReturned = txReturned;
  report.rxMessages = rxCount;
  report.forbiddenTxAttempts = forbiddenAttempts;
  report.auditRecords = seq;
  fs.fsyncSync(auditFd);
  fs.closeSync(auditFd);
  report.auditSha256 = createHash('sha256').update(fs.readFileSync(path.join(evidence, 'midi-audit.jsonl'))).digest('hex');
  report.runnerSha256 = createHash('sha256').update(fs.readFileSync(fileURLToPath(import.meta.url))).digest('hex');
  saveReport();
  fs.closeSync(reportFd);
  console.log('RESULT', JSON.stringify({ status: report.status, uniqueAddresses: report.uniqueAddressesRead,
    reads: report.reads.length, sentinelsMatched: report.sentinelsMatched, txAttempts, txReturned, rxCount,
    forbiddenAttempts, failure: report.failure, cleanupFailure: report.cleanupFailure, evidence }));
}
