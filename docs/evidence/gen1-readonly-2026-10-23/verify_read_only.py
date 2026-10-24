"""Offline, independent verification of the new Node adapter hardware trace. No MIDI imports."""
from pathlib import Path
from collections import Counter, defaultdict
import hashlib
import json
import sys

root = Path(__file__).resolve().parent
report = json.loads((root / 'report.json').read_text(encoding='utf-8'))
audit_bytes = (root / 'midi-audit.jsonl').read_bytes()
events = [json.loads(line) for line in audit_bytes.decode('utf-8').splitlines()]
expected = {
    'AmpType': ('00 00 04 20', 1), 'PanelGain': ('00 00 04 21', 1),
    'Volume': ('00 00 04 22', 1), 'Bass': ('00 00 04 23', 1),
    'Middle': ('00 00 04 24', 1), 'Treble': ('00 00 04 25', 1),
    'Presence': ('00 00 04 26', 1), 'BoosterMod': ('00 00 04 27', 1),
    'DelayFx': ('00 00 04 28', 1), 'Reverb': ('00 00 04 29', 1),
    'TemporaryGain': ('60 00 00 52', 1), 'DelayTime': ('60 00 05 62', 2),
    'DelayFeedback': ('60 00 05 64', 1), 'ReverbLevel': ('60 00 06 18', 1),
    'NoiseSuppressorOn': ('60 00 06 63', 1), 'NoiseSuppressorThreshold': ('60 00 06 64', 1),
    'EqLowGain': ('60 00 01 32', 1), 'Fx1PhaserRate': ('60 00 02 76', 1),
    'Fx1PhaserDepth': ('60 00 02 77', 1), 'SignalChainPattern': ('60 00 12 00', 1),
}

def demand(condition, explanation):
    if not condition:
        raise ValueError(explanation)

def packet(text):
    data = bytes.fromhex(text)
    demand(data[0] == 0xF0 and data[-1] == 0xF7, 'SysEx framing')
    demand(all(b < 128 for b in data[1:-1]), '7-bit payload')
    return data

demand(report['status'] == 'PASS' and report['failure'] is None and report['cleanupFailure'] is None, 'Run status')
demand(report['hardwareWritesEnabled'] is False and report['connection']['writesEnabled'] is False, 'Write gates')
demand(report['afterDisconnect']['connected'] is False and report['afterDisconnect']['locked'] is False, 'Clean disconnect')
demand(report['auditSha256'] == hashlib.sha256(audit_bytes).hexdigest(), 'Audit SHA-256')
demand(report['runnerSha256'] == hashlib.sha256((root / 'read-only-probe.mjs').read_bytes()).hexdigest(), 'Runner SHA-256')
demand([e['sequence'] for e in events] == list(range(1, len(events)+1)), 'Audit sequence')
demand(all(e['direction'] in ('TX_ATTEMPT', 'TX_NATIVE_RETURNED', 'RX') for e in events), 'No blocked/unexpected send event')
grouped = defaultdict(list)
for event in events:
    grouped[event['phase']].append(event)

connect = grouped['connect']
demand([e['direction'] for e in connect] == ['TX_ATTEMPT', 'TX_NATIVE_RETURNED', 'RX'], 'Identity transaction order')
inquiry = bytes.fromhex('F0 7E 7F 06 01 F7')
demand(packet(connect[0]['hex']) == inquiry and packet(connect[1]['hex']) == inquiry, 'Identity inquiry only')
identity = packet(connect[2]['hex'])
demand(len(identity) == 15 and identity[:10] == bytes.fromhex('F0 7E 00 06 02 41 33 03 00 00'), 'Observed identity family/member')
demand(report['identityHex'] == connect[2]['hex'], 'Reported identity')

read_values = {}
for read in report['reads']:
    key = read['key']
    demand(key in expected and read['result'] == 'PASS', 'Permitted read key')
    address_text, length = expected[key]
    address = bytes.fromhex(address_text)
    demand(read['address'] == address_text and read['length'] == length, 'Reported read address/length')
    phase = f"read:{key}:{read['sentinel'] or 'single'}"
    transaction = grouped[phase]
    demand([e['direction'] for e in transaction] == ['TX_ATTEMPT', 'TX_NATIVE_RETURNED', 'RX'], f'{phase}: transaction order')
    tx = packet(transaction[0]['hex'])
    demand(tx == packet(transaction[1]['hex']), 'Native-returned TX equals planned TX')
    demand(len(tx) == 18 and tx[:8] == bytes.fromhex('F0 41 00 00 00 00 33 11'), 'RQ1 only; no DT1/write command')
    demand(tx[8:12] == address and tx[12:16] == bytes([0, 0, 0, length]), 'Exact allowlisted RQ1 address/size')
    demand(sum(tx[8:-1]) % 128 == 0, 'RQ1 checksum')
    rx = packet(transaction[2]['hex'])
    demand(len(rx) == 14+length and rx[:8] == bytes.fromhex('F0 41 00 00 00 00 33 12'), 'DT1 response framing/model/device/size')
    demand(rx[8:12] == address and sum(rx[8:-1]) % 128 == 0, 'Response address/checksum')
    value = 0
    for b in rx[12:-2]:
        value = value*128+b
    demand(value == read['raw'], 'Independent raw value decoding')
    if key in read_values:
        demand(value == read_values[key], 'Sentinel value unchanged')
    read_values[key] = value

demand(set(read_values) == set(expected), 'All 20 addresses read')
demand(len(report['reads']) == 23 and report['sentinelsMatched'] is True, '23 read transactions and sentinels')
demand(Counter(r['key'] for r in report['reads']) == Counter({k: 2 if k in ('AmpType', 'PanelGain', 'SignalChainPattern') else 1 for k in expected}), 'Sentinel schedule')
counts = Counter(e['direction'] for e in events)
demand(counts == {'TX_ATTEMPT': 24, 'TX_NATIVE_RETURNED': 24, 'RX': 24}, 'Exactly 24 read-only transactions')
demand(report['forbiddenTxAttempts'] == 0 and report['txNativeReturned'] == 24 and report['rxMessages'] == 24, 'Reported transmission counts')
result = {
    'result': 'PASS', 'mode': 'offline-independent-hardware-trace-verification',
    'verifiedUniqueAddresses': 20, 'verifiedReadTransactions': 23,
    'identityQueriesSent': 1, 'rq1QueriesSent': 23, 'dt1WritesSent': 0,
    'otherCommandsSent': 0, 'receivedMessages': 24, 'auditRecords': len(events),
    'sentinelsMatched': True, 'cleanDisconnect': True,
    'sourceRevision': report['sourceRevision'], 'auditSha256': report['auditSha256'],
    'reportSha256': hashlib.sha256((root/'report.json').read_bytes()).hexdigest(),
    'scope': 'This device and session only; no firmware, full ranges, audible effects, persistence, or write compatibility established.',
    'rawValues': read_values,
}
with (root / 'verification.json').open('x', encoding='utf-8') as output:
    json.dump(result, output, indent=2)
    output.write('\n')
print(json.dumps(result, indent=2))
