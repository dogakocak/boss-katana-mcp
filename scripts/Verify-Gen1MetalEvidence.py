"""Independently verify the captured metal session without importing MIDI/TS.

Checks native-boundary TX/RX bytes, Roland checksum, exact approved schedule,
original/target values and MCP results. Does not establish acoustic behavior.
"""
import argparse
import hashlib
import json
from pathlib import Path


TARGETS = [
    ('TemporaryAmpType', (0x60, 0, 0, 0x51), 23),
    ('BoosterOn', (0x60, 0, 0, 0x30), 0),
    ('ModOn', (0x60, 0, 1, 0x40), 0),
    ('FxOn', (0x60, 0, 3, 0x4c), 0),
    ('DelayOn', (0x60, 0, 5, 0x60), 0),
    ('ReverbOn', (0x60, 0, 6, 0x10), 0),
    ('TemporaryGain', (0x60, 0, 0, 0x52), 85),
    ('TemporaryBass', (0x60, 0, 0, 0x54), 60),
    ('TemporaryMiddle', (0x60, 0, 0, 0x55), 40),
    ('TemporaryTreble', (0x60, 0, 0, 0x56), 65),
    ('TemporaryPresence', (0x60, 0, 0, 0x57), 45),
    ('NoiseSuppressorOn', (0x60, 0, 6, 0x63), 1),
    ('NoiseSuppressorThreshold', (0x60, 0, 6, 0x64), 55),
]
LEVEL = ('TemporaryLevel', (0x60, 0, 0, 0x58), 5)


def require(condition, message):
    if not condition:
        raise ValueError(message)


