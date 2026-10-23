---
name: katana-tone
description: Use when the user describes a guitar tone, asks to change BOSS KATANA Gen 3 amp/effect settings ("volume 12 yap", "80'ler hard rock lead", "biraz daha parlak", "delay ekle"), or wants to save, recall or organise tones (write to a channel, livesets, .tsl files). Drives the katana MCP tools; BOSS TONE STUDIO shows every change live.
---

# KATANA tone

Tools (MCP server `katana`): `katana_status`, `katana_launch`, `katana_connect`, `katana_get`, `katana_set`, `katana_list_params`;
saving: `katana_list_patches`, `katana_select_patch`, `katana_write`; library: `katana_liveset_list`, `katana_liveset_create`,
`katana_liveset_rename`, `katana_liveset_delete`, `katana_liveset_add_current`, `katana_liveset_load`, `katana_liveset_to_amp`,
`katana_liveset_from_amp`, `katana_liveset_export`, `katana_liveset_import`.

## Workflow
1. `katana_status`. If it errors as not reachable → `katana_launch`. If it reports `ampConnected: false` →
   `katana_connect`. Both answer BTS's "Connect with" dialog themselves and return only once the amp's patch is
   loaded, with `ampConnected` and `patchName`.
   Trust `katana_get` values only when `ampConnected` is `true`: until then BTS shows stale defaults (e.g.
   `amp.volume: 50`, patch name `"KATANA"`) rather than what the amp holds. If it comes back `false`, tell the user
   its `message` (e.g. amp off / USB unplugged) and ask before continuing (editing the cold/default patch).
2. `katana_get` (all sections, or the ones you will touch).
3. Decide the change. Relative requests ("biraz daha", "less gain") are relative to step 2's values.
   Need a detail parameter (chorus rate, harmonist interval, ...)? `katana_list_params` for that section first.
4. One `katana_set` with every change together.
5. Reply in 2–4 lines: what changed (old → new) and why. If `warnings` says no amp is connected, say so.

## Rules
- Changes are live edits of the current patch. They are not saved until written: offer `katana_write` (or a liveset) when the user likes the tone. Never claim it is saved unless a write/add tool succeeded.
- Effects edit the variation the panel currently shows (green/red/yellow, see `katana_status`).
- Turning an effect on: set both `<section>.on: true` and its type/levels.
- Values are integers within the listed range; types by name (`"amp.type": "LEAD"`, `"booster.type": "T-SCREAM"`).
- Keep volume changes moderate unless asked; never jump `amp.volume` by more than 20 in one step without the user asking.
- `*.high_cut`, `*.low_cut`, `*_freq`, `*_q`, `reverb.density`, `other.chain`, `other.cabinet_resonance`,
  `other.master_key`, `eq.type`, `eq.position`, `pedalfx.type` are list indexes (a position into a fixed option
  list), not Hz or ms values. `katana_list_params` gives only the min/max index for those params, not the option
  labels, so prefer leaving them unchanged unless the user specifically asks to change one.

## Saving and the library
- Save to the amp ("kaydet", "A2'ye yaz", "save this"): `katana_list_patches` → pick the slot the user named (ask if none) →
  `katana_write { slot, name }`. Names: max 16 plain ASCII chars (write "COK GUZEL", not "Çok Güzel").
- `katana_write`, `katana_liveset_add_current` (with position), `katana_liveset_to_amp` and `katana_liveset_export` refuse to
  replace something that exists and say what is there. Tell the user what would be lost and ask; only after a yes call again
  with `overwrite: true`. Never pass `overwrite: true` on the first try.
- Slots: PANEL, A1–A4, B1–B4 (KATANA-50: A1, A2, B1, B2). Liveset transfers skip PANEL.
- Livesets live in BOSS TONE STUDIO's library on this PC (max 50, 15 patches each), not on the amp. Refer to them by the
  number or name from `katana_liveset_list`.
- "Try" a stored tone: `katana_liveset_load` (edit buffer only) or `katana_select_patch` (amp slot).
- Selecting a slot or loading a liveset patch replaces the current tone. If the user built or changed a tone in this session and has not saved it, offer to save it first (katana_write / katana_liveset_add_current).
- Delete a liveset only after the user confirms by name.
- Export/import: report the file path the tool returns.

