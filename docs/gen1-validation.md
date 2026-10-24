# Gen 1 contribution validation

Date: 2026-10-23 (Europe/Istanbul). Windows, Node v24.14.1, Vitest v4.1.12.
Base: upstream/main `56b6d13786be00e31db650c3923bf047726f5ad9`.
Branch: `feat/katana-gen1-support`.

## Later explicit wet-level 50 request

Build and 118 Gen 1 offline tests PASS after extending only the two wet-level
ceilings from 30 to 50. On the same operator-labelled device, both levels 25→50
passed exact readback (two DT1), main LEVEL stayed 5, 22 RQ1 and clean disconnect
passed. The operator confirmed listening on the amp speaker and that the effects
were now audible. No audio measurement, patch save or firmware operation occurred.
Current 50-session evidence includes the exact working-tree parameter extension,
its compiled bytes, a raw trace, a metadata correction supplement and file hashes.

## Subsequent user-commanded metal and delay/reverb changes

2026-10-23 22:01–22:04: metal reapplication passed 70 RQ1 / seven DT1; the
requested effect toggles passed two DT1 but exposed ReverbLevel zero. A small
source-verified wet-level extension then set DelayLevel 0→15 and ReverbLevel
0→15, with two DT1 / 18 RQ1; both ON flags remained 1 and main LEVEL stayed 5.
No patch save, firmware, physical fault test or audio measurement was performed.
Build PASS; `npm test` **139 PASS / 49 SKIPPED**. All original runnable Gen 3
checks pass. The nine-field offline source verifier passed both new level
definitions; no runtime dependency changed. Evidence and the exact runtime
parameter extension bytes are retained with [the command log](gen1-user-command-log.md).

## Later approved temporary-tone extension

The table and security scan below describe the earlier read-only contribution.
For the current extension, validated on 2026-10-23 after explicit write approval:

| Check | Result | Evidence / limits |
| --- | --- | --- |
| `npm run build` | PASS | Current write/tone source compiled |
| `npm test` | PASS / SKIPPED | 138 passed; 49 skipped |
| `npm run test:gen1` | PASS | 117 offline tests across four files |
| Original runnable Gen 3 tests | PASS | 21 tests; original runtime modules unchanged |
| Gen 3 installed-BTS / physical e2e | SKIPPED | 48 asset-dependent tests; 1 live e2e |
| Static BTS tone-source verifier | PASS | Seven exact id/min/max/step definitions and map entries, pinned package hashes |
| Approved physical metal application | PASS | One inquiry, 70 RQ1, nine DT1, 71 RX; exact targets and LEVEL 28→0→5; clean disconnect |
| Independent metal-evidence verifier | PASS | Raw frames, checksums, exact approved sequence, originals and MCP responses agree |
| Four offline tamper variants | PASS | Corrupt checksum, save address, wrong LEVEL and missing row rejected |
| Physical endpoint/fault/other-firmware tests | SKIPPED | No range sweep or fault injection authorized |
| Audible quality and persistence | UNVERIFIED | No listening/audio measurement or power cycle |
| Patch save / firmware | SKIPPED / unavailable | No API or outgoing command |
| `npm audit --omit=dev` | PASS | Zero reported vulnerabilities; no new dependency |
| Source license/preservation | PASS within scope | Independent implementation/facts only; all 24 original source/evidence hashes unchanged |
| Current manual safety/security diff review | PASS within static scope | Canonical address/value allowlist, immutable plans, gates off by default, dry-run default, LEVEL ceiling, one serialized operation, bounded sends, lock on uncertainty; manual harness requires explicit flags and exact frame guard |

The earlier Codex Security scan did **not** cover these later write/tone changes;
it is not presented as a current scan result. Native-driver internals, acoustic
output, hostile USB devices and firmware-wide behavior are not audited here.
The successful current manual session is documented in
[the physical report](gen1-hardware-metal-2026-10-23.md); the source extension and
licensing limits are in [write support](gen1-write-support.md). No additional
physical tests were run after the approved tone application.

Current added files: `src/gen1/tones.ts`, `test/gen1-tone.test.ts`, two offline
inspection/verifier scripts, two manual runner/guard files, source facts,
physical report, raw evidence and user command journal. Changes are confined to
Gen 1 controls/adapter/tools, Gen 1/backend tests, npm test selection and docs.

## Earlier read-only implementation validation

| Check | Result | Evidence / limits |
| --- | --- | --- |
| Baseline build | PASS | Before source changes |
| Baseline test suite | PASS / SKIPPED | 21 passed; 49 skipped |
| `npm run build` | PASS | Final source compiled without diagnostics |
| `npm test` | PASS / SKIPPED | 116 passed; 49 skipped, 165 total |
| `npm run test:gen1` | PASS | 95 offline tests across three files |
| Original runnable Gen 3 tests | PASS | Same 21 original tests pass |
| Gen 3 installed-BTS sandbox | SKIPPED | 48 tests; Gen 3 UI assets absent |
| Gen 3 live e2e | SKIPPED | 1 test; hardware/write opt-in not enabled |
| New Gen 3 mocked/default registration regression | PASS | Included in backend tests |
| Gen 1 physical discovery/identity/reads | PASS | Later authorized run at c5ac085: 20 addresses, 23/23 RQ1, matching sentinels; one inquiry, no outgoing DT1 |
| Gen 1 physical clean disconnect | PASS | Disconnected, unlocked, no cleanup error in retained report |
| Gen 1 physical write/unplug/reconnect tests | SKIPPED / DISABLED | No write API, patch-save or firmware operations; no physical fault injection |
| Retained physical evidence verification | PASS | Six original files hashed; independent verifier reproduces 23 reads / 20 addresses and zero writes offline |
| Historical local evidence verification | PASS | Offline verifier rechecked 23 transactions / 20 addresses / 46 audit records; SHA-256 AE5F5663418DFB1493230CAF6752FFB19B629B9E7F270869A139FA8517725239 |
| `npm audit --omit=dev` | PASS | Zero reported known vulnerabilities |
| `git diff --check` | PASS | No whitespace errors |
| Source/dependency license review | PASS with scope limit | MIT upstream, MIT native library/RtMidi, MIT native helper dependencies and 0BSD tslib; unlicensed local source not copied; no Roland assets copied |
| Security diff scan | PASS within static scope | Completed scan 6c6f0229-3f4b-41a4-9401-bcd806a04ada; zero reportable findings, 8 source/manifest files plus supporting changes inspected. Hardware and third-party native implementations not audited. |
| Local project preservation | PASS | All 24 recorded source/evidence hashes rechecked unchanged; original untracked Git status preserved |
| Fork publication | PASS | Authenticated GitHub connector published the requested feature branch; fetched remote and verified identical Git tree |

