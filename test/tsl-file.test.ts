import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultTslDir, readTsl, resolveTslPath, writeTsl } from '../src/tsl-file.js';

const tmp = () => mkdtempSync(join(tmpdir(), 'katana-tsl-'));
const tsl = (n: number) => JSON.stringify({ name: 'X', formatRev: '0000', device: 'KATANA Gen3', data: [Array.from({ length: n }, () => ({ memo: '', paramSet: {} }))] });

describe('tsl files', () => {
  it('defaults to Documents\\BOSS KATANA Tones\\<name>.tsl with a file-safe name', () => {
    expect(resolveTslPath(undefined, 'Live: 80s/Rock', 'C:\\Users\\me')).toBe(join('C:\\Users\\me', 'Documents', 'BOSS KATANA Tones', 'Live_ 80s_Rock.tsl'));
    expect(defaultTslDir('C:\\Users\\me')).toBe(join('C:\\Users\\me', 'Documents', 'BOSS KATANA Tones'));
  });

  it('adds .tsl to a path without it and puts the file inside an existing folder', () => {
    const dir = tmp();
    expect(resolveTslPath(join(dir, 'gig'), 'Live')).toBe(join(dir, 'gig.tsl'));
    expect(resolveTslPath(join(dir, 'gig.TSL'), 'Live')).toBe(join(dir, 'gig.TSL'));
    expect(resolveTslPath(dir, 'Live')).toBe(join(dir, 'Live.tsl'));
  });

  it('writes, creating folders, and refuses to overwrite unless asked', async () => {
    const file = join(tmp(), 'sub', 'a.tsl');
    await writeTsl(file, '{"a":1}');
    expect(readFileSync(file, 'utf8')).toBe('{"a":1}');
    await expect(writeTsl(file, '{"a":2}')).rejects.toThrow('already exists. Ask the user, then call again with overwrite: true.');
    await writeTsl(file, '{"a":2}', true);
    expect(readFileSync(file, 'utf8')).toBe('{"a":2}');
  });

  it('reads a liveset file, stripping a BOM', async () => {
    const file = join(tmp(), 'a.tsl');
    writeFileSync(file, '\uFEFF' + tsl(2), 'utf8');
    expect(await readTsl(file)).toEqual({ json: tsl(2), name: 'X', patches: 2 });
  });

  it.each([
    ['not json', 'not a .tsl file (not JSON)'],
    ['{"name":"X"}', 'is not a BOSS TONE STUDIO liveset (.tsl) file'],
    [tsl(16), 'holds 16 patches; a liveset holds at most 15'],
  ])('rejects %j', async (content, msg) => {
    const file = join(tmp(), 'bad.tsl');
    writeFileSync(file, content, 'utf8');
    await expect(readTsl(file)).rejects.toThrow(msg);
  });

  it('rejects a missing file', async () => {
    await expect(readTsl(join(tmp(), 'none.tsl'))).rejects.toThrow('Cannot read');
  });
});
