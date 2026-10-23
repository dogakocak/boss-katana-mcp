import { existsSync, statSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { LibraryError } from './library.js';
import { MAX_PATCHES } from './library-refs.js';

export function defaultTslDir(home = homedir()): string {
  return join(home, 'Documents', 'BOSS KATANA Tones');
}

/** Same characters BTS replaces in its own export file names (util.convert2ValidFileNameStr). */
export function tslFileName(livesetName: string): string {
  return (livesetName.replace(/[\\/:*?".<>|]/g, '_').trim() || 'liveset') + '.tsl';
}

/** No path → default folder; a folder → <liveset>.tsl inside it; a file path → as given, .tsl added if missing. */
export function resolveTslPath(path: string | undefined, livesetName: string, home = homedir()): string {
  const given = path?.trim();
  if (!given) return join(defaultTslDir(home), tslFileName(livesetName));
  const p = resolve(given);
  if (/[\\/]$/.test(given) || (existsSync(p) && statSync(p).isDirectory())) return join(p, tslFileName(livesetName));
  return extname(p).toLowerCase() === '.tsl' ? p : `${p}.tsl`;
}

export async function writeTsl(path: string, json: string, overwrite = false): Promise<void> {
  if (existsSync(path) && !overwrite) {
    throw new LibraryError(`${path} already exists. Ask the user, then call again with overwrite: true.`);
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, json, 'utf8');
}

export async function readTsl(path: string): Promise<{ json: string; name: string; patches: number }> {
  let text: string;
  try { text = await readFile(resolve(path), 'utf8'); } catch { throw new LibraryError(`Cannot read ${path}.`); }
  text = text.replace(/^﻿/, '');
  let o: unknown;
  try { o = JSON.parse(text); } catch { throw new LibraryError(`${path} is not a .tsl file (not JSON).`); }
  const t = o as { name?: unknown; formatRev?: unknown; device?: unknown; data?: unknown };
  if (o === null || typeof o !== 'object'
    || typeof t.name !== 'string' || typeof t.formatRev !== 'string' || typeof t.device !== 'string'
    || !Array.isArray(t.data) || !Array.isArray(t.data[0])) {
    throw new LibraryError(`${path} is not a BOSS TONE STUDIO liveset (.tsl) file.`);
  }
  const patches = (t.data[0] as unknown[]).length;
  if (patches > MAX_PATCHES) throw new LibraryError(`${path} holds ${patches} patches; a liveset holds at most ${MAX_PATCHES}.`);
  return { json: text, name: t.name, patches };
}
