/**
 * Runs inside the BTS WebView page, appended after the tone agent (see page-agent.ts), which has just
 * (re)created window.__katanaClaude. Adds window.__katanaClaude.lib. Plain JS, no imports; no backticks
 * and no dollar-brace sequences (this is a String.raw template).
 *
 * Every lib method resolves to { ok: true, value } or { ok: false, error } so failures reach the MCP
 * tool as text instead of a CDP exception. Indexes are 0-based; rows are user patch rows (0 = PANEL).
 *
 * BTS globals used: librarianCommonInfo, librarianServices, LibrarianModel, PatchInfo, Parameter,
 * ProductSetting, patchModelController, patchMIDIController, patchDOMController, modelInfo,
 * librarianDynamicDOMController, currentMIDIConnect.
 */
export const LIBRARY_BODY = String.raw`(function () {
  var k = window.__katanaClaude;
  if (k.lib) return;

  function info() { return librarianCommonInfo; }

  function librarian() {
    var l = info().librarians[0];
    if (!l) throw new Error('The BOSS TONE STUDIO librarian is not ready yet; wait until the app has finished starting.');
    return l;
  }

  function livesetAt(i) {
    var l = info().livesetList[i];
    if (!l) throw new Error('No liveset at index ' + i);
    return l;
  }

  function patchName(cell) { return String(cell.value(0)).trim(); }

  function save(l) { librarianServices.saveToStorage2(l); }

  function redraw() {
    try {
      if (window.librarianDynamicDOMController && librarianDynamicDOMController.updateLivesetTableCell) {
        librarianDynamicDOMController.updateLivesetTableCell();
      }
    } catch (e) { /* LIBRARIAN page not built yet; it reads livesetList when opened */ }
  }

  function wrap(fn) {
    return function () {
      var args = arguments;
      return new Promise(function (resolve) {
        function fail(e) { resolve({ ok: false, error: String((e && e.message) || e) }); }
        try {
          Promise.resolve(fn.apply(null, args)).then(function (v) { resolve({ ok: true, value: v === undefined ? null : v }); }, fail);
        } catch (e) { fail(e); }
      });
    };
  }

  function patches() {
    var cfg = modelInfo.config(), names = patchModelController.getUserPatchNames(), slots = [];
    for (var row = 0; row < patchModelController.getTotalUserPatch(); row++) {
      slots.push({ row: row, name: String(names[row] || '').trim(), exists: cfg.patchExist(row), transferable: cfg.transferablePatch(row) });
    }
    return { current: patchModelController.getCurrentPatchNum(), model: cfg.name(), connected: window.currentMIDIConnect != null, slots: slots };
  }

  function livesets() {
    return info().livesetList.map(function (l) {
      return { id: l.id, name: l.name, patches: l.cells[0].map(patchName) };
    });
  }

  function addLiveset(l) {
    var id = librarianServices.createLivesetId();
    if (id < 0) throw new Error('The library is full (' + info().maxLivesetNum + ' livesets).');
    l.id = id;
    info().livesetList.unshift(l);
    save(l);
    librarianServices.saveIdList();
    redraw();
    return 0;
  }

  function createLiveset(name) { return addLiveset(new LibrarianModel(name, false)); }

  function renameLiveset(i, name) {
    var l = livesetAt(i);
    l.name = name;
    save(l);
    redraw();
  }

  function deleteLiveset(i) {
    livesetAt(i);
    librarianServices.deleteLiveset(i);
    librarianServices.saveIdList();
    redraw();
  }

  // The edit buffer as a liveset cell: the same block copy BTS's temporarySet maps for preview.
  function currentCell(name) {
    var lib = librarian(), cfg = lib.config, cell = lib.factory();
    cfg.blockSet.forEach(function (bid) {
      var src = Parameter.paramSet[cfg.temporarySet[bid]];
      if (src) cell.paramSet[bid] = src.concat();
    });
    cell.setValue(0, name);
    cell.memo = new PatchInfo(false);
    return cell;
  }

  function addCurrent(i, name, position) {
    var l = livesetAt(i), rows = l.rows(0);
    if (position < 0 || position > rows) throw new Error('Position ' + position + ' is outside liveset "' + l.name + '" (0..' + rows + ')');
    if (position === rows && rows >= info().maxPatchNum) throw new Error('Liveset "' + l.name + '" is full (' + info().maxPatchNum + ' patches).');
    l.replace(0, position, [currentCell(name)]);
    save(l);
    redraw();
    return position;
  }

  function livesetJson(i) { return livesetAt(i).toJSON(); }

  function importJson(json, name) {
    var l = new LibrarianModel('', false);
    try { l.load(json, name || undefined); } catch (e) {
      throw new Error('BOSS TONE STUDIO cannot read this file: ' + ((e && e.message) || e));
    }
    return addLiveset(l);
  }

  k.lib = {
    patches: wrap(patches),
    livesets: wrap(livesets),
    createLiveset: wrap(createLiveset),
    renameLiveset: wrap(renameLiveset),
    deleteLiveset: wrap(deleteLiveset),
    addCurrent: wrap(addCurrent),
    livesetJson: wrap(livesetJson),
    importJson: wrap(importJson)
  };
})();`;
