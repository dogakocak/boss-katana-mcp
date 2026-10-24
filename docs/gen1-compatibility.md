# KATANA-50 Gen 1 compatibility — experimental; limited tone edits verified

Date: 2026-10-23. **The new Node/native adapter's read-only path was exercised
successfully on one operator-labelled KATANA-50 Gen 1.** Discovery, observed
identity, 20 unique addresses, 23/23 RQ1 transactions, three matching start/end
sentinels and clean disconnect passed. Only one identity inquiry and 23 RQ1 were
sent; no outgoing DT1, patch-save or firmware command was sent. See the
[physical test report and retained evidence](gen1-hardware-readonly-2026-10-23.md).

The earlier TONEFORGE records from 2026-10-20 supplied the protocol facts; the new
test separately establishes this adapter's read-only behavior for this device and
session. Firmware remains unknown. Other models/firmware, physical fault recovery
remain unverified. The original read-only qualification did not authorize writes.
A later operator-approved [metal-tone session](gen1-hardware-metal-2026-10-23.md)
separately passed 70 RQ1 and nine effective-parameter DT1 writes with readback.
Only the recorded values on this device/session are hardware-qualified; endpoint
ranges, other default amp models, effect enabling and audible results are not.

## Evidence profile

- Exact MIDI input/output name: `KATANA`, case-insensitive, one of each required.
- Observed USB ID in the local detector: `VID_0582&PID_01D8`; not used by this
  implementation and not treated as proof of a KATANA-50 submodel.
- Inquiry: `F0 7E 7F 06 01 F7`.
- Observed reply: `F0 7E 00 06 02 41 33 03 00 00 00 00 00 00 F7`.
- Roland manufacturer `41`, device `00`, data-message model `00 00 00 33`.
- RQ1 `11`, DT1 `12`, four-byte address and four-byte 7-bit size.
- Checksum is `(-sum(address + size_or_data)) mod 128`.
- Data is unsigned, big-endian in base 128. Only explicitly sourced raw ranges
  are exposed; panel-to-DSP conversions and physical output levels are not inferred.

These facts are supported by `RolandSysEx.cs:58`, `ParameterCatalog.cs:32`,
`GAIN_PROTOCOL.md:21` and the raw identity/gain/read-sweep evidence listed in
[the source analysis](gen1-architecture.md). The identity family/member is
insufficient to uniquely identify the physical model. Revision bytes are retained
as unknown protocol bytes and are not decoded into an invented firmware version.

## Read allowlist

| Key | Address | Bytes | Access / meaning |
| --- | --- | ---: | --- |
| AmpType | 00 00 04 20 | 1 | Operational raw panel code |
| PanelGain | 00 00 04 21 | 1 | Operational panel position, not TemporaryGain |
| Volume | 00 00 04 22 | 1 | Read-only panel code |
| Bass | 00 00 04 23 | 1 | Read-only panel code |
| Middle | 00 00 04 24 | 1 | Read-only panel code |
| Treble | 00 00 04 25 | 1 | Read-only panel code |
| Presence | 00 00 04 26 | 1 | Raw code; physical KATANA-50 has no Presence knob |
| BoosterMod | 00 00 04 27 | 1 | Combined code; not independent effect state |
| DelayFx | 00 00 04 28 | 1 | Combined code; not independent effect state |
| Reverb | 00 00 04 29 | 1 | Panel code, not DSP effect level |
| TemporaryGain | 60 00 00 52 | 1 | Temporary preamp raw value |
| DelayTime | 60 00 05 62 | 2 | Explicit research |
| DelayFeedback | 60 00 05 64 | 1 | Explicit research |
| ReverbLevel | 60 00 06 18 | 1 | Explicit research |
| NoiseSuppressorOn | 60 00 06 63 | 1 | Explicit research |
| NoiseSuppressorThreshold | 60 00 06 64 | 1 | Explicit research |
| EqLowGain | 60 00 01 32 | 1 | Explicit research |
| Fx1PhaserRate | 60 00 02 76 | 1 | Explicit research; algorithm-dependent |
| Fx1PhaserDepth | 60 00 02 77 | 1 | Explicit research; algorithm-dependent |
| SignalChainPattern | 60 00 12 00 | 1 | Explicit research; raw pattern |

This original 20-field allowlist remains available. The later effective controls
add `TemporaryAmpType`, `TemporaryBass/Middle/Treble/Presence/Level` and
`BoosterOn/ModOn/FxOn/DelayOn/ReverbOn` and `DelayLevel`: 32 readable keys overall, observed across
two separate sessions rather than one atomic snapshot. The original nine research
reads retain their explicit-research gate.

`list_params` reports source-defined raw bounds for the 16 effective writable
fields and null for the others. [Write support](gen1-write-support.md) records
all addresses, default amp codes, numeric limits and source offsets. There is no
patch-name, saved-channel, Booster/Mod algorithm selection, save or firmware API.

## Startup and opt-ins

Default startup remains Gen 3. To inspect Gen 1 tool metadata with **no MIDI I/O**:

```powershell
$env:KATANA_BACKEND = 'gen1'
node dist/index.js
```

Keep the following variables absent unless the operator deliberately authorizes
hardware use. The recorded physical test explicitly passed hardware/model options
to a guarded adapter instance; both write-related options were false. This
documentation/evidence update performs no additional device operations.

| Environment variable | Exact enabling value | Purpose |
| --- | --- | --- |
| KATANA_GEN1_ENABLE_HARDWARE | 1 | Permit MIDI enumeration/open/inquiry/RQ1 |
| KATANA_GEN1_MODEL_CONFIRMED | 1 | Operator has checked physical KATANA-50 Gen 1 label |
| KATANA_GEN1_ALLOW_WRITES | 1 | Explicit authorization for allowlisted effective-parameter DT1 |
| KATANA_GEN1_LOW_MASTER_CONFIRMED | 1 | Operator has set physical MASTER low |

No tool can change these startup gates. Setting only `KATANA_BACKEND=gen1` opens
no ports and does not import native MIDI. Setting hardware opt-in does not send
anything until an explicit discovery/connect/read tool call. Native dependency
installation is `npm install` (optional dependency). The recorded Windows x64 /
Node 24.14.1 / MIDI 3.8.1 read path passed on this host; other architectures,
drivers and fault scenarios remain unverified. Keep both write-related flags
absent throughout read-only qualification.

`katana_gen1_set` requires both write gates and a connection, validates the
source-bounded target and current value, sends at most one DT1 and demands exact
readback. It leaves the requested effective value in place on success. The
metal-tone tool defaults to a zero-I/O preview; applying serializes a backed-up,
LEVEL-reduced sequence and reports partial state on failure. Neither tool retries
or restores after uncertainty. `savedToPatch:false` means no save command was
sent, not a NVRAM guarantee. No hardware action is authorized by documentation.

**Volume policy:** all panel `Volume` writes remain rejected. Effective
`TemporaryLevel` has a source-defined raw 0..100 range, but this application
permits only 0..10 and the metal recipe defaults to a non-increasing final value
at most 5. These software limits do not establish physical loudness; low physical
MASTER is independently required. Physical LEVEL 28→0→5 was readback-verified.

The Gen 3 `katana-tone` skill and its tone recipes use a different parameter
contract and should not be applied to Gen 1. Gen 1 does not launch BTS or use CDP.
