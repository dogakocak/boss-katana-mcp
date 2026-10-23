import { LIBRARY_BODY } from './library-agent.js';

export interface Leaf { bid: string; pid: string; name: string; size: number; ofs: number; min: number; max: number }
export interface AgentStatus { connected: boolean; patchName: string; colors: number[] }
export interface WriteChange { pid: string; value: number }
export interface ConnectStart { started: boolean; already?: boolean; pending?: boolean; device?: string; reason?: string }

/**
 * FNV-1a 32-bit hash, hex-encoded. Used to derive PAGE_AGENT_SOURCE's version tag from its own
 * body, so a page already holding an older build's agent gets replaced instead of kept.
 */
function fnv1aHex(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/**
 * Runs inside the BTS WebView page (plain ES5-ish JS, no imports).
 * Uses BTS globals: AddressMap, Parameter, $native, _7bitize, hex2, STX, ROLAND, DT1, EOX,
 * ProductSetting, INTEGER* size constants, currentMIDIConnect, and for connect(): $ (jQuery), util, midiConnectionController,
 * btsDOMController, popup_close.
 *
 * `__KATANA_CLAUDE_AGENT_VERSION__` is a placeholder substituted below with a hash of this
 * body, so the IIFE's guard rejects (and replaces) any agent left by a different build.
 */
const AGENT_BODY = String.raw`(function () {
  if (window.__katanaClaude && window.__katanaClaude.v === __KATANA_CLAUDE_AGENT_VERSION__) return;
  var leaves = null, byPid = {};

  function bytesOf(size) {
    if (size === INTEGER2x4 || size === INTEGER2x7) return 2;
    if (size === INTEGER4x4) return 4;
    return 1;
  }

  function index() {
    if (leaves) return leaves;
    leaves = [];
    var root = new AddressMap().root;
    var patch = root.filter(function (b) { return b.name === 'PATCH'; })[0];
    patch.child.forEach(function (blk) {
      var bid = 'PATCH%' + blk.name;
      blk.child.forEach(function (p) {
        if (p.size < INTEGER1x1) return; // string params (patch name)
        var leaf = { bid: bid, pid: bid + '%' + p.addr, name: p.name, size: p.size, ofs: p.ofs, min: p.min, max: p.max };
        leaves.push(leaf);
        byPid[leaf.pid] = leaf;
      });
    });
    return leaves;
  }

  function leafOf(pid) {
    index();
    var l = byPid[pid];
    if (!l) throw new Error('unknown pid ' + pid);
    return l;
  }

  function read(pids) {
    var out = {};
    pids.forEach(function (pid) { var l = leafOf(pid); out[pid] = Parameter.value(pid, l.size, l.ofs); });
    return out;
  }

  // Replays the bytes now in Parameter's buffer as an incoming DT1, so BTS redraws the UI.
  function mirrorToUi(l) {
    var off = parseInt(l.pid.split('%').pop(), 10);
    var data = Parameter.paramSet[l.bid].slice(off, off + bytesOf(l.size)).join('');
    var addr = _7bitize(Parameter.getblock(l.bid).addr + off).toString(16).toUpperCase();
    while (addr.length < 8) addr = '0' + addr;
    var sum = 0, body = addr + data;
    for (var i = 0; i < body.length; i += 2) sum += parseInt(body.substr(i, 2), 16);
    var msg = STX + ROLAND + ProductSetting.deviceId + ProductSetting.modelId + DT1 + body + hex2((128 - (sum % 128)) & 0x7f) + EOX;
    $native.midi.event.message(msg, 0);
  }

  // Briefly shows BTS's own loading popup so a remote edit is noticeable on screen. The amp has
  // no command for a panel animation; this is the closest visible cue.
  var FLASH_MS = 700, flashTimer = null;
  function flash() {
    if (!window.btsDOMController) return;
    if (flashTimer === null) btsDOMController.openLoading();
    else clearTimeout(flashTimer);
    flashTimer = setTimeout(function () { flashTimer = null; btsDOMController.closeLoading(); }, FLASH_MS);
  }

  function write(changes) {
    var ls = changes.map(function (c) { return leafOf(c.pid); });
    changes.forEach(function (c, i) {
      Parameter.setValue(c.pid, ls[i].size, ls[i].ofs, c.value); // DT1 to the amp
      mirrorToUi(ls[i]);
    });
    flash();
    return read(changes.map(function (c) { return c.pid; }));
  }

  function status() {
    var name = Parameter.paramSet['PATCH%COM'].map(function (h) { return String.fromCharCode(parseInt(h, 16)); }).join('').trim();
    var colors = [0, 1, 2, 3, 4].map(function (i) { return Parameter.value('PATCH%COLOR%' + i, INTEGER1x7, 0); });
    return { connected: window.currentMIDIConnect != null, patchName: name, colors: colors };
  }

  // Dialogs BTS opens to pick a MIDI device; connecting replaces whichever is up.
  var CONNECT_DIALOGS = ['device-connect-select-dialog', 'disconnected-midi-connect-dialog',
    'connection-err-midi-connect-dialog', 'device-err-midi-connect-dialog', 'device-not-found-dialog'];

  // Does what the "Connect with" dialog's OK does, for the single KATANA input. BTS clears its
  // stored device whenever the link drops, so after that it asks on every start.
  // Returns pending while BTS is still starting up or a connect (its own or ours) is under way:
  // connectMIDI stores the device first and disconnectMIDI clears it if the handshake fails.
  function connect() {
    if (window.currentMIDIConnect != null) return { started: false, already: true };
    var asking = CONNECT_DIALOGS.some(function (id) { return $('#' + id).is(':visible'); });
    if (!asking && (!midiConnectionController.getHasInitialized() || util.readStorage().input != null)) {
      return { started: false, pending: true };
    }
    midiConnectionController.setInputs($native.midi.input.endpoints());
    midiConnectionController.setOutputs($native.midi.output.endpoints());
    var katanas = midiConnectionController.getInputs().filter(function (e) { return /^KATANA/.test(e.MIDIDeviceNameKey); });
    if (katanas.length !== 1) {
      return { started: false, reason: katanas.length ? 'More than one KATANA MIDI device is listed; pick one in BOSS TONE STUDIO.' : 'No KATANA MIDI device is listed. Is the amp on and connected over USB?' };
    }
    if (midiConnectionController._getMatchedOutput(katanas[0]) === null) {
      return { started: false, reason: 'The KATANA MIDI input has no matching output.' };
    }
    CONNECT_DIALOGS.forEach(function (id) { popup_close(id); });
    btsDOMController.closeConnectingPage();
    midiConnectionController.updateHasInitialized();
    midiConnectionController.connectMIDI(katanas[0]);
    return { started: true, device: katanas[0].MIDIDeviceNameKey };
  }

  window.__katanaClaude = { v: __KATANA_CLAUDE_AGENT_VERSION__, index: index, read: read, write: write, status: status, connect: connect };
})();`;

// The version covers both bodies, so a library change also replaces an installed agent.
const AGENT_VERSION = JSON.stringify(fnv1aHex(AGENT_BODY + LIBRARY_BODY));
export const PAGE_AGENT_SOURCE =
  AGENT_BODY.replace(/__KATANA_CLAUDE_AGENT_VERSION__/g, AGENT_VERSION) + '\n' + LIBRARY_BODY;

export function agentCall(method: 'index' | 'read' | 'write' | 'status' | 'connect', arg?: unknown): string {
  const args = arg === undefined ? '' : JSON.stringify(arg);
  return `${PAGE_AGENT_SOURCE}\nwindow.__katanaClaude.${method}(${args})`;
}

export type LibraryMethod =
  | 'patches' | 'selectPatch' | 'writePatch'
  | 'livesets' | 'createLiveset' | 'renameLiveset' | 'deleteLiveset'
  | 'addCurrent' | 'loadPatch' | 'toAmp' | 'fromAmp' | 'livesetJson' | 'importJson';

/** Expression that installs the agent if needed and calls window.__katanaClaude.lib[method](...args). */
export function libraryCall(method: LibraryMethod, args: unknown[] = []): string {
  const list = args.map(a => (a === undefined ? 'undefined' : JSON.stringify(a))).join(', ');
  return `${PAGE_AGENT_SOURCE}\nwindow.__katanaClaude.lib.${method}(${list})`;
}
