# Gen 1 test plan

## Automated offline checks

Run `npm run build` and `npm test`. All new tests inject in-memory backends or
native constructors and never import/open a real MIDI device. Existing Gen 3 e2e
remains opt-in; **do not run `npm run test:e2e` as part of this plan**: it writes
amp volume. Do not set `KATANA_E2E=1` during offline checks.

`test/gen1.test.ts` covers captured RQ1/DT1 vectors and checksum edge cases,
integer/7-bit/size validation, exact device/model/address/length matching,
identity rejection, raw two-byte decoding, all 32 permitted reads, explicit
research gating, panel/system write rejection and source-bounded effective writes.
Mock integrations cover default-disabled I/O, missing model attestation,
ambiguous/missing ports, unsupported identity, readback mismatch, unplug errors,
timeout/late replies, queued command rejection, concurrent command serialization,
clean reconnect and irreversible fault lock. No full patch or firmware test exists.

`test/gen1-tone.test.ts` covers default zero-I/O previews, exact default amp
codes, numeric/toggle/LEVEL validation, all write gates, full backup preflight,
non-increasing final LEVEL, serialization, partial errors, uncertain send timeout,
LEVEL drift and later changes invalidating earlier targets before LEVEL rises.
It also checks the separate wet-level ceiling, actual MCP handler writes for
Delay/Reverb levels and preservation of main LEVEL. The later requested effect
command passed ON/15 readbacks; audible quality and full ranges remain unverified.

`test/gen1-native.test.ts` injects native classes to cover enumeration cleanup,
partial-open failure, SysEx configuration, listener-before-send, listener removal,
send errors, timeout, close cancellation and process-wide ownership.

`test/backend.test.ts` checks default Gen 3 tool registration, unchanged mocked
Gen 3 status/connect handlers, isolated Gen 1 registration and invalid backend
rejection. The original Gen 3 suites remain intact. Their BTS sandbox tests skip
when the Gen 3 UI bundle is absent; skips must never be reported as passes.

Recheck the committed physical trace without accessing hardware:

```powershell
python scripts/Verify-Gen1ReadOnlyEvidence.py
```

This hashes the six retained capture files and reruns their independent verifier
in disposable storage. It does not execute the captured native MIDI harness.

## Manual hardware qualification — read-only and approved metal sessions completed

The [2026-10-23 physical run](gen1-hardware-readonly-2026-10-23.md) passed discovery,
identity, all 20 allowed addresses (23 transactions including sentinels) and clean
disconnect on one operator-labelled KATANA-50 Gen 1. The captured manually gated
harness is retained for audit and is not registered in npm tests or an automation.
Repeating any hardware stage requires the operator's explicit authorization;
retain raw TX/RX, model label, driver/Node/native dependency versions and timestamps.

1. Confirm physical KATANA-50 Gen 1 label, firmware if discoverable without
   changing it, driver and USB cabling. Close BTS, TONEFORGE and other MIDI clients.
2. Approve read-only testing. Enable hardware and physical-model startup gates;
   leave both write gates absent. Discover ports, connect once, record identity.
   Verify a different model or ambiguous ports fail before any RQ1/DT1.
3. Read AmpType/PanelGain/Volume individually and compare raw frames with the
   device's current state. Read research addresses only by explicit operator
   request; do not assume a full patch snapshot or active effect semantics.
4. Approve unplug/reconnect testing. Unplug during a read; prove timeout releases
   resources, locks queued commands and sends no retries. Inspect state, reconnect
   USB and restart the server. Confirm clean disconnect/reconnect separately.
5. Keep writes disabled during read-only work. A later **explicitly approved**
   [manual metal session](gen1-hardware-metal-2026-10-23.md) verified 70 reads and
   nine effective writes on this device. Its manual runner is outside npm tests;
   repeating hardware work requires a current operator command and write approval.
6. Separately qualify delayed unsolicited messages, fragmented SysEx, duplicate
   notifications, long driver calls and cross-process WinMM ownership. These are
   known limitations of this initial transport, not already-passed tests.

Panel/system volume, patch save, firmware updates and broad range sweeps are excluded.
Gen 3 hardware regression also requires separate approval and is SKIPPED here.

## Approved tone session and offline rechecks

The user approved writes and confirmed low physical MASTER and closed BTS. See
[source definitions, bounds and manual invocation](gen1-write-support.md).
That limited session passed identity, original-value backup, LEVEL 28→0→5,
target readback and clean disconnect. Effect-toggle writes were skipped because
their values already matched; enabling algorithms remains hardware-unverified.

```powershell
python scripts/Verify-Gen1ToneSource.py
python scripts/Verify-Gen1MetalEvidence.py
```

Both commands are offline; neither imports MIDI. The latter rechecks raw bytes,
exact schedule and MCP result agreement against the retained manifest. It does
not rerun the captured hardware harness. Audible results, physical fault recovery,
other amp codes/firmware and endpoint ranges still need separate qualification.

## Run evidence

Baseline before implementation: build PASS; 21 tests PASS, 49 SKIPPED. The skipped
tests require the Gen 3 BTS installation (48) or opt-in hardware e2e (1). This
machine has the older Tone Studio, not the Gen 3 sandbox bundle. Historical
TONEFORGE 934/934 checks and physical 23/23 reads are source evidence, not tests
executed by the initial implementation. The later Node adapter read-only run and
its independently checked 72-record trace are separate, retained evidence. See
`gen1-validation.md` and the hardware report for the distinction.
