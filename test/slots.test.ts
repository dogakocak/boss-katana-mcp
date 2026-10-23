import { describe, expect, it } from 'vitest';
import { LibraryError } from '../src/library.js';
import { parseSlot, slotName } from '../src/slots.js';

describe('slots', () => {
  it.each([
    ['PANEL', 0], ['panel', 0], ['A1', 1], ['a4', 4], ['A:CH1', 1], ['a-2', 2], ['A CH3', 3], ['b:ch-1', 5], ['B4', 8],
  ])('parses %s as row %i', (text, row) => {
    expect(parseSlot(text)).toBe(row);
  });

  it.each(['C1', 'A5', 'A0', '', '7'])('rejects %j', text => {
    expect(() => parseSlot(text)).toThrow(LibraryError);
    expect(() => parseSlot(text)).toThrow('PANEL, A1..A4 or B1..B4');
  });

  it('names rows', () => {
    expect([0, 1, 4, 5, 8].map(slotName)).toEqual(['PANEL', 'A1', 'A4', 'B1', 'B4']);
  });
});
