# Gen 1 physical read-only qualification — 2026-10-23

## Result and scope

**PASS: discovery, observed identity, 20 unique raw addresses and clean disconnect
on one operator-labelled KATANA-50 Gen 1.** The existing Node Gen 1 adapter was
tested at revision `c5ac085f1849157e8fcddfdc30e388bf6cf31540` on Windows x64,
Node v24.14.1 and `@julusian/midi` 3.8.1.

The operator explicitly authorized this read-only test after the initial offline
implementation. The run started at `2026-10-23T18:14:25.665Z` and finished at
`2026-10-23T18:14:28.447Z` (21:14 Europe/Istanbul). These are host timestamps,
not amplifier timestamps or a physical latency benchmark. Documentation publication
does not run this test again.

| Check | Result | Recorded evidence |
| --- | --- | --- |
| USB presence | PASS | One present `KATANA`, `VID_0582&PID_01D8`, status OK |
| Conflicting known applications | PASS | No BOSS/TONEFORGE/KATANA process found in preflight |
| MIDI selection | PASS | Exact `KATANA` input index 0 / output index 1; CTRL/DAW ports excluded |
| Identity inquiry | PASS | One request; observed Roland family/member matched |
| Operational reads | PASS | All 11 allowed operational addresses |
| Explicit research reads | PASS | All 9 allowed research addresses; explicit intent supplied |
| Total reads | PASS | 23/23 transactions across 20 unique addresses |
| Start/end sentinels | PASS | AmpType=2, PanelGain=100, SignalChainPattern=0 both times |
| Independent trace verification | PASS | All frames, checksums, addresses, lengths and decoded values checked offline |
| Cleanup | PASS | Disconnected, unlocked, no cleanup error |
| Hardware write tests | SKIPPED / DISABLED | No write API invoked; both write-related adapter options false |
| Unplug/reconnect, competing MIDI clients, fragmentation and delayed replies | SKIPPED | No physical fault injection performed |
| Gen 3 physical regression | SKIPPED | This run used only the Gen 1 adapter |

## Identity and exact transmitted command scope

```text
Inquiry TX: F0 7E 7F 06 01 F7
Identity RX: F0 7E 00 06 02 41 33 03 00 00 00 00 00 00 F7
```

Identity verifies the observed Roland family `33 03`, member `00 00` and device
ID `00`. It does not uniquely prove the 50 submodel or firmware; the model label
comes from operator confirmation and firmware remains unknown.

There were **24 native-returned sends: 1 identity inquiry + 23 RQ1**. There were
24 received messages and 72 audit records (TX attempt, native send returned, RX).
The trace contains **zero outbound DT1, patch-save, firmware or other commands**.
Incoming DT1 frames are the normal read responses and are not outgoing writes.

The captured harness used the existing `Gen1MidiAdapter` and native transport.
It injected real MIDI classes with a guard at `Output.sendMessage`: only the exact
inquiry and 20 allowlisted RQ1 frame forms could reach the native sink. A separate
transport `send` method rejected writes unconditionally. `allowWrites=false` and
`lowMasterConfirmed=false` were explicitly passed; environment write flags could
not enable them. The 23 reads were sequential, without retry, and included three
start/end sentinels. The runner did not call `adapter.write` or MCP `katana_gen1_set`.
This qualifies the adapter/native read path; the physical MCP stdio process was
not separately exercised against the amp. Earlier MCP SDK tests were in-memory.

## Observed raw values

| Key | Address | Bytes | Raw value |
| --- | --- | ---: | ---: |
| AmpType | 00 00 04 20 | 1 | 2 |
| PanelGain | 00 00 04 21 | 1 | 100 |
| Volume | 00 00 04 22 | 1 | 9 |
| Bass | 00 00 04 23 | 1 | 54 |
| Middle | 00 00 04 24 | 1 | 100 |
| Treble | 00 00 04 25 | 1 | 93 |
| Presence | 00 00 04 26 | 1 | 16 |
| BoosterMod | 00 00 04 27 | 1 | 0 |
| DelayFx | 00 00 04 28 | 1 | 30 |
| Reverb | 00 00 04 29 | 1 | 3 |
| TemporaryGain | 60 00 00 52 | 1 | 100 |
| DelayTime | 60 00 05 62 | 2 | 456 |
| DelayFeedback | 60 00 05 64 | 1 | 28 |
| ReverbLevel | 60 00 06 18 | 1 | 4 |
| NoiseSuppressorOn | 60 00 06 63 | 1 | 1 |
| NoiseSuppressorThreshold | 60 00 06 64 | 1 | 47 |
| EqLowGain | 60 00 01 32 | 1 | 20 |
| Fx1PhaserRate | 60 00 02 76 | 1 | 80 |
| Fx1PhaserDepth | 60 00 02 77 | 1 | 40 |
| SignalChainPattern | 60 00 12 00 | 1 | 0 |

These are time-specific raw codes, not new UI-unit/range mappings or proof that
an effect is active/audible. Matching sentinels reduce snapshot uncertainty but
do not make sequential reads atomic or exclude transient changes between them.
TemporaryGain=100 is a valid observed read, not permission to widen the existing
95/96 experimental write window. No write compatibility was established.

## Retained evidence and offline reproduction

The six original files are retained byte-for-byte in
[`evidence/gen1-readonly-2026-10-23/`](evidence/gen1-readonly-2026-10-23/):

- [`report.json`](evidence/gen1-readonly-2026-10-23/report.json): environment,
  tested revision/source hashes, discovery, status gates and every read result.
- [`midi-audit.jsonl`](evidence/gen1-readonly-2026-10-23/midi-audit.jsonl): all
  attempted/returned sends and raw incoming messages with timestamps.
- [`verification.json`](evidence/gen1-readonly-2026-10-23/verification.json):
  independent offline frame/value/safety verification result.
- [`preflight.json`](evidence/gen1-readonly-2026-10-23/preflight.json): USB and
  known-application inventory, plus the operator-authorized scope.
- [`read-only-probe.mjs`](evidence/gen1-readonly-2026-10-23/read-only-probe.mjs):
  exact captured hardware harness, retained for audit; not part of automated tests.
- [`verify_read_only.py`](evidence/gen1-readonly-2026-10-23/verify_read_only.py):
  exact independent verifier used after the run; no MIDI dependency.

[`manifest.json`](evidence/gen1-readonly-2026-10-23/manifest.json) records all six
file sizes and SHA-256 values. The raw report SHA-256 is
`548829a89ecfb93aca4f0fc68b46df29ac09a2be7e3a4d48be66d58310a41800`;
the MIDI audit SHA-256 is
`5a6db1f367209393a90841743464d2a51926abbbd7d0df512e6ec01cbde1a0a2`.
The scoped `.gitattributes` rule disables text/EOL conversion for this evidence
directory so Windows checkouts preserve the captured bytes and hashes.
Its whitespace setting treats the captured CRLF terminators as line endings.

Reproduce the verification **offline, without opening any MIDI port**:

```powershell
python scripts/Verify-Gen1ReadOnlyEvidence.py
```

This checks the manifest, runs the original verifier in disposable storage and
compares its result with the retained proof without overwriting evidence. It does
not execute the hardware harness. The original harness remains manually gated
and is not invoked by `npm test`, build, the verifier or an automation.

## Compatibility status after this run

Gen 1 remains **experimental**, with the enumerated **read-only path verified
on this device/session**. Writes, persistence, full ranges, other firmware/models,
physical reconnect/fault recovery and the entire native driver's behavior remain
unverified. All write tests remain disabled, no runtime permission gate changed,
and no upstream PR was opened.
