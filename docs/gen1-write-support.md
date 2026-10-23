# Experimental Gen 1 temporary tone writes

## Current wet-level policy — explicit request for 50

At 22:10 on 2026-10-23, the operator explicitly requested 50 after finding 25
inaudible. The application ceiling for **DelayLevel/ReverbLevel is now 50**;
the pinned source limits (120/100), main LEVEL ceiling (10) and write gates
are unchanged. Both wet levels 25→50 passed readback; main LEVEL stayed 5.
The user identified the amp speaker as the output and confirmed the effects
were now audible. This is operator listening confirmation, not an audio
measurement or a proven explanation of the earlier inaudibility. The earlier
0..30 restriction described below is historical. See the command journal.

## Later delay/reverb level extension — 22:04, 2026-10-23

The operator's subsequent `delay ekle ve reverb` command exposed zero wet levels:
turning the effects on alone could not produce an audible effect. The pinned
editor defines `delay_effect_level` at FWS id `0x9185a2`, min/max `0x9185b7`
as 0..120; `reverb_effect_level` at id `0x919a16`, min/max `0x919a2b` is 0..100.
The existing offline source verifier now checks both definitions and their
temporary map addresses; [the nine-field result](gen1-effect-level-source-evidence.json)
is retained. `DelayLevel` (`60 00 05 66`) is a new readable/writable key;
`ReverbLevel` (`60 00 06 18`) retains explicit research gating for reads and now
supports writes. Each permits only integers 0..30 as an application policy.
There are now 32 readable keys and 16 bounded writable effective controls.

The explicitly requested manual command read both levels as zero, set each to
raw 15 and verified both ON flags remained 1. LEVEL stayed 5. Initial toggles
used two DT1; the subsequent wet-level session used two DT1 and 18 RQ1, with
clean disconnect. DelayTime 456 and Feedback 35 were read, not changed. This
qualifies those values on this session only; audio was not measured. See the
[user command log](gen1-user-command-log.md) and
[retained captures](evidence/gen1-commands-2026-10-23-2201/manifest.json).
The earlier metal-session report below remains a separate historical result.

2026-10-23. The operator requested a metal tone, explicitly approved hardware
writes and confirmed low physical MASTER. This authorizes this manual session;
normal startup still disables hardware and writes. Patch save and firmware
operations remain unavailable. Hardware results are recorded separately, never
inferred from these source definitions or the offline tests.

## Source evidence

The installed **original** BTS 4.0.0 `temporary` address map names the effective
preamp and effect controls below. Its SHA-256 is
`57714a40077d200f2cf55e4869b7c0475dcb24a996c77bb54655a2d2131bd7e4`.
The SWF SHA-256 is
`28674f980ae8c854b6888138d86d22c65bfbcc8007d80ae85b89f065b2350480`.
`ParameterDefinitionGT` initializer, method 14165 at FWS `0x910b04`, supplies
explicit id/min/max/step definitions. [Retained decoded facts](gen1-tone-source-evidence.json)
include exact offsets. `python scripts/Verify-Gen1ToneSource.py` independently
decodes the pinned ABC string pool and checks these operands and map entries;
it never runs the SWF, launches BTS or accesses MIDI.

| Effective control | Address | Source raw bounds | Write policy |
| --- | --- | --- | --- |
| TemporaryAmpType | 60 00 00 51 | Default codes 1/8/11/24/23 | Acoustic/Clean/Crunch/Lead/Brown only |
| TemporaryGain | 60 00 00 52 | 0..120 | Integer raw DSP value |
| TemporaryBass/Middle/Treble/Presence | 60 00 00 54/55/56/57 | 0..100 | Integer raw DSP values |
| TemporaryLevel | 60 00 00 58 | 0..100 in editor | Software ceiling **10** |
| BoosterOn / ModOn | 60 00 00 30 / 60 00 01 40 | 0=off, 1=on | Boolean raw codes |
| FxOn / DelayOn / ReverbOn | 60 00 03 4C / 60 00 05 60 / 60 00 06 10 | 0=off, 1=on | Boolean raw codes |
| NoiseSuppressorOn / Threshold | 60 00 06 63 / 64 | 0/1 and 0..100 | Independent raw controls |

