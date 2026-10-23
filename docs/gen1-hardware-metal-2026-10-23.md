# Operator-approved Gen 1 metal-tone session

**PASS — temporary settings and readback on one KATANA-50 Gen 1.**
2026-10-23, 21:48:39–21:48:41 Europe/Istanbul (18:48 UTC). Firmware unknown.
This is a manual response to the user's metal-tone command, not an autonomous
test or a range sweep. Audible quality and power-cycle persistence are unverified.

## Authorization and prerequisites

The user requested metal-tone support and explicitly said **“destegi getir.
yazma onayını veriyorum”**, then confirmed **“Evet, fiziksel MASTER düşük”**.
After BTS was found open, the user confirmed **“Tone Studio’yu kapattım”**.
Read-only OS preflight showed no BTS/TONEFORGE process and a present, OK KATANA
USB device (`VID_0582&PID_01D8`). Its USB ID is not a unique submodel proof.
The physical KATANA-50 Gen 1 label remains operator-attested.

The exact starting-tone settings and output policy were presented before the
application. Neither patch-save nor firmware operations were authorized or sent.
Write flags were set only in the spawned MCP process; no persistent host/MCP
configuration was changed. Normal startup remains closed to hardware and writes.

## Execution and results

The real SDK client launched the real MCP stdio server with a native-send guard,
previewed `metal` with default dryRun, discovered the unique `KATANA` pair,
connected and verified the observed Roland identity, called
`katana_gen1_apply_tone {"name":"metal","outputLevel":5,"dryRun":false}` once,
and disconnected. These were **six** MCP tool calls; there was no separate
post-disconnect hardware probe or rollback.

| Effective raw parameter | Before | Requested / read back |
| --- | ---: | ---: |
| TemporaryAmpType | 1 | 23 (SLDN / default Brown) |
| TemporaryGain | 54 | 85 |
| TemporaryBass | 54 | 60 |
| TemporaryMiddle | 58 | 40 |
| TemporaryTreble | 46 | 65 |
| TemporaryPresence | 16 | 45 |
| BoosterOn | 0 | 0 — no DT1 |
| ModOn | 0 | 0 — no DT1 |
| FxOn | 0 | 0 — no DT1 |
| DelayOn | 0 | 0 — no DT1 |
| ReverbOn | 0 | 0 — no DT1 |
| NoiseSuppressorOn | 1 | 1 — no DT1 |
| NoiseSuppressorThreshold | 47 | 55 |
| TemporaryLevel | 28 | 0 during edits; **5** at completion |

- **PASS:** exactly one identity request; reply family/member matched.
- **PASS:** all 14 original values captured before any DT1; 70 strict RQ1 reads.
- **PASS:** nine outgoing DT1 commands, eight distinct effective addresses;
  LEVEL was written twice. Six unchanged fields skipped DT1 but were read back.
- **PASS:** LEVEL remained zero at each per-step check; all 13 tone targets were
  re-read successfully before the limited final LEVEL was restored.
- **PASS:** 80 native-returned sends, 71 RX frames, zero blocked sends.
- **PASS:** clean disconnect, unlocked final adapter, no cleanup error.
- **NOT RUN:** listening/audio measurement, range endpoints, different models or
  firmware, physical unplug/fault injection, Gen 3 physical regression.
- **NOT RUN / unavailable:** patch save and firmware operations.

The current tone was left in place as requested. An unchanged effect OFF or NS1
ON readback proves its observed state, not that an enable/disable write was tested.
No audible success or persistence guarantee follows from matching MIDI values.

## Retained evidence and reproducibility

[Raw capture and manifest](evidence/gen1-metal-2026-10-23/manifest.json) retain the
original report, audit and exact runner/guard bytes. The capture was made from
local commit `51b55a6194cd3c4060e173f5f0e82c7d41a28711`, tree
`837d4c4b34f17dc0a116b652150dd13005720057`. GitHub publication may use different
commit metadata; this tree and the recorded source/build byte hashes identify the
actual code. Node was 24.14.1; the existing optional MIDI dependency is 3.8.1.

- Report SHA-256: `6f36fce56817c82523ad9cd567921db80ba0be14ff217b660a980c747709bd11`.
- Audit SHA-256: `839070b752665da3a12c4e6be77bc02423b1ef46634130ec7a79db1bfa301bf8`.

Recheck **without hardware access**:

```powershell
python scripts/Verify-Gen1MetalEvidence.py
```

The independent Python verifier imports no production codec or MIDI library. It
checks retained hashes, every frame/checksum/address/size, request/response pairing,
the exact approved sequence, original values, readbacks, MCP response agreement
and clean disconnect. Its [derived result](evidence/gen1-metal-2026-10-23/verification.json)
is retained. Four additional offline tamper variants (checksum, save address,
wrong LEVEL and missing audit row) were rejected, even with a recalculated audit
hash in the supplied test report. This is integrity checking, not cryptographic
attestation from the device or USB-bus capture.
