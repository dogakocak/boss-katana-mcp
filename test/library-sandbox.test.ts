import { describe, expect, it } from 'vitest';
import { btsInstalled } from './bts-sandbox.js';
import { createBtsLibrarySandbox } from './library-sandbox.js';

describe.skipIf(!btsInstalled)('BTS librarian sandbox', () => {
  it('loads the librarian with BTS\'s first-run liveset and the model slot layout', () => {
    const { sb, storage } = createBtsLibrarySandbox();
    expect(sb.run('librarianCommonInfo.livesetList.map(function (l) { return l.name; }).join()')).toBe('LIVESET 1');
    expect(sb.run('[0,1,2,3,4,5,6,7,8,9].map(function (i) { return modelInfo.config().patchExist(i); }).join()'))
      .toBe('true,true,true,true,true,true,true,true,true,false');
    expect(Object.keys(storage).sort()).toEqual(['0', 'ID_LIST']);
  });

  it('hides channels 3 and 4 on a KATANA-50 Gen 3', () => {
    const { sb } = createBtsLibrarySandbox({ model: '05' });
    expect(sb.run('[1,2,3,4,5,6,7,8].map(function (i) { return modelInfo.config().patchExist(i); }).join()'))
      .toBe('true,true,false,false,true,true,false,false');
  });

  it('records outgoing DT1 addresses and routes a fake amp reply to waiting receivers', async () => {
    const s = createBtsLibrarySandbox();
    s.sb.run('globalThis.__got = null; util.waitForDT1Reply(ADDRESS_CONST.COMMAND.PATCH_WRITE, "0006", { isSucceeded: function (m) { return m.indexOf("7F000104") >= 0; }, success: function () { __got = "ok"; } })');
    expect(s.dt1()).toEqual(['7F000104:0006']);
    s.reply('7F000104', '0006');
    expect(s.sb.run('__got')).toBe('ok');
  });
});