The [original Katana-50 amp-type measurements](https://raw.githubusercontent.com/katana-dev/docs/master/tables/amp-types.md)
identify the five default effective algorithms and their different panel codes;
Brown is effective **23**, panel **4**. Those measurements cite firmware 1.0.2;
this device's firmware is unknown. The operator's historical block capture also
contained effective 23 while the UI showed Brown. This does not qualify hidden
amp models or every default model on this device.

[Hirsch's original Katana measurements](https://raw.githubusercontent.com/snhirsch/katana-midi-bridge/master/doc/katana_sysex.txt)
document effective effect-toggle codes and the noise-gate bounds. They were made
on a Katana-100 and corroborate the installed map; they are not new Katana-50
hardware evidence. Toggle addresses refer to their respective effect ranges;
enabling one does not configure its algorithm or guarantee it is audible.

No C#/PowerShell implementation, original inspection helper, proprietary SWF,
address-map asset or third-party library source is copied into this contribution.
The new verifier and TypeScript controls are independent implementations of
protocol facts. No new runtime dependency is added.

## MCP contract and behavior

`katana_gen1_set {key,value}` now supports only the bounded effective fields
above. All panel/system addresses remain read-only. Both write startup gates,
hardware enablement, physical-model confirmation and a live verified connection
are required. Each write pre-reads and validates the current raw value, sends at
most one DT1 and demands exact RQ1 readback. Unchanged values skip DT1.

`katana_gen1_apply_tone {name:"metal"}` defaults to **dryRun=true**, returning a
plan with no device I/O. `dryRun:false` applies this starting sound:

Brown/SLDN; raw Gain 85, Bass 60, Middle 40, Treble 65, Presence 45;
Booster/Mod/FX/Delay/Reverb off; NS1 on, Threshold 55.

The whole operation occupies the adapter queue. It pre-reads all 14 original
fields before writing, reduces effective LEVEL to zero, verifies each change
and checks LEVEL stayed zero, then verifies every tone target again. Finally it
sets LEVEL to `min(previous LEVEL, outputLevel)`; outputLevel defaults to 5 and
must be 0..10. A previous zero remains zero. No panel-volume conversion is used.

**The numerical ceiling is a conservative application policy, not an acoustic
safety guarantee.** Keep physical MASTER low; model-switch behavior can still
affect output before a later read detects it. Incoming values outside source
bounds, a timeout, checksum/address error, LEVEL drift or a readback mismatch
stop and lock the session. There is no automatic retry, unmute or rollback.
Partial failures report the original values, completed steps and failing stage.
Reads and multi-parameter edits are sequential, not atomic snapshots/transactions;
do not operate physical controls or another MIDI client during application.

`savedToPatch:false` means no save command was sent; power-cycle persistence and
audible tone quality have not been established. There is no general patch-write,
hidden-amp, arbitrary-address or firmware endpoint. Gen 3 remains unchanged.

## Manual session harness

After a fresh build, **only with current operator approval**, low physical MASTER,
the correct physical model and other MIDI clients closed:

```powershell
node scripts/Apply-Gen1Metal.mjs NEW_EVIDENCE_DIRECTORY --write-approved --low-master-confirmed
```

This invokes the actual MCP SDK over stdio, previews the plan, discovers/connects,
applies it once and disconnects. It is not registered in npm tests or automation.
The native-send guard admits only the exact approved tone values, LEVEL 0..5,
the corresponding single-byte reads and one identity request; repeated writes,
unapproved frames and raising LEVEL before verified tone values are blocked.
Each raw RX and native-send attempt/return is synchronously journalled and flushed.
The report records source/build hashes, original values, calls, results and errors.
Its authorization flags must never be enabled on behalf of an absent operator.
