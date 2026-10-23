import { LibraryError } from './library.js';

const SLOT_RE = /^\s*([ab])\s*(?::|-)?\s*(?:ch)?\s*-?\s*([1-4])\s*$/i;

/** "PANEL", "A1", "A:CH1", "a-1", "A CH1" … → user patch row (PANEL 0, A1–A4 1–4, B1–B4 5–8). */
export function parseSlot(text: string): number {
  if (/^\s*panel\s*$/i.test(text)) return 0;
  const m = SLOT_RE.exec(text);
  if (!m) throw new LibraryError(`"${text}" is not a slot; use PANEL, A1..A4 or B1..B4.`);
  return (m[1].toUpperCase() === 'A' ? 0 : 4) + Number(m[2]);
}

export function slotName(row: number): string {
  if (row === 0) return 'PANEL';
  return row <= 4 ? `A${row}` : `B${row - 4}`;
}
