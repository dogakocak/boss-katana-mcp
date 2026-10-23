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
 * librarianDynamicDOMController, currentMIDIConnect, util, ADDRESS_CONST, hex2, midiConnectionController,
 * setupKnobModFxTargetList, btsDOMController, $.
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

  var STEP_MS = 60000, TRANSFER_MS = 180000;

  // Set while an amp transfer this agent started is in flight (e.g. a string like 'Writing the
  // patch'), covering the gaps librarian().timerId misses: PATCH_WRITE/export waits, toAmp's export
  // + fetchPatchNames, loadPatch's readEditor. requireIdle() blocks a second overlapping call.
  var inFlight = null;

  function requireAmp() {
    if (window.currentMIDIConnect == null) throw new Error('No KATANA is connected. Connect it with katana_connect first.');
  }

  function requireIdle() {
    if (librarian().timerId || inFlight) throw new Error('BOSS TONE STUDIO is transferring data; try again in a moment.');
  }

  // Marks an amp transfer in flight for requireIdle(), and clears it only when the INNER flow
  // promise start() returns actually settles (success or failure) - not when an outer timeout
  // merely gives up on it - so a transfer BTS is still running keeps blocking new ones.
  function exclusive(what, start) {
    inFlight = what;
    function clear() { inFlight = null; }
    var flow;
    try {
      flow = start();
    } catch (e) {
      clear();
      throw e;
    }
    flow.then(clear, clear);
    return flow;
  }

  // Throws once token.cancelled has been set by withTimeout, so a step after a timed-out flow's
  // late resolution does not go on to act (save data, unmute, etc.).
  function check(token) {
    if (token.cancelled) throw new Error('cancelled after timeout');
  }

  function withTimeout(p, token, what, ms) {
    return new Promise(function (resolve, reject) {
      var t = setTimeout(function () {
        token.cancelled = true;
        if (librarian().timerId) librarian().cancel();
        reject(new Error(what + ' did not finish within ' + ms / 1000 + 's.'));
      }, ms);
      p.then(function (v) { clearTimeout(t); resolve(v); }, function (e) { clearTimeout(t); reject(e); });
    });
  }

  // BTS's loading popup around a long amp transfer, closed whatever the outcome.
  function withLoading(p) {
    if (window.btsDOMController) btsDOMController.openLoading();
    function close() { if (window.btsDOMController) btsDOMController.closeLoading(); }
    return p.then(function (v) { close(); return v; }, function (e) { close(); throw e; });
  }

  // Runs one Librarian read/write/temporaryWrite and settles on its 'end' / 'timeout' broadcast.
  function runLibrarian(msg, start) {
    var lib = librarian();
    return new Promise(function (resolve, reject) {
      var obs = {
        notify: function (m, arg) {
          if (m === 'librarian_cancel') { lib.removeObserver(obs); reject(new Error(msg + ' was cancelled in BOSS TONE STUDIO.')); return; }
          if (m !== msg) return;
          if (arg === 'end') { lib.removeObserver(obs); resolve(); }
          else if (arg === 'timeout') { lib.removeObserver(obs); reject(new Error(msg + ': the amp did not reply')); }
        }
      };
      lib.addObserver(obs);
      try {
        start(lib);
      } catch (e) {
        lib.removeObserver(obs);
        reject(e);
      }
    });
  }

  function waitReply(address, value, step) {
    return new Promise(function (resolve, reject) {
      util.waitForDT1Reply(address, value, {
        isSucceeded: function (msg) { return msg.indexOf(util.convert2AddrStr(address)) >= 0; },
        success: function () { resolve(); },
        error: function () { reject(new Error(step + ': the amp did not reply')); }
      });
    });
  }

  function sendExport(multi, preview, unmute, row) {
    return new Promise(function (resolve, reject) {
      patchMIDIController.sendCommandExport(multi, preview, unmute, row, function () { resolve(); },
        function () { reject(new Error('CMDID_EXPORT: the amp did not reply')); });
    });
  }

  // Same split as librarianServices.exportInst: one row, two rows, or "multiple" (7F7F).
  function exportCommand(rows) {
    if (rows.length > 2) return sendExport(true, true, true, undefined);
    if (rows.length === 2) {
      return sendExport(false, true, false, rows[0]).then(function () { return sendExport(false, false, true, rows[1]); });
    }
    return sendExport(false, true, true, rows[0]);
  }

  function unmuteSoon() { setTimeout(function () { patchMIDIController.sendCommandPreviewMute(0); }, 10); }

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

  // What BTS's #user-patch-select-menu change handler does.
  function selectPatch(row) {
    requireAmp(); requireIdle();
    patchModelController.updateCurrentPatch(row);
    patchDOMController.updateCurrentPatchDOM();
    patchMIDIController.updateCurrentPatch(row);
    return { current: row, name: String(patchModelController.getPatchName(row) || '').trim() };
  }

  // The WRITE dialog's sequence (patchMIDIController.sendPatchName + writePatch) without its dialogs.
  function writePatch(row, name) {
    requireAmp(); requireIdle();
    var token = { cancelled: false };
    var flow = exclusive('Writing the patch', function () {
      return Promise.resolve().then(function () {
        patchMIDIController.sendPatchName(name);
        return waitReply(ADDRESS_CONST.COMMAND.PATCH_WRITE, '00' + hex2(row), 'PATCH_WRITE');
      }).then(function () {
        check(token);
        return exportCommand([row]);
      }).then(function () {
        check(token);
        var names = patchModelController.getUserPatchNames();
        names[row] = name;
        patchModelController.updateUserPatchNames(names);
        patchDOMController.updatePatchSelectPage();
        patchDOMController.updateCurrentPatchDOM();
        $('#user-patch-select-menu').trigger('elf-change', row);
        return { row: row, name: name };
      });
    });
    return withLoading(withTimeout(flow, token, 'Writing the patch', window.__katanaStepMs || STEP_MS));
  }

  // A LIBRARIAN patch click: preview-mute, temporaryWrite, mirror into the edit buffer, re-read, unmute.
  function loadPatch(i, p) {
    requireAmp(); requireIdle();
    var l = livesetAt(i), cell = l.cell(0, p), cfg = librarian().config;
    if (!cell) throw new Error('No patch at index ' + p + ' in liveset "' + l.name + '"');
    var token = { cancelled: false };
    var flow = exclusive('Loading the patch', function () {
      return patchMIDIController.sendCommandPreviewMute(1).then(function () {
        check(token);
        return runLibrarian('librarian_temporaryWrite', function (lib) { lib.temporaryWrite(cell, 0); });
      }).then(function () {
        check(token);
        cfg.blockSet.forEach(function (bid) { Parameter.setdata(cfg.temporarySet[bid], cell.paramSet[bid]); });
        return new Promise(function (resolve) { midiConnectionController.readEditor([0], resolve, resolve); });
      }).then(function () {
        check(token);
        if (typeof setupKnobModFxTargetList === 'function') setupKnobModFxTargetList();
        return { liveset: l.name, patch: patchName(cell) };
      });
    });
    // Unmute once the inner flow has actually settled, not when an outer timeout gives up on it.
    flow.then(unmuteSoon, unmuteSoon);
    return withTimeout(flow, token, 'Loading the patch', window.__katanaStepMs || STEP_MS);
  }

  // librarianServices.exportInst without the read-back and dialogs: copy cells into the amp's
  // PATCH(n) buffers, write those rows, send the export command, refresh slot names.
  function toAmp(i, patchIdxs, rows) {
    requireAmp(); requireIdle();
    var l = livesetAt(i);
    var cells = patchIdxs.map(function (p) {
      var c = l.cell(0, p);
      if (!c) throw new Error('No patch at index ' + p + ' in liveset "' + l.name + '"');
      return c;
    });
    if (cells.length !== rows.length || !rows.length) throw new Error('Patches and slots must be the same, non-zero count.');
    rows.forEach(function (row, n) { info().instLiveset.replace(0, row, [cells[n]]); });
    var token = { cancelled: false };
    var flow = exclusive('Writing the liveset to the amp', function () {
      return runLibrarian('librarian_write', function (lib) { lib.write(rows.slice()); })
        .then(function () { check(token); return exportCommand(rows); })
        .then(function () { check(token); return new Promise(function (resolve) { patchMIDIController.fetchPatchNames(resolve, resolve); }); })
        .then(function () {
          check(token);
          var cur = patchModelController.getCurrentPatchNum();
          if (rows.indexOf(cur) >= 0) patchMIDIController.updateCurrentPatch(cur);
          return { rows: rows, names: cells.map(patchName) };
        });
    });
    return withLoading(withTimeout(flow, token, 'Writing the liveset to the amp', window.__katanaTransferMs || TRANSFER_MS));
  }

  // librarianServices.importInst (append mode): read the rows from the amp, copy them into the liveset.
  function fromAmp(rows, i) {
    requireAmp(); requireIdle();
    var l = livesetAt(i);
    if (l.rows(0) + rows.length > info().maxPatchNum) throw new Error('Liveset "' + l.name + '" would exceed ' + info().maxPatchNum + ' patches.');
    var token = { cancelled: false };
    var flow = exclusive('Reading patches from the amp', function () {
      return runLibrarian('librarian_read', function (lib) { lib.read(rows.slice()); }).then(function () {
        check(token);
        var cells = info().instLiveset.copy(0, rows.slice());
        l.replace(0, l.rows(0), cells);
        save(l);
        redraw();
        return { liveset: l.name, added: cells.map(patchName) };
      });
    });
    return withLoading(withTimeout(flow, token, 'Reading patches from the amp', window.__katanaTransferMs || TRANSFER_MS));
  }

  k.lib = {
    patches: wrap(patches),
    selectPatch: wrap(selectPatch),
    writePatch: wrap(writePatch),
    livesets: wrap(livesets),
    createLiveset: wrap(createLiveset),
    renameLiveset: wrap(renameLiveset),
    deleteLiveset: wrap(deleteLiveset),
    addCurrent: wrap(addCurrent),
    loadPatch: wrap(loadPatch),
    toAmp: wrap(toAmp),
    fromAmp: wrap(fromAmp),
    livesetJson: wrap(livesetJson),
    importJson: wrap(importJson)
  };
})();`;
