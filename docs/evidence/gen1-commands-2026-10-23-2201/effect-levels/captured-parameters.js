import { Gen1Error } from './protocol.js';
// Raw PANEL codes are not active DSP controls. See docs/gen1-write-support.md
// for the separate shipped-editor and hardware evidence behind temporary controls.
const panel = ['AmpType', 'PanelGain', 'Volume', 'Bass', 'Middle', 'Treble',
    'Presence', 'BoosterMod', 'DelayFx', 'Reverb'];
const research = [
    ['DelayTime', [0x60, 0, 5, 0x62], 2],
    ['DelayFeedback', [0x60, 0, 5, 0x64], 1],
    ['ReverbLevel', [0x60, 0, 6, 0x18], 1],
    ['NoiseSuppressorOn', [0x60, 0, 6, 0x63], 1],
    ['NoiseSuppressorThreshold', [0x60, 0, 6, 0x64], 1],
    ['EqLowGain', [0x60, 0, 1, 0x32], 1],
    ['Fx1PhaserRate', [0x60, 0, 2, 0x76], 1],
    ['Fx1PhaserDepth', [0x60, 0, 2, 0x77], 1],
    ['SignalChainPattern', [0x60, 0, 0x12, 0], 1],
];
export const GEN1_PARAMETERS = Object.freeze([
    ...panel.map((key, i) => ({ key, address: [0, 0, 4, 0x20 + i], length: 1, research: false })),
    { key: 'TemporaryGain', address: [0x60, 0, 0, 0x52], length: 1, research: false, rawRange: [0, 120] },
    ...research.map(([key, address, length]) => ({ key, address, length, research: true,
        ...(key === 'ReverbLevel' ? { rawRange: [0, 100], writeMax: 30 } : {}),
        ...(key === 'NoiseSuppressorOn' ? { rawRange: [0, 1] } : {}),
        ...(key === 'NoiseSuppressorThreshold' ? { rawRange: [0, 100] } : {}),
    })),
    { key: 'DelayLevel', address: [0x60, 0, 5, 0x66], length: 1, research: false,
        rawRange: [0, 120], writeMax: 30 },
    // Only the five default amp algorithms, not all of the editor's hidden models.
    { key: 'TemporaryAmpType', address: [0x60, 0, 0, 0x51], length: 1, research: false,
        rawRange: [0, 27], writeValues: [1, 8, 11, 24, 23] },
    ...['Bass', 'Middle', 'Treble', 'Presence', 'Level'].map((name, i) => ({
        key: `Temporary${name}`, address: [0x60, 0, 0, 0x54 + i], length: 1, research: false,
        rawRange: [0, 100], ...(name === 'Level' ? { writeMax: 10 } : {}),
    })),
    ...[
        ['BoosterOn', [0x60, 0, 0, 0x30]], ['ModOn', [0x60, 0, 1, 0x40]],
        ['FxOn', [0x60, 0, 3, 0x4c]], ['DelayOn', [0x60, 0, 5, 0x60]],
        ['ReverbOn', [0x60, 0, 6, 0x10]],
    ].map(([key, address]) => ({
        key, address, length: 1, research: false, rawRange: [0, 1],
    })),
].map(p => Object.freeze({ ...p, address: Object.freeze(p.address),
    ...('rawRange' in p ? { rawRange: Object.freeze(p.rawRange) } : {}),
    ...('writeValues' in p ? { writeValues: Object.freeze(p.writeValues) } : {}), })));
export function parameter(key, explicitResearch = false) {
    const found = GEN1_PARAMETERS.find(p => p.key === key);
    if (!found)
        throw new Gen1Error(`Unknown Gen 1 parameter: ${key}. Use katana_gen1_list_params.`);
    if (found.research && !explicitResearch)
        throw new Gen1Error(`${key} requires explicitResearch=true; raw context-dependent research value.`);
    return found;
}
export function validateWrite(key, value) {
    const p = parameter(key, true);
    if (!p.rawRange)
        throw new Gen1Error(`${key} is read-only; no system, patch save or firmware writes.`);
    validateCurrent(p, value);
    if (p.writeValues && !p.writeValues.includes(value))
        throw new Gen1Error(`${key} supports only default raw amp codes: ${p.writeValues.join(', ')}.`);
    if (p.writeMax !== undefined && value > p.writeMax)
        throw new Gen1Error(`${key} exceeds software output ceiling ${p.writeMax}; keep physical MASTER low.`);
    return p;
}
export function validateCurrent(p, value) {
    if (!p.rawRange || !Number.isInteger(value) || value < p.rawRange[0] || value > p.rawRange[1])
        throw new Gen1Error(`${p.key} raw value must be in ${p.rawRange?.join('..')}; no DT1 sent for this value.`);
}
