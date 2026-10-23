export type ControlScope = 'patch' | 'system';
export interface ControlDef { key: string; name: string; scope: ControlScope; pid: string; elementId: string }
export interface ControlReading { key: string; value: number; label: string | null }

const patch = (key: string, name: string, pid: string, elementId: string): ControlDef => ({ key, name, scope: 'patch', pid, elementId });
const system = (key: string, name: string, pid: string, elementId: string): ControlDef => ({ key, name, scope: 'system', pid, elementId });

/** Footswitch and expression pedal function selectors, with the BTS select box that lists their option names. */
export const CONTROLS: ControlDef[] = [
  patch('amp.foot_sw_tip', 'Amp FOOT SW jack, TIP', 'PATCH%ASSIGN_FS%0', 'asgn-tip-function-select-box'),
  patch('amp.foot_sw_ring', 'Amp FOOT SW jack, RING', 'PATCH%ASSIGN_FS%1', 'asgn-ring-function-select-box'),
  patch('amp.exp_pedal', 'Amp EXP PEDAL jack', 'PATCH%ASSIGN_EXPPDL_FUNC%0', 'asgn-pedal-function-select-box'),
  ...[1, 2, 3].map(n => patch(`gafc.fs${n}`, `GA-FC FS${n}`, `PATCH%ASSIGN_GAFCFS(1)%${n - 1}`, `asgn-fs${n}-function-select-box`)),
  ...[1, 2, 3].map(n => patch(`gafc_ex.fs${n}`, `GA-FC EX FS${n}`, `PATCH%ASSIGN_GAFCFS(2)%${n - 1}`, `asgn-expand-fs${n}-function-select-box`)),
  ...[1, 2, 3].map(n => patch(`gafc.exp${n}`, n === 3 ? 'GA-FC EX EXP3' : `GA-FC EXP${n}`, `PATCH%ASSIGN_GAFCEXPPDL${n}_FUNC(1)%0`, `asgn-exp${n}-function-select-box`)),
  ...[1, 2, 3, 4].map(n => system(`gafc.ch${n}`, `GA-FC CH${n} (global)`, `SYSTEM%GAFC%${n - 1}`, `system-gafc-sw${n}-function-select-box`)),
  system('gafc.panel', 'GA-FC PANEL (global)', 'SYSTEM%GAFC%4', 'system-gafc-sw5-function-select-box'),
];

const NOTE = 'These are the assignments stored in the amp; BOSS TONE STUDIO cannot tell which pedals or footswitches are physically plugged in.';

export function describeControls(readings: ControlReading[], o: { gafc: boolean; connected: boolean }) {
  const scopeOf = new Map(CONTROLS.map(c => [c.key, c.scope]));
  const patchOut: Record<string, string> = {};
  const systemOut: Record<string, string> = {};
  for (const r of readings) {
    (scopeOf.get(r.key) === 'system' ? systemOut : patchOut)[r.key] = r.label ?? `value ${r.value}`;
  }
  const warnings: string[] = [];
  if (!o.connected) warnings.push('No KATANA is connected: these are BOSS TONE STUDIO defaults, not what the amp holds.');
  if (!o.gafc) warnings.push('This KATANA model has no GA-FC support; the gafc / gafc_ex entries do not apply.');
  return { note: NOTE, warnings, patch: patchOut, system: systemOut };
}
