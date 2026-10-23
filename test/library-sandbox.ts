import { createSandbox, type Sandbox } from './bts-sandbox.js';

/** BTS scripts the librarian and patch WRITE need, in index.html order. */
const LIBRARY_FILES = [
  'js/common/readwrite_logic.js',
  'js/common/librarian_cell.js',
  'js/common/librarian.js',
  'js/businesslogic/bts/address_const.js',
  'js/businesslogic/bts/patch_controller.js',
  'js/businesslogic/bts/util.js',
  'js/businesslogic/bts/librarian/librarian_const.js',
  'js/businesslogic/bts/librarian/librarian_model.js',
  'js/businesslogic/bts/librarian/librarian_services.js',
  'js/businesslogic/ktn/liveset_converter.js',
  'js/businesslogic/ktn/model_info.js',
];

/** jQuery stand-in: $(fn) runs fn (BTS's ready handlers); every other call returns a chainable no-op. */
function fakeJQuery(): (a: unknown) => unknown {
  const chain: unknown = new Proxy(function () {}, {
    get: (_t, k) => (k === 'length' ? 0 : () => chain),
    apply: () => chain,
  });
  return (a: unknown) => { if (typeof a === 'function') (a as () => void)(); return chain; };
}

/** Roland DT1 frame for this model (device 10, model 010507), as the amp would send it. */
export function dt1Frame(addr: string, data: string): string {
  const body = addr + data;
  let sum = 0;
  for (let i = 0; i < body.length; i += 2) sum += parseInt(body.substr(i, 2), 16);
  const chk = ((128 - (sum % 128)) & 0x7f).toString(16).toUpperCase().padStart(2, '0');
  return `F0411001050712${body}${chk}F7`;
}

export async function until(fn: () => boolean, ms = 2000): Promise<void> {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error('until: condition not met in time');
    await new Promise(r => setTimeout(r, 5));
  }
}

export interface LibrarySandboxOptions { connected?: boolean; model?: string; names?: string[] }
export interface LibrarySandboxBase {
  sb: Sandbox;
  storage: Record<string, string>;
  /** BTS UI/editor calls the stubs saw, in order. */
  calls(): string[];
  /** Outgoing DT1s as "ADDRESS:DATA". */
  dt1(): string[];
  /** Feeds a DT1 from the "amp" into BTS's MIDI input. */
  reply(addr: string, data: string): void;
}

/**
 * BTS librarian + patch controller in a vm, initialised like index.js does (initLibrarian),
 * with the DOM-heavy controllers replaced by recorders.
 */
export function createBtsLibrarySandbox(o: LibrarySandboxOptions = {}): LibrarySandboxBase {
  const storage: Record<string, string> = {};
  const $ = fakeJQuery();
  const sb = createSandbox({
    files: LIBRARY_FILES,
    globals: { $, jQuery: $ },
    native: { app: { storage2: (k: string, v?: string) => (v === undefined ? storage[k] : (storage[k] = v)), control: () => {} } },
  });
  sb.run(`
    librarianCommonInfo.librarians.push(new Librarian(ProductSetting.librarian[0].config));
    librarianCommonInfo.instLiveset = new LibrarianModel('', true);
    modelInfo.setModel(${JSON.stringify(o.model ?? '06')});
    librarianServices.loadLivesetList();
    globalThis.__calls = [];
    window.btsDOMController = {
      openLoading: function () { __calls.push('openLoading'); },
      closeLoading: function () { __calls.push('closeLoading'); }
    };
    window.midiConnectionController = {
      readEditor: function (idx, ok) { __calls.push('readEditor ' + idx.join()); setTimeout(ok, 0); return function () {}; }
    };
    window.setupKnobModFxTargetList = function () { __calls.push('setupKnobModFxTargetList'); };
    librarianDynamicDOMController.updateLivesetTableCell = function () { __calls.push('redraw'); };
    globalThis.__dt1 = [];
    var __origDt1 = MIDIController.dt1;
    MIDIController.dt1 = function (a, d) { __dt1.push(util.convert2AddrStr(_7bitize(a)) + ':' + d); return __origDt1(a, d); };
  `);
  if (o.connected ?? true) sb.run('window.currentMIDIConnect = {}');
  if (o.names) sb.run(`patchModelController.updateUserPatchNames(${JSON.stringify(o.names)})`);
  return {
    sb,
    storage,
    calls: () => sb.run<string[]>('__calls.slice()'),
    dt1: () => sb.run<string[]>('__dt1.slice()'),
    reply: (addr, data) => sb.incoming(dt1Frame(addr, data)),
  };
}