No skipped tests are counted as successful. The automated npm tests use fake
backends and establish no hardware compatibility themselves. The later explicitly
authorized run separately exercised real native MIDI read operations on one
device; it does not qualify writes, other firmware/models or fault recovery.

`musicplayer` started with all project files untracked, no remotes and no tracked
diff. The new checkout started clean. The 24 consulted source/evidence hashes
are retained in `gen1-source-manifest.json` for later read-only comparison.

## Changed files

- Added `src/gen1/{protocol,parameters,adapter,native-midi,tools}.ts`.
- Added `src/backend.ts`; changed only startup routing in `src/index.ts`.
- Added `test/gen1.test.ts`, `test/gen1-native.test.ts`, `test/backend.test.ts`.
- Updated `package.json` and its lockfile for the optional MIDI dependency and test script.
- Updated README and added Gen 1 architecture, compatibility, test-plan, source
  manifest, validation and unsubmitted PR-description documents.

No existing Gen 3 source module other than the entry-point registration changed.

## Subsequent physical read-only evidence

The [2026-10-23 hardware report](gen1-hardware-readonly-2026-10-23.md) records the
new adapter run at `c5ac085f1849157e8fcddfdc30e388bf6cf31540`: discovery, family/member
identity, all 11 operational and 9 explicit-research addresses, 23/23 reads, three
matching sentinels and clean disconnect. There were 24 native-returned sends
(one identity inquiry + 23 RQ1), 24 received messages, 72 audit records and zero
outgoing DT1 or other commands. Write tests stayed disabled. The result is
limited to one operator-labelled KATANA-50 Gen 1 with unknown firmware.

All six original capture files are retained byte-for-byte with a SHA-256 manifest
under `docs/evidence/gen1-readonly-2026-10-23/`. The offline-only
`scripts/Verify-Gen1ReadOnlyEvidence.py` reproduces the captured verifier's result
without overwriting proof or loading MIDI. Documentation/evidence publication does
not rerun hardware. Runtime source and permission defaults are unchanged.

The later documentation checks run `npm run build`, `npm test` and the offline
evidence verifier; the npm result remains 116 PASS / 49 SKIPPED. Physical writes,
patch save, firmware, unplug/reconnect and Gen 3 physical regression remain skipped.

## Security review evidence

Codex Security `security-diff-scan` reviewed the immutable original local range
`56b6d13786be00e31db650c3923bf047726f5ad9..6b691b8b503d1cc3a34e2c481c858c5601393ea6`.
Preflight passed without config edits. An independent architecture pass and the
parent's complete changed-source inspection found no reportable candidate.
Canonical report, coverage, threat model and SARIF are retained locally by the
plugin under scan ID `6c6f0229-3f4b-41a4-9401-bcd806a04ada`.

The host reported 5,945,944 total context/output tokens across three threads,
including 5,749,120 cached-input tokens. This is the plugin's rollout accounting,
not a separately measured billing amount. Daybreak status was granted with
Daybreak Blue available. No finding validation/attack-path phase was needed
because discovery returned no plausible candidates. Passing static review is
not proof of native-driver safety or hardware compatibility.

This final validation/PR-description update is documentation only and follows
the scanned snapshot; no runtime source was changed after that review.

## Git publication evidence

Direct HTTPS `git push --dry-run` failed because the shell has no GitHub
credentials and interactive prompts were disabled. The already connected GitHub
account had write permission to `karmasis-alicem-ozkara/boss-katana-mcp`, so the
same logical commits were published through its Git database API. Commit metadata
changed, but each remote tree SHA was checked against its local counterpart.

| Change | Original local commit | Published commit |
| --- | --- | --- |
| Protocol, MIDI adapter and tests | 1a1d7919a00f6cdbb74bfd87979af0d19ff148ff | 292bf90b2463831349663e29d355a55dfe44d001 |
| MCP backend integration | 079262f7173a460f3dce92c49c4bb8d183491152 | 7b74169e854899797e66a9a619ef93b02e4c5521 |
| Compatibility and evidence docs | 6b691b8b503d1cc3a34e2c481c858c5601393ea6 | cd9e9728c1723f058e433190019c5d63f3eabeb0 |

Reviewed and published snapshot tree: `f23d46f8e6ea469dbde45bb3329f8b006394210d`.
The clean local feature branch was aligned to the fetched published commits only
after equality checks; file contents were not reset or overwritten. Both remotes
retain their expected fork/upstream URLs. No upstream branch, issue or PR was
created. A final evidence-only documentation commit follows these three commits.
