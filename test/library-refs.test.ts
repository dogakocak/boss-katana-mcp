import { describe, expect, it } from 'vitest';
import { checkName, findRef, isEmptyPatchName, resolveRef } from '../src/library-refs.js';

describe('library refs', () => {
  it('trims and accepts plain ASCII names within the limit', () => {
    expect(checkName('  CLAUDE LEAD ', 16, 'patch')).toBe('CLAUDE LEAD');
  });

  it.each([
    ['', 'empty'],
    ['Çok Güzel', 'plain ASCII'],
    ['THIS NAME IS TOO LONG', 'limit is 16'],
  ])('rejects patch name %j', (name, msg) => {
    expect(() => checkName(name, 16, 'patch')).toThrow(msg);
  });

  it('treats blank and INIT TONE SETTING as empty', () => {
    expect(isEmptyPatchName('   ')).toBe(true);
    expect(isEmptyPatchName('INIT TONE SETTING ')).toBe(true);
    expect(isEmptyPatchName('CRUNCH')).toBe(false);
  });

  const names = ['Blues', 'Metal', 'blues'];

  it('resolves 1-based numbers and exact names case-insensitively', () => {
    expect(resolveRef(names, 2, 'liveset')).toBe(1);
    expect(resolveRef(names, '3', 'liveset')).toBe(2);
    expect(resolveRef(names, ' METAL ', 'liveset')).toBe(1);
  });

  it('rejects ambiguous names and out-of-range numbers', () => {
    expect(() => resolveRef(names, 'BLUES', 'liveset')).toThrow('More than one liveset is named "BLUES" (numbers 1, 3)');
    expect(() => resolveRef(names, 4, 'liveset')).toThrow('There is no liveset 4; valid numbers are 1..3');
  });

  it('findRef returns undefined for an unknown name, resolveRef lists the known ones', () => {
    expect(findRef(names, 'Jazz', 'liveset')).toBeUndefined();
    expect(() => resolveRef(names, 'Jazz', 'liveset')).toThrow('No liveset named "Jazz". Known: "Blues", "Metal", "blues"');
  });
});
