"""Recheck the committed hardware evidence offline. Never imports MIDI or opens a device."""
from pathlib import Path
import hashlib
import json
import shutil
import subprocess
import sys
import tempfile


def main():
    root = Path(__file__).resolve().parents[1]
    bundle = root / 'docs' / 'evidence' / 'gen1-readonly-2026-10-23'
    manifest = json.loads((bundle / 'manifest.json').read_text(encoding='utf-8'))
    expected_files = {'midi-audit.jsonl', 'preflight.json', 'read-only-probe.mjs',
                      'report.json', 'verification.json', 'verify_read_only.py'}
    if len(manifest['files']) != len(expected_files) or {entry['path'] for entry in manifest['files']} != expected_files:
        raise ValueError('Unexpected evidence manifest inventory')
    for entry in manifest['files']:
        data = (bundle / entry['path']).read_bytes()
        if len(data) != entry['bytes'] or hashlib.sha256(data).hexdigest() != entry['sha256']:
            raise ValueError('Evidence integrity mismatch: ' + entry['path'])
    # The original verifier writes a new verification.json exclusively. Run its
    # unchanged captured copy in disposable storage; preserve the committed proof.
    with tempfile.TemporaryDirectory(prefix='katana-evidence-offline-') as scratch:
        target = Path(scratch)
        for name in expected_files - {'verification.json'}:
            shutil.copyfile(bundle / name, target / name)
        checked = subprocess.run([sys.executable, str(target / 'verify_read_only.py')],
                                 check=True, capture_output=True, text=True)
        reproduced = json.loads(checked.stdout)
        retained = json.loads((bundle / 'verification.json').read_text(encoding='utf-8'))
        if reproduced != retained:
            raise ValueError('Reproduced verification differs from retained result')
    print(json.dumps({'result': 'PASS', 'mode': 'offline-only',
                      'evidenceFilesVerified': len(expected_files),
                      'verifiedUniqueAddresses': reproduced['verifiedUniqueAddresses'],
                      'verifiedReadTransactions': reproduced['verifiedReadTransactions'],
                      'identityQueriesSentInRecordedRun': reproduced['identityQueriesSent'],
                      'rq1QueriesSentInRecordedRun': reproduced['rq1QueriesSent'],
                      'dt1WritesSentInRecordedRun': reproduced['dt1WritesSent'],
                      'hardwareAccessDuringReverification': False}, indent=2))


if __name__ == '__main__':
    main()
