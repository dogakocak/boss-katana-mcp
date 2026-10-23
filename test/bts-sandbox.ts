import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

export const BTS_HTML = join(process.env.LOCALAPPDATA ?? '', 'Roland', 'BOSS TONE STUDIO for KATANA Gen 3', 'html');
export const btsInstalled = existsSync(join(BTS_HTML, 'js', 'common', 'parameter.js'));

const FILES = [
  'js/utilities/constant.js',
  'js/utilities/converter.js',
  'js/config/address_map.js',
  'js/config/editor_setting.js',
  'js/config/librarian_setting.js',
  'js/config/product_setting.js',
  'js/common/midi_controller.js',
  'js/common/parameter.js',
];

export interface Sandbox {
  run<T = unknown>(code: string): T;
  incoming(msg: string): void;
  sent: string[];
  /** Invokes MIDIController's own setInterval(timerproc) callback once, draining one queued message into `sent`. */
  tick(): void;
}

export interface SandboxOptions {
  /** More BTS files (relative to html/), loaded after FILES in this order. */
  files?: string[];
  /** Extra globals on the page window (e.g. a jQuery stand-in). */
  globals?: Record<string, unknown>;
  /** Extra members of $native besides midi (e.g. app.storage2). */
  native?: Record<string, unknown>;
}

/** Loads BTS's own parameter/MIDI scripts into an isolated vm context, like the WebView page. */
export function createSandbox(opts: SandboxOptions = {}): Sandbox {
  const sent: string[] = [];
  let intervalCallback: (() => void) | undefined;
  const midi = {
    event: {} as { message?: (msg: string, ts: number) => void },
    send: (msg: string) => { sent.push(msg); },
  };
  const win: Record<string, unknown> = {
    console, setTimeout, clearTimeout,
    // Stores the callback instead of invoking it, so MIDIController's queue only drains on tick().
    setInterval: (fn: () => void) => { intervalCallback = fn; return 0; },
    clearInterval: () => {},
    navigator: { language: 'en', userAgent: 'Chrome' },
    $native: { midi, ...opts.native },
    ...opts.globals,
  };
  win.window = win;
  const ctx = vm.createContext(win);
  for (const f of [...FILES, ...(opts.files ?? [])]) vm.runInContext(readFileSync(join(BTS_HTML, f), 'utf8'), ctx, { filename: f });
  return {
    run: <T>(code: string) => vm.runInContext(code, ctx) as T,
    incoming: (msg: string) => midi.event.message!(msg, 0),
    sent,
    tick: () => intervalCallback?.(),
  };
}

export function readBtsFile(rel: string): string {
  return readFileSync(join(BTS_HTML, rel), 'utf8');
}
