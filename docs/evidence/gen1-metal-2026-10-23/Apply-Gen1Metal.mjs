// Explicit manual command, never an automated test. Leaves approved tone in place.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';

const [folderArg, approvalFlag, masterFlag] = process.argv.slice(2);
if (!folderArg || approvalFlag !== '--write-approved' || masterFlag !== '--low-master-confirmed')
  throw new Error('Usage: node scripts/Apply-Gen1Metal.mjs NEW_EVIDENCE_DIR --write-approved --low-master-confirmed. Requires actual operator approval and low physical MASTER.');
const repo = fileURLToPath(new URL('../', import.meta.url));
const folder = path.resolve(folderArg);
fs.mkdirSync(folder); // Never overwrite an earlier trial.
const digest = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const report = { status: 'RUNNING', startedAtUtc: new Date().toISOString(), mode: 'operator-approved-metal-MCP-stdio',
  node: process.version, sourceRevision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(),
  sourceFiles: {}, operatorAttestation: { writesApproved: true, physicalMasterLow: true, modelLabel: 'KATANA-50 Gen 1' },
  calls: [], failure: null, cleanupFailure: null, stderr: '',
  environment: { KATANA_BACKEND: 'gen1', KATANA_GEN1_ENABLE_HARDWARE: '1', KATANA_GEN1_MODEL_CONFIRMED: '1',
    KATANA_GEN1_ALLOW_WRITES: '1', KATANA_GEN1_LOW_MASTER_CONFIRMED: '1' } };
for (const f of ['src/gen1/adapter.ts', 'src/gen1/parameters.ts', 'src/gen1/tones.ts', 'src/gen1/tools.ts',
  'src/gen1/protocol.ts', 'src/gen1/native-midi.ts', 'src/backend.ts', 'src/index.ts',
  'dist/gen1/adapter.js', 'dist/gen1/parameters.js', 'dist/gen1/tones.js', 'dist/gen1/tools.js',
  'dist/gen1/protocol.js', 'dist/gen1/native-midi.js', 'dist/backend.js', 'dist/index.js',
  'scripts/Apply-Gen1Metal.mjs', 'scripts/Gen1MetalGuard.mjs']) report.sourceFiles[f] = digest(path.join(repo, f));
const fd = fs.openSync(path.join(folder, 'mcp-report.json'), 'wx');
function save() {
  fs.ftruncateSync(fd, 0); fs.writeSync(fd, JSON.stringify(report, null, 2) + '\n', 0, 'utf8'); fs.fsyncSync(fd);
}
const auditPath = path.join(folder, 'midi-audit.jsonl');
const transport = new StdioClientTransport({ command: process.execPath,
  args: ['--import', pathToFileURL(path.join(repo, 'scripts/Gen1MetalGuard.mjs')).href, path.join(repo, 'dist/index.js')],
  cwd: repo, stderr: 'pipe', env: { ...getDefaultEnvironment(), NODE_OPTIONS: '', ...report.environment,
    KATANA_METAL_AUDIT: auditPath } });
transport.stderr?.on('data', data => { report.stderr = (report.stderr + String(data)).slice(-16000); });
const client = new Client({ name: 'operator-approved-metal-trial', version: '1' });
let initialized = false;
async function call(name, args = {}) {
  const record = { name, arguments: args, startedAtUtc: new Date().toISOString() };
  report.calls.push(record); save();
  record.result = await client.callTool({ name, arguments: args }, undefined, { timeout: 180000 });
  record.finishedAtUtc = new Date().toISOString(); save();
  if (record.result.isError) throw new Error(name + ': ' + record.result.content.filter(c => c.type === 'text').map(c => c.text).join('\n'));
  return JSON.parse(record.result.content.find(c => c.type === 'text').text);
}
try {
  save(); await client.connect(transport); initialized = true;
  report.tools = (await client.listTools()).tools.map(t => t.name);
  report.initialStatus = await call('katana_gen1_status');
  if (!report.initialStatus.writesEnabled || report.initialStatus.connected) throw new Error('Unexpected startup gates');
  report.preview = await call('katana_gen1_apply_tone', { name: 'metal' });
  if (!report.preview.dryRun || report.preview.deviceIO) throw new Error('Unsafe preview');
  report.discovery = await call('katana_gen1_discover');
  console.log('DISCOVERY', JSON.stringify(report.discovery));
  report.connection = await call('katana_gen1_connect');
  console.log('IDENTITY MATCHED', JSON.stringify(report.connection));
  report.application = await call('katana_gen1_apply_tone', { name: 'metal', outputLevel: 5, dryRun: false });
  console.log('APPLIED', JSON.stringify(report.application));
  report.status = 'PASS';
} catch (e) { report.status = 'FAIL'; report.failure = String(e); process.exitCode = 1; }
finally {
  if (initialized) {
    try { report.disconnected = await call('katana_gen1_disconnect'); }
    catch (e) { report.cleanupFailure = String(e); report.status = 'FAIL'; process.exitCode = 1; }
  }
  try { await client.close(); }
  catch (e) { report.cleanupFailure = String(e); report.status = 'FAIL'; process.exitCode = 1; }
  if (fs.existsSync(auditPath)) {
    const audit = fs.readFileSync(auditPath, 'utf8').trim().split('\n').map(JSON.parse);
    const sent = audit.filter(e => e.direction === 'TX_NATIVE_RETURNED');
    report.audit = { sha256: digest(auditPath), sent: sent.length,
      identity: sent.filter(e => e.kind === 'identity').length, rq1: sent.filter(e => e.kind === 'read').length,
      dt1: sent.filter(e => e.kind === 'write').length, blocked: audit.filter(e => e.direction === 'BLOCKED_TX').length,
      received: audit.filter(e => e.direction === 'RX').length };
  }
  report.completedAtUtc = new Date().toISOString(); save(); fs.closeSync(fd);
  console.log('RESULT', JSON.stringify({ status: report.status, failure: report.failure, cleanupFailure: report.cleanupFailure,
    finalLevel: report.application?.finalLevel, audit: report.audit, folder }));
}
