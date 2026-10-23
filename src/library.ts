import { evaluateInBts } from './cdp.js';
import { libraryCall, type LibraryMethod } from './page-agent.js';

/** A librarian request that cannot be done as asked; the message is meant for the user. */
export class LibraryError extends Error {}

export interface SlotInfo { row: number; name: string; exists: boolean; transferable: boolean }
export interface PatchesInfo { current: number; model: string; connected: boolean; slots: SlotInfo[] }
export interface LivesetInfo { id: number; name: string; patches: string[] }

/** Thin typed wrapper over window.__katanaClaude.lib; indexes 0-based, rows = user patch rows. */
export interface LibraryClient {
  patches(): Promise<PatchesInfo>;
  selectPatch(row: number): Promise<{ current: number; name: string }>;
  writePatch(row: number, name: string): Promise<{ row: number; name: string }>;
  livesets(): Promise<LivesetInfo[]>;
  createLiveset(name: string): Promise<number>;
  renameLiveset(index: number, name: string): Promise<null>;
  deleteLiveset(index: number): Promise<null>;
  addCurrent(index: number, name: string, position: number): Promise<number>;
  loadPatch(index: number, patch: number): Promise<{ liveset: string; patch: string }>;
  toAmp(index: number, patches: number[], rows: number[]): Promise<{ rows: number[]; names: string[] }>;
  fromAmp(rows: number[], index: number): Promise<{ liveset: string; added: string[] }>;
  livesetJson(index: number): Promise<string>;
  importJson(json: string, name: string | null): Promise<number>;
}

/** Long enough for writing a whole liveset to the amp; the page agent has its own step timeouts. */
export const LIBRARY_TIMEOUT_MS = 240000;

export function createLibrary(evaluate: (expression: string) => Promise<unknown>): LibraryClient {
  async function call<T>(method: LibraryMethod, ...args: unknown[]): Promise<T> {
    const r = (await evaluate(libraryCall(method, args))) as { ok: boolean; value?: T; error?: string };
    if (!r.ok) throw new LibraryError(r.error ?? 'BOSS TONE STUDIO reported an unknown error.');
    return r.value as T;
  }
  return {
    patches: () => call('patches'),
    selectPatch: row => call('selectPatch', row),
    writePatch: (row, name) => call('writePatch', row, name),
    livesets: () => call('livesets'),
    createLiveset: name => call('createLiveset', name),
    renameLiveset: (index, name) => call('renameLiveset', index, name),
    deleteLiveset: index => call('deleteLiveset', index),
    addCurrent: (index, name, position) => call('addCurrent', index, name, position),
    loadPatch: (index, patch) => call('loadPatch', index, patch),
    toAmp: (index, patches, rows) => call('toAmp', index, patches, rows),
    fromAmp: (rows, index) => call('fromAmp', rows, index),
    livesetJson: index => call('livesetJson', index),
    importJson: (json, name) => call('importJson', json, name),
  };
}

export function createCdpLibrary(port = 9222): LibraryClient {
  return createLibrary(expression => evaluateInBts(expression, port, LIBRARY_TIMEOUT_MS));
}