def verify_bytes(report, audit_bytes):
    require(report['status'] == 'PASS' and report['failure'] is None and report['cleanupFailure'] is None, 'MCP trial failed')
    require(report['operatorAttestation']['writesApproved'] and report['operatorAttestation']['physicalMasterLow'], 'Missing operator attestation')
    require(report['audit']['sha256'] == hashlib.sha256(audit_bytes).hexdigest(), 'Audit hash mismatch')
    rows = [json.loads(line) for line in audit_bytes.splitlines()]
    addresses = {address: key for key, address, _ in [LEVEL, *TARGETS]}
    operations = []
    pending = None
    last_send = None
    counts = {'identity': 0, 'rq1': 0, 'dt1': 0, 'received': 0}
    for seq, row in enumerate(rows, 1):
        require(row['sequence'] == seq, 'Audit sequence gap')
        direction = row['direction']
        if direction == 'GUARD_READY':
            require(seq == 1 and row['mode'] == 'approved-metal-only', 'Unexpected guard')
            continue
        require(direction in ('TX_ATTEMPT', 'TX_NATIVE_RETURNED', 'RX'), 'Blocked or unknown audit event')
        wire = list(bytes.fromhex(row['hex']))
        if direction == 'TX_NATIVE_RETURNED':
            require(last_send == wire, 'Unmatched native send return')
            last_send = None
            continue
        if direction == 'TX_ATTEMPT':
            require(last_send is None and pending is None, 'Overlapping native I/O')
            last_send = wire
            if wire == [0xf0, 0x7e, 0x7f, 6, 1, 0xf7]:
                counts['identity'] += 1
                operations.append({'kind': 'identity'})
                pending = operations[-1]
                continue
        else:
            counts['received'] += 1
            require(pending is not None, 'Unsolicited/unmatched SysEx')
            if pending['kind'] == 'identity':
                require(len(wire) == 15 and wire[:10] == [0xf0, 0x7e, 0, 6, 2, 0x41, 0x33, 3, 0, 0]
                    and wire[-1] == 0xf7 and all(0 <= b < 128 for b in wire[2:-1]), 'Unsupported identity')
                pending = None
                continue
        require(len(wire) in (15, 18) and wire[:7] == [0xf0, 0x41, 0, 0, 0, 0, 0x33] and wire[-1] == 0xf7, 'Invalid Roland framing')
        require(all(0 <= b < 128 for b in wire[2:-1]) and sum(wire[8:-1]) % 128 == 0, 'Invalid 7-bit/checksum')
        address = tuple(wire[8:12])
        require(address in addresses, 'Unapproved address (system/save/firmware forbidden)')
        key = addresses[address]
        if direction == 'RX':
            require(wire[7] == 0x12 and len(wire) == 15 and pending['key'] == key, 'Wrong read response')
            pending['raw'] = wire[12]
            pending = None
        elif wire[7] == 0x11:
            require(len(wire) == 18 and wire[12:16] == [0, 0, 0, 1], 'Unexpected RQ1 length')
            counts['rq1'] += 1
            operations.append({'kind': 'read', 'key': key})
            pending = operations[-1]
        else:
            require(wire[7] == 0x12 and len(wire) == 15, 'Unexpected command')
            counts['dt1'] += 1
            operations.append({'kind': 'write', 'key': key, 'raw': wire[12]})
    require(pending is None and last_send is None, 'Incomplete I/O')
    require(counts == {'identity': 1, 'rq1': 70, 'dt1': 9, 'received': 71}, 'Unexpected capture counts')
    require({k: report['audit'][k] for k in counts} == counts and report['audit']['blocked'] == 0 and report['audit']['sent'] == 80, 'Report counts disagree')
    cursor = 0

    def consume(kind, key=None, value=None):
        nonlocal cursor
        require(cursor < len(operations), 'Missing operation')
        op = operations[cursor]
        cursor += 1
        require(op['kind'] == kind and (key is None or op['key'] == key), f'Wrong operation at {cursor}')
        if value is not None:
            require(op.get('raw') == value, f'Unexpected {key} value')
        return op.get('raw')

    consume('identity')
    before = {key: consume('read', key) for key, _, _ in [LEVEL, *TARGETS]}
    require(before == report['application']['before'], 'Original values disagree with MCP')
    completed = []

    def change(key, value):
        original = consume('read', key)
        if original != value:
            consume('write', key, value)
        consume('read', key, value)
        completed.append({'key': key, 'before': original, 'raw': value,
            'readbackVerified': True, 'experimental': True, 'savedToPatch': False})

    change('TemporaryLevel', 0)
    for key, _, target in TARGETS:
        change(key, target)
        consume('read', 'TemporaryLevel', 0)
    for key, _, target in TARGETS:
        consume('read', key, target)
    final_level = min(before['TemporaryLevel'], 5)
    change('TemporaryLevel', final_level)
    require(cursor == len(operations), 'Unexpected extra operations')
    application = report['application']
    require(application['completed'] == completed and application['finalLevel'] == final_level
        and application['readbackVerified'] and not application['savedToPatch'] and not application['audibleResultVerified'], 'MCP application result disagrees')
    require(report['disconnected']['connected'] is False and report['disconnected']['locked'] is False, 'Unclean disconnect')
    applied_calls = [c for c in report['calls'] if c['name'] == 'katana_gen1_apply_tone' and c['arguments'].get('dryRun') is False]
    require(len(applied_calls) == 1 and not applied_calls[0]['result'].get('isError'), 'Expected one successful MCP apply call')
    wire_result = json.loads(applied_calls[0]['result']['content'][0]['text'])
    require(wire_result == application, 'Stored result differs from MCP response')
    return {'status': 'PASS', **counts, 'originalValues': before,
        'finalValues': {key: target for key, _, target in TARGETS} | {'TemporaryLevel': final_level},
        'auditSha256': hashlib.sha256(audit_bytes).hexdigest(),
        'scope': 'Native-boundary bytes and MCP response; no acoustic or power-cycle verification'}


def verify(folder):
    manifest = json.loads((folder / 'manifest.json').read_text(encoding='utf8'))
    for filename, expected in manifest['sha256'].items():
        require(Path(filename).name == filename, 'Manifest path is not a filename')
        require(hashlib.sha256((folder / filename).read_bytes()).hexdigest() == expected, f'File hash mismatch: {filename}')
    report = json.loads((folder / 'mcp-report.json').read_text(encoding='utf8'))
    return verify_bytes(report, (folder / 'midi-audit.jsonl').read_bytes())


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('folder', type=Path, nargs='?', default=Path(__file__).resolve().parents[1] / 'docs/evidence/gen1-metal-2026-10-23')
    args = parser.parse_args()
    print(json.dumps(verify(args.folder), indent=2))
