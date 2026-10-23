import { Gen1Error } from './protocol.js';

// A starting sound chosen by ear may differ with guitar, pickup and speaker.
// Values are raw DSP values, not translations of the physical knob positions.
export const METAL_TONE = Object.freeze([
  ['TemporaryAmpType', 23], // SLDN / default Brown; NOT panel code 4.
  ['BoosterOn', 0], ['ModOn', 0], ['FxOn', 0], ['DelayOn', 0], ['ReverbOn', 0],
  ['TemporaryGain', 85], ['TemporaryBass', 60], ['TemporaryMiddle', 40],
  ['TemporaryTreble', 65], ['TemporaryPresence', 45],
  ['NoiseSuppressorOn', 1], ['NoiseSuppressorThreshold', 55],
].map(([key, value]) => Object.freeze({ key: key as string, value: value as number })));

export function tonePlan(name: string, outputLevel: number = 5) {
  if (name !== 'metal') throw new Gen1Error('Unknown Gen 1 tone; available: metal.');
  if (!Number.isInteger(outputLevel) || outputLevel < 0 || outputLevel > 10)
    throw new Gen1Error('outputLevel must be an integer in 0..10.');
  return { name, experimental: true, rawValues: true, changes: METAL_TONE,
    requestedOutputLevel: outputLevel,
    outputPolicy: 'Pre-read all fields; reduce temporary LEVEL to 0 first; final LEVEL is min(previous, requested). No patch save. Physical MASTER must remain low.',
    warning: 'Sequential, not atomic. Stops and locks on uncertainty; no automatic retry or rollback. Readback does not prove the audible result.' };
}
