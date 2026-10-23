import { describe, expect, it } from 'vitest';
import { CONTROLS, describeControls } from '../src/controls.js';
import { agentCall } from '../src/page-agent.js';
import { btsInstalled, createSandbox, readBtsFile } from './bts-sandbox.js';

const FS_OPTIONS = ['BANK A/B', 'PEDAL FX ON/OFF', 'SEND/RETURN ON/OFF', 'EQ ON/OFF', 'EQ2 ON/OFF', 'DELAY TAP', 'DELAY2 TAP', 'BOOSTER SOLO ON/OFF', 'SOLO ON/OFF', 'GLOBAL EQ ON/OFF'];
const TIP_OPTIONS = ['CH 1/2', 'BANK A/B', 'SOLO ON/OFF'];
const PEDAL_OPTIONS = ['VOLUME', 'FOOT VOLUME', 'PEDAL FX', 'PEDAL FX/FV', 'BOOSTER', 'MOD', 'FX', 'DELAY', 'DELAY2', 'REVERB'];

/** Option texts per select box id, as BTS renders them (display order). */
function optionsFor(id: string): string[] {
  if (id.includes('tip') || id.includes('ring')) return TIP_OPTIONS;
  if (id.includes('pedal-function') || /exp\d-function/.test(id)) return PEDAL_OPTIONS;
  return FS_OPTIONS;
}

/** Sandbox with BTS's item.json loader and a jQuery stand-in that serves the option lists. */
function controlsSandbox() {
  const $ = (x: unknown) => {
    if (typeof x === 'string') {
      const id = /^#(\S+)/.exec(x)![1];
      return { map: (fn: (this: unknown) => string) => ({ get: () => optionsFor(id).map(t => fn.call(t)) }) };
    }
    return { text: () => String(x) };
  };
  return createSandbox({ globals: { $, _load: (p: string) => readBtsFile(p) } });
}

describe('controls catalog', () => {
  it('lists every jack and GA-FC switch with unique keys', () => {
    expect(CONTROLS.map(c => c.key)).toEqual([
      'amp.foot_sw_tip', 'amp.foot_sw_ring', 'amp.exp_pedal',
      'gafc.fs1', 'gafc.fs2', 'gafc.fs3', 'gafc_ex.fs1', 'gafc_ex.fs2', 'gafc_ex.fs3',
      'gafc.exp1', 'gafc.exp2', 'gafc.exp3',
      'gafc.ch1', 'gafc.ch2', 'gafc.ch3', 'gafc.ch4', 'gafc.panel',
    ]);
    expect(CONTROLS.filter(c => c.scope === 'system').map(c => c.pid)).toEqual(['SYSTEM%GAFC%0', 'SYSTEM%GAFC%1', 'SYSTEM%GAFC%2', 'SYSTEM%GAFC%3', 'SYSTEM%GAFC%4']);
  });

  it('describes readings by scope, falls back to the raw value, and notes the limits', () => {
    const out = describeControls(
      [{ key: 'amp.foot_sw_tip', value: 0, label: 'CH 1/2' }, { key: 'gafc.ch1', value: 6, label: 'BOOSTER SOLO ON/OFF' }, { key: 'gafc.fs1', value: 42, label: null }],
      { gafc: false, connected: false },
    );
    expect(out.patch).toEqual({ 'amp.foot_sw_tip': 'CH 1/2', 'gafc.fs1': 'value 42' });
    expect(out.system).toEqual({ 'gafc.ch1': 'BOOSTER SOLO ON/OFF' });
    expect(out.note).toContain('cannot tell which pedals or footswitches are physically plugged in');
    expect(out.warnings).toEqual([
      'No KATANA is connected: these are BOSS TONE STUDIO defaults, not what the amp holds.',
      'This KATANA model has no GA-FC support; the gafc / gafc_ex entries do not apply.',
    ]);
  });
});

describe.skipIf(!btsInstalled)('page agent controls', () => {
  it('maps values to BTS option names through item.json list_order', () => {
    const sb = controlsSandbox();
    sb.run('Parameter.setValue("SYSTEM%GAFC%0", INTEGER1x7, 0, 6); Parameter.setValue("SYSTEM%GAFC%1", INTEGER1x7, 0, 9)');
    sb.run('Parameter.setValue("PATCH%ASSIGN_FS%1", INTEGER1x7, 0, 2); Parameter.setValue("PATCH%ASSIGN_EXPPDL_FUNC%0", INTEGER1x7, 0, 3)');
    const defs = CONTROLS.map(({ key, pid, elementId }) => ({ key, pid, elementId }));
    const out = sb.run<{ gafc: boolean; readings: { key: string; value: number; label: string | null }[] }>(agentCall('controls', defs));
    const by = Object.fromEntries(out.readings.map(r => [r.key, r]));
    expect(by['gafc.ch1']).toEqual({ key: 'gafc.ch1', value: 6, label: 'BOOSTER SOLO ON/OFF' });
    expect(by['gafc.ch2']).toEqual({ key: 'gafc.ch2', value: 9, label: 'EQ2 ON/OFF' });
    expect(by['amp.foot_sw_ring'].label).toBe('SOLO ON/OFF');
    expect(by['amp.exp_pedal'].label).toBe('PEDAL FX/FV');
    expect(out.readings).toHaveLength(CONTROLS.length);
    expect(out.gafc).toBe(true); // no modelInfo in this sandbox → assume supported
  });

  it('returns a null label for a value outside the option list', () => {
    const sb = controlsSandbox();
    sb.run('Parameter.setValue("PATCH%ASSIGN_FS%0", INTEGER1x7, 0, 7)');
    const out = sb.run<{ readings: { key: string; label: string | null }[] }>(agentCall('controls', [{ key: 'amp.foot_sw_tip', pid: 'PATCH%ASSIGN_FS%0', elementId: 'asgn-tip-function-select-box' }]));
    expect(out.readings[0]).toEqual({ key: 'amp.foot_sw_tip', value: 7, label: null });
  });
});
