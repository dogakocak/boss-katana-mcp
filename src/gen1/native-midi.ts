import type { MidiBackend, MidiConnection, MidiPorts } from './adapter.js';
import { Gen1Error } from './protocol.js';

// Structural types keep the build usable with npm install --omit=optional.
export interface NativePort {
  getPortCount(): number;
  getPortName(index: number): string;
  openPort(index: number): void;
  closePort(): void;
  destroy(): void;
}
export interface NativeInput extends NativePort {
  ignoreTypes(sysex: boolean, timing: boolean, sensing: boolean): void;
  on(event: 'message', listener: (delta: number, data: number[]) => void): unknown;
  removeListener(event: 'message', listener: (delta: number, data: number[]) => void): unknown;
}
export interface NativeOutput extends NativePort { sendMessage(data: number[]): void }
export interface MidiModule { Input: new () => NativeInput; Output: new () => NativeOutput }

async function loadMidi(): Promise<MidiModule> {
  try {
    const packageName = '@julusian/midi';
    return await import(packageName) as MidiModule;
  } catch {
    throw new Gen1Error('Optional @julusian/midi native backend unavailable. Install optional dependencies for your Node/Windows architecture.');
  }
}

// One port owner across backend/adapter instances in this process. WinMM open
// errors handle other processes; operators must close BTS/other MIDI clients.
let owned = false;

function releasePorts(input: NativeInput, output: NativeOutput): void {
  // Attempt every release even if partial open or cleanup fails.
  const errors: unknown[] = [];
  for (const port of [output, input]) {
    try { port.closePort(); } catch (e) { errors.push(e); }
    try { port.destroy(); } catch (e) { errors.push(e); }
  }
  if (errors.length) throw new Gen1Error('Could not release all native MIDI resources; restart server.');
}

export function createNativeMidiBackend(load: () => Promise<MidiModule> = loadMidi): MidiBackend {
  async function allocate(): Promise<{ input: NativeInput; output: NativeOutput }> {
    const midi = await load();
    const input = new midi.Input();
    try { return { input, output: new midi.Output() }; }
    catch (e) { input.destroy(); throw e; }
  }
  return {
    async list(): Promise<MidiPorts> {
      const { input, output } = await allocate();
      try {
        const names = (p: NativePort) => Array.from({ length: p.getPortCount() }, (_, i) => p.getPortName(i));
        return { inputs: names(input), outputs: names(output) };
      } finally { releasePorts(input, output); }
    },
    async open(inputIndex, outputIndex): Promise<MidiConnection> {
      if (owned) throw new Gen1Error('MIDI ports already owned by another Gen 1 adapter.');
      owned = true;
      let ports: Awaited<ReturnType<typeof allocate>>;
      try { ports = await allocate(); }
      catch (e) { owned = false; throw e; }
      const { input, output } = ports;
      let closed = false;
      let pending: ((error: Error) => void) | undefined;
      const close = async () => {
        if (closed) return;
        closed = true;
        pending?.(new Gen1Error('MIDI connection closed before reply.'));
        // A failed cleanup retains ownership until process restart.
        releasePorts(input, output);
        owned = false;
      };
      try {
        input.ignoreTypes(false, true, true);
        input.openPort(inputIndex);
        output.openPort(outputIndex);
      } catch (e) { await close(); throw e; }
      return {
        close,
        async send(message) {
          if (closed) throw new Gen1Error('MIDI device disconnected.');
          output.sendMessage([...message]);
        },
        exchange(message, timeoutMs) {
          if (closed) return Promise.reject(new Gen1Error('MIDI device disconnected.'));
          if (pending) return Promise.reject(new Gen1Error('Concurrent native MIDI exchange rejected.'));
          return new Promise<number[]>((resolve, reject) => {
            let settled = false;
            const finish = (error?: Error, data?: number[]) => {
              if (settled) return;
              settled = true;
              clearTimeout(timer);
              input.removeListener('message', onMessage);
              pending = undefined;
              if (error) reject(error); else resolve(data!);
            };
            const onMessage = (_delta: number, data: number[]) => {
              // Non-SysEx MIDI is unrelated. Any SysEx reply is validated strictly
              // by the adapter; wrong/checksum-corrupt responses poison the session.
              if (data[0] === 0xf0) finish(undefined, [...data]);
            };
            const timer = setTimeout(() => finish(new Gen1Error('MIDI response timeout; no retry.')), timeoutMs);
            pending = error => finish(error);
            input.on('message', onMessage);
            try { output.sendMessage([...message]); }
            catch (e) { finish(new Gen1Error(`MIDI send failed: ${String(e)}`)); }
          });
        },
      };
    },
  };
}
