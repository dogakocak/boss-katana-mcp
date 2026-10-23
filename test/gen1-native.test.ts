import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { createNativeMidiBackend, type MidiModule } from '../src/gen1/native-midi.js';

function nativeRig() {
  let input!: Input, output!: Output;
  const log: string[] = [];
  let onSend: ((data: number[]) => void) | undefined;
  let failOpen = false;
  class Input extends EventEmitter {
    constructor() { super(); input = this; }
    getPortCount() { return 1; }
    getPortName(_i: number) { return 'KATANA'; }
    openPort(i: number) { log.push(`input.open:${i}`); }
    closePort() { log.push('input.close'); }
    destroy() { log.push('input.destroy'); }
    ignoreTypes(a: boolean, b: boolean, c: boolean) { log.push(`ignore:${a},${b},${c}`); }
  }
  class Output {
    constructor() { output = this; }
    getPortCount() { return 1; }
    getPortName(_i: number) { return 'KATANA'; }
    openPort(i: number) { if (failOpen) throw new Error('WinMM busy'); log.push(`output.open:${i}`); }
    closePort() { log.push('output.close'); }
    destroy() { log.push('output.destroy'); }
    sendMessage(data: number[]) { log.push('send'); onSend?.(data); }
  }
  const backend = createNativeMidiBackend(async () => ({ Input, Output }) as MidiModule);
  return { backend, log, input: () => input, output: () => output,
    onSend: (fn: typeof onSend) => { onSend = fn; }, failOpen: () => { failOpen = true; } };
}

describe('Native MIDI bridge with injected constructors only', () => {
  it('enumerates without opening a port and releases both native objects', async () => {
    const r = nativeRig(); expect(await r.backend.list()).toEqual({ inputs: ['KATANA'], outputs: ['KATANA'] });
    expect(r.log).toEqual(['output.close', 'output.destroy', 'input.close', 'input.destroy']);
  });
  it('installs listener before send, enables SysEx and removes listeners on completion', async () => {
    const r = nativeRig(); const c = await r.backend.open(0, 0);
    r.onSend(() => r.input().emit('message', 0, [0xf0, 0xf7]));
    expect(await c.exchange([0xf0, 0xf7], 100)).toEqual([0xf0, 0xf7]);
    expect(r.log[0]).toBe('ignore:false,true,true');
    expect(r.input().listenerCount('message')).toBe(0); await c.close();
  });
  it('ignores non-SysEx events and rejects concurrent exchange', async () => {
    const r = nativeRig(); const c = await r.backend.open(0, 0);
    const pending = c.exchange([0xf0, 0xf7], 100);
    r.input().emit('message', 0, [0x90, 60, 1]);
    await expect(c.exchange([0xf0, 0xf7], 100)).rejects.toThrow('Concurrent');
    r.input().emit('message', 0, [0xf0, 1, 0xf7]);
    expect(await pending).toEqual([0xf0, 1, 0xf7]); await c.close();
  });
  it('releases pending exchange on close and rejects subsequent sends', async () => {
    const r = nativeRig(); const c = await r.backend.open(0, 0);
    const pending = c.exchange([0xf0, 0xf7], 100);
    const rejection = expect(pending).rejects.toThrow('closed');
    await c.close(); await rejection; await c.close();
    await expect(c.send([0xf0, 0xf7])).rejects.toThrow('disconnected');
    expect(r.input().listenerCount('message')).toBe(0);
    expect(r.log.filter(s => s === 'input.destroy')).toHaveLength(1);
  });
  it('times out and cleans the event listener', async () => {
    const r = nativeRig(); const c = await r.backend.open(0, 0);
    await expect(c.exchange([0xf0, 0xf7], 10)).rejects.toThrow('timeout');
    expect(r.input().listenerCount('message')).toBe(0); await c.close();
  });
  it('cleans listeners when native send throws', async () => {
    const r = nativeRig(); const c = await r.backend.open(0, 0); r.onSend(() => { throw new Error('unplugged'); });
    await expect(c.exchange([0xf0, 0xf7], 100)).rejects.toThrow('unplugged');
    expect(r.input().listenerCount('message')).toBe(0); await c.close();
  });
  it('releases partially opened resources on driver failure', async () => {
    const r = nativeRig(); r.failOpen(); await expect(r.backend.open(0, 0)).rejects.toThrow('WinMM busy');
    expect(r.log).toContain('input.destroy'); expect(r.log).toContain('output.destroy');
  });
  it('has one process owner across backend instances', async () => {
    const a = nativeRig(), b = nativeRig(); const c = await a.backend.open(0, 0);
    await expect(b.backend.open(0, 0)).rejects.toThrow('already owned');
    await c.close(); const next = await b.backend.open(0, 0); await next.close();
  });
  it('propagates missing optional backend without opening anything', async () => {
    const b = createNativeMidiBackend(async () => { throw new Error('module unavailable'); });
    await expect(b.list()).rejects.toThrow('module unavailable');
  });
});
