import { LibraryError } from './library.js';

export const LIVESET_NAME_MAX = 64;
export const PATCH_NAME_MAX = 16;
export const MAX_PATCHES = 15;
export const INIT_PATCH_NAME = 'INIT TONE SETTING';

export type Ref = string | number;

/** Trimmed name, or a LibraryError when BTS/the amp could not store it as given. */
export function checkName(name: string, max: number, what: 'liveset' | 'patch'): string {
  const n = name.trim();
  if (!n) throw new LibraryError(`The ${what} name is empty.`);
  if (!/^[\x20-\x7E]+$/.test(n)) {
    throw new LibraryError(`The ${what} name "${n}" has characters the KATANA cannot store; use plain ASCII letters, digits and punctuation.`);
  }
  if (n.length > max) throw new LibraryError(`The ${what} name "${n}" is ${n.length} characters; the limit is ${max}.`);
  return n;
}

export function isEmptyPatchName(name: string): boolean {
  const n = name.trim();
  return n === '' || n === INIT_PATCH_NAME;
}

export function isNumberRef(ref: Ref): boolean {
  return typeof ref === 'number' || /^\s*\d+\s*$/.test(ref);
}

/** 1-based number or exact (case-insensitive) name → 0-based index; undefined when no name matches. */
export function findRef(names: string[], ref: Ref, what: string): number | undefined {
  if (isNumberRef(ref)) {
    const n = Number(ref);
    if (n >= 1 && n <= names.length) return n - 1;
    throw new LibraryError(`There is no ${what} ${n}; valid numbers are 1..${names.length}.`);
  }
  const key = String(ref).trim().toLowerCase();
  const hits = names.flatMap((n, i) => (n.trim().toLowerCase() === key ? [i] : []));
  if (hits.length > 1) {
    throw new LibraryError(`More than one ${what} is named "${ref}" (numbers ${hits.map(i => i + 1).join(', ')}); use the number.`);
  }
  return hits[0];
}

export function resolveRef(names: string[], ref: Ref, what: string): number {
  const i = findRef(names, ref, what);
  if (i === undefined) {
    throw new LibraryError(`No ${what} named "${ref}". Known: ${names.map(n => `"${n}"`).join(', ') || 'none'}.`);
  }
  return i;
}