## Section keys
amp (type, gain, volume, bass, middle, treble, presence, resonance, preamp_variation, poweramp_variation) ·
booster (on, type, drive, bottom, tone, effect_level, direct_mix, solo_sw, solo_level) ·
mod / fx (on, type, + `<type>_<param>` details) · delay / delay2 (on, type, time ms, feedback, high_cut, effect_level, direct_level, mod_rate, mod_depth) ·
reverb (on, type, time, pre_delay, low_cut, high_cut, density, effect_level, direct_level, spring_color) ·
ns (sw, threshold, release) · eq (sw, type, position, peq_*, ge10_*) · eq2 (same keys as eq) ·
solo (solo.sw, solo.effect_level, solo.eq_* [position, sw, low_cut, low_gain, mid_freq, mid_q, mid_gain, high_gain, high_cut, level], solo.delay_* [sw, carryover, time, feedback, effect_level, direct_level, filter, high_cut, mod_sw, mod_rate, mod_depth]) ·
pedalfx · other (chain, cabinet_resonance, master_key)

## Types
- Amp: ACOUSTIC, CLEAN, PUSHED, CRUNCH, LEAD, BROWN
- Booster: MID BOOST, CLEAN BOOST, TREBLE BOOST, CRUNCH OD, NATURAL OD, WARM OD, FAT DS, METAL DS, OCT FUZZ, BLUES DRIVE, OVERDRIVE, T-SCREAM, TURBO OD, DISTORTION, RAT, GUV DS, DST+, METAL ZONE, '60S FUZZ, MUFF FUZZ, HM-2, METAL CORE, CENTA OD
- MOD/FX: T.WAH, AUTO WAH, PEDAL WAH, COMP, LIMITER, GRAPHIC EQ, PARAMETRIC EQ, GUITAR SIM, SLOW GEAR, WAVE SYNTH, OCTAVE, PITCH SHIFTER, HARMONIST, AC.PROCESSOR, PHASER, FLANGER, TREMOLO, ROTARY, UNI-V, SLICER, VIBRATO, RING MOD, HUMANIZER, CHORUS, AC.GUITAR SIM, PHASER 90E, FLANGER 117E, WAH 95E, DC-30, HEAVY OCTAVE, PEDAL BEND
- Delay: DIGITAL, PAN, STEREO, ANALOG, TAPE ECHO, REVERSE, MODULATE, SDE-3000
- Reverb: PLATE, ROOM, HALL, SPRING, MODULATE

## Starting points (then adjust by ear with the user)
| Style | Amp | Gain | B/M/T | Booster | Mod/FX | Delay | Reverb |
|---|---|---|---|---|---|---|---|
| Clean jazz | CLEAN | 20 | 60/50/35 | off | off | off | reverb.type ROOM, reverb.effect_level 25 |
| Funk clean | CLEAN | 30 | 45/55/65 | off | mod.type COMP | off | reverb.type ROOM, reverb.effect_level 15 |
| Blues | CRUNCH | 45 | 55/60/50 | booster.type BLUES DRIVE, booster.drive 40 | off | delay.type ANALOG, delay.time 350, delay.feedback 20, delay.effect_level 25 | reverb.type SPRING, reverb.effect_level 30 |
| Classic rock | CRUNCH | 60 | 55/60/60 | booster.type T-SCREAM, booster.drive 30 | off | delay.type ANALOG, delay.time 400, delay.effect_level 20 | reverb.type ROOM, reverb.effect_level 25 |
| 80s hard rock lead | LEAD | 70 | 55/55/65 | booster.type T-SCREAM, booster.drive 20, booster.tone 10 | mod.type CHORUS, defaults | delay.type DIGITAL, delay.time 450, delay.feedback 30, delay.effect_level 30 | reverb.type HALL, reverb.effect_level 35 |
| Modern metal rhythm | BROWN | 75 | 60/40/60 | booster.type T-SCREAM, booster.drive 0, booster.effect_level 80 | off | off | reverb.type ROOM, reverb.effect_level 10, ns.sw on, ns.threshold 40 |
| Ambient | CLEAN | 25 | 50/50/55 | off | mod.type CHORUS | delay.type DIGITAL, delay.time 600, delay.feedback 50, delay.effect_level 40, delay2.on true, delay2.type REVERSE | reverb.type HALL, reverb.effect_level 60 |
