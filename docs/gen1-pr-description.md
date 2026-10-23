# Pull request description

Title: **Add experimental KATANA-50 Gen 1 MIDI controls and guarded tone editing**

Target: `dogakocak/boss-katana-mcp:main`
Head: `karmasis-alicem-ozkara:feat/katana-gen1-support`

## What changed

Add experimental direct USB MIDI/SysEx support for the original KATANA-50 while preserving the existing Gen 3 BTS/CDP backend as the default. Select `KATANA_BACKEND=gen1` to expose eight isolated Gen 1 tools; hardware access and writes remain disabled by default.

The adapter discovers a unique KATANA port pair, validates the observed Roland identity plus operator confirmation of the physical model, and reads 32 raw parameters. Sixteen effective controls have source-bounded experimental writes. The metal-tone tool previews with zero device I/O by default and requires `dryRun:false` plus explicit hardware/write/low-MASTER opt-ins to apply.

All commands are serialized. Writes validate canonical parameter addresses, raw bounds, checksums and exact readback; an uncertain send or reply locks the session without retry or rollback. Tone application captures original values, reduces temporary LEVEL to zero, verifies the targets, and ends at a non-increasing LEVEL (default at most 5). Main LEVEL writes are capped at 10; delay/reverb wet levels are capped at 50. These are software policies, not acoustic safety guarantees. System/panel, arbitrary-address, patch-save and firmware writes are unavailable.

The optional native MIDI dependency is lazy-loaded. No local unlicensed implementation or proprietary Roland asset is copied. Protocol/source facts, compatibility limits, manual hardware plans, command logs, captured raw MIDI and offline evidence verifiers are included.

## How it was tested

- [x] `npm run build` - PASS (Windows x64, Node 24.14.1).
- [x] `npm test` - **139 PASS / 49 SKIPPED**. The 21 runnable original Gen 3 tests remain passing; 48 installed-Gen-3-BTS tests and one opt-in live e2e test are skipped.
- [x] `npm run test:gen1` - **118 PASS**, including protocol vectors, mock transports/native classes, real MCP SDK integration, validation, concurrent commands, timeout/fault locking, partial failures and readback checks.
- [x] `npm audit --omit=dev` - zero reported vulnerabilities at publication validation.
- [x] Offline source verification - pinned original BTS package hashes and nine exact parameter definitions/map entries checked without hardware access.
- [x] Read-only physical session - one operator-labelled **KATANA-50 Gen 1**, firmware unknown; 20 addresses / 23 RQ1, identity match, zero outgoing DT1 and clean disconnect. Retained evidence reverified offline.
- [x] Operator-approved metal session through the actual MCP stdio server - 70 RQ1 / nine temporary DT1 writes, exact target readback, LEVEL 28 -> 0 -> 5, clean disconnect. Its independent evidence verifier passes offline.
- [x] Subsequent user-commanded delay/reverb sessions - both effects enabled and wet levels set to 15, then 25 and 50 with readback. At 50 the operator confirmed they were audible through the amp speaker; main LEVEL remained 5. This is subjective listening confirmation, not an audio measurement.
- [x] Captured-file hashes and original local source/evidence preservation checked. No additional hardware operation was performed to prepare this PR.
- [ ] Full Gen 3 installed-BTS and live hardware regression - SKIPPED.
- [ ] Other models/firmware, physical unplug/fault recovery, range endpoints, power-cycle persistence and objective audio measurements - NOT RUN.
- [ ] Patch-save and firmware operations - unavailable and NOT RUN.

The historical automated security scan predates the later tone changes; the current extension received a manual static safety review. Native-driver internals and firmware behavior have not been audited.

## Known limitations and evidence

Experimental support is qualified only for the recorded device, values and sessions. MIDI identity does not prove the exact KATANA-50 submodel or firmware, so operator model confirmation is required. Panel codes differ from effective DSP values. Sequential reads/edits are not atomic, and an interrupted tone may leave partial state; original values and completed steps are reported. Unsolicited same-address DT1 can resemble readback. Fragmented SysEx, cross-process ownership and blocking driver calls need further qualification.

- [Architecture and local source analysis](docs/gen1-architecture.md)
- [Compatibility and opt-ins](docs/gen1-compatibility.md)
- [Temporary writes and source bounds](docs/gen1-write-support.md)
- [Test plan](docs/gen1-test-plan.md) and [validation](docs/gen1-validation.md)
- [Read-only hardware report](docs/gen1-hardware-readonly-2026-10-23.md)
- [Approved metal session report](docs/gen1-hardware-metal-2026-10-23.md)
- [User-command journal and later listening confirmation](docs/gen1-user-command-log.md)
