/* User-controlled encrypted photo transfer. No network or account credentials. */
(function exposePhotoTransfer(global) {
  'use strict';
  let adapter, state = null, sequence = 0;
  const $ = selector => document.querySelector(selector);
  const same = session => {
    const now = adapter.session();
    return now.owner && !now.deleting && now.owner === session.owner && now.generation === session.generation
      && (session.operation == null || (session.operation === sequence && state && state.session === session));
  };
  const requireSession = session => {
    if (!same(session)) throw new Error('Your account changed. Reopen photo backup in the correct account.');
  };
  async function digest(blob) {
    const bytes = new Uint8Array(await global.crypto.subtle.digest('SHA-256', await blob.arrayBuffer()));
    return [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
  }

  // Preflight every collision before writing. Existing photos are never replaced.
  // On a write failure only files created by this import are rolled back.
  async function importPhotos(photos, storage, current) {
    const assertCurrent = () => { if (!current()) throw new Error('Your account changed. Import stopped.'); };
    assertCurrent();
    const existing = new Map((await storage.list()).map(p => [p.id, p]));
    assertCurrent();
    const missing = [];
    for (const photo of photos) {
      assertCurrent();
      const prior = existing.get(photo.id);
      if (!prior) { missing.push(photo); continue; }
      if (prior.adventure_id !== photo.adventure_id || await digest(await storage.read(prior)) !== await digest(photo.blob)) {
        throw new Error('A photo ID conflicts with a different photo on this phone. Nothing in this file was imported.');
      }
      assertCurrent();
    }
    const created = [];
    try {
      for (const photo of missing) {
        assertCurrent();
        const saved = await storage.save(photo);
        created.push(saved);
        assertCurrent();
      }
      return { imported: created.length, skipped: photos.length - missing.length };
    } catch (error) {
      let retained = 0;
      for (const photo of created.reverse()) {
        try { await storage.remove(photo); } catch { retained++; }
      }
      if (retained) throw new Error(`Import stopped. ${retained} new photos could not be rolled back; retrying will skip identical copies.`);
      throw error;
    }
  }

  function message(text) { $('#photoBackupStatus').textContent = text; }
  function buttons() {
    const s = state;
    if (!s) return;
    $('#photoBackupStart').disabled = s.busy;
    $('#photoBackupClose').disabled = s.busy;
    $('#photoBackupSave').disabled = s.busy;
    $('#photoBackupNext').disabled = s.busy;
    $('#photoBackupSave').classList.toggle('hidden', !s.prepared);
    $('#photoBackupNext').classList.toggle('hidden', !s.prepared || s.part + 1 >= s.parts.length);
    $('#photoBackupStart').classList.toggle('hidden', s.mode === 'export' && !!s.prepared);
  }
  function close(force = false) {
    if (state && state.busy && !force) return;
    state = null; sequence++;
    for (const id of ['photoBackupPassword', 'photoBackupConfirm', 'photoBackupFiles']) $("#" + id).value = '';
    if (adapter) adapter.hide();
    else $('#photoBackupSheet')?.classList.add('hidden');
  }
  function sessionChanged() {
    if (state && !same(state.session)) close(true);
  }
  function open(mode) {
    const current = adapter.session();
    if (!current.owner || current.deleting) return adapter.toast('Sign in before transferring your photos.');
    close(true);
    const session = { ...current, operation: sequence };
    state = { mode, session, token: sequence, busy: false, parts: [], part: 0, prepared: null, offered: false };
    $('#photoBackupTitle').textContent = mode === 'export' ? 'Export your photos' : 'Import a photo backup';
    $('#photoBackupStart').textContent = mode === 'export' ? 'Prepare encrypted backup' : 'Import selected backup files';
    $('#photoBackupConfirmLabel').classList.toggle('hidden', mode !== 'export');
    $('#photoBackupFileLabel').classList.toggle('hidden', mode !== 'import');
    message(mode === 'export'
      ? 'Choose a backup password of at least 8 characters. Keep it safely: RL Applications cannot recover it. Large libraries use numbered files; save every part.'
      : 'Sign into the same Wayfinder account, select your backup files and enter their backup password. Existing photos will be kept.');
    buttons(); adapter.show();
  }
  async function preparePart(s) {
    const rows = [];
    for (const record of s.parts[s.part]) {
      requireSession(s.session);
      const blob = await adapter.read(record, s.session.owner);
      rows.push({ id: record.id, adventure_id: record.adventure_id,
        taken_at: record.taken_at || null, added_at: record.added_at || null,
        width: record.width || null, height: record.height || null, bytes: blob.size, blob });
    }
    requireSession(s.session);
    s.prepared = await global.WayfinderPhotoBackup.createPart(s.session.owner, rows, s.password, {
      exportId: s.exportId, partIndex: s.part + 1, partCount: s.parts.length,
    });
    requireSession(s.session);
    s.offered = false;
    message(`Part ${s.part + 1} of ${s.parts.length} is ready (${rows.length} ${rows.length === 1 ? 'photo' : 'photos'}). Save this file${s.parts.length > 1 ? ', then continue to the next part' : ''}. Nothing is uploaded by Wayfinder.`);
  }
  async function start() {
    const s = state;
    if (!s || s.busy) return;
    const password = $('#photoBackupPassword').value;
    if (password.length < 8) return message('Enter a backup password of at least 8 characters.');
    if (s.mode === 'export' && password !== $('#photoBackupConfirm').value) return message('The backup passwords do not match.');
    const selected = [...($('#photoBackupFiles').files || [])];
    if (s.mode === 'import' && !selected.length) return message('Choose the numbered backup files first.');
    if (selected.length > global.WayfinderPhotoBackup.MAX_PARTS) return message('Choose at most 512 backup files at a time.');
    s.busy = true; buttons(); message('Working on this device…');
    let completed = 0;
    try {
      requireSession(s.session);
      if (s.mode === 'export') {
        const rows = await adapter.list(s.session.owner);
        requireSession(s.session);
        if (!rows.length) throw new Error('There are no photos in this account on this device to export.');
        s.parts = global.WayfinderPhotoBackup.planParts(rows);
        s.exportId = global.crypto.randomUUID(); s.password = password;
        await preparePart(s);
      } else {
        let imported = 0, skipped = 0;
        const sets = new Map();
        for (const file of selected) {
          requireSession(s.session);
          if (file.size > global.WayfinderPhotoBackup.MAX_FILE_BYTES) throw new Error('That backup file is too large. Use the numbered files produced by Wayfinder.');
          const part = await global.WayfinderPhotoBackup.openPart(s.session.owner, file, password);
          requireSession(s.session);
          const parts = sets.get(part.exportId) || { total: part.partCount, seen: new Set() };
          if (parts.total !== part.partCount || parts.seen.has(part.partIndex)) {
            throw new Error('These files repeat a part or disagree about the size of a backup set. Choose the original numbered set.');
          }
          const result = await importPhotos(part.photos, {
            list: () => adapter.list(s.session.owner),
            read: p => adapter.read(p, s.session.owner),
            save: p => adapter.save(p, s.session.owner),
            remove: p => adapter.remove(p),
          }, () => same(s.session));
          imported += result.imported; skipped += result.skipped; completed++;
          parts.seen.add(part.partIndex); sets.set(part.exportId, parts);
        }
        requireSession(s.session);
        await adapter.refresh(s.session.owner);
        requireSession(s.session);
        const missing = [...sets.values()].reduce((n, part) => n + part.total - part.seen.size, 0);
        message(`Imported ${imported} ${imported === 1 ? 'photo' : 'photos'}; kept ${skipped} identical existing copies. ${missing ? `${missing} other numbered parts were not selected in this import.` : 'All selected sets are complete.'}`);
        $('#photoBackupPassword').value = ''; $('#photoBackupFiles').value = '';
      }
    } catch (error) {
      if (state === s && same(s.session)) {
        if (completed) await adapter.refresh(s.session.owner);
        if (state === s && same(s.session)) message(`${completed ? `${completed} earlier backup files were imported successfully. ` : ''}${error.message || 'Photo transfer failed. Your existing photos are unchanged.'}`);
      }
    } finally {
      if (state === s) { s.busy = false; buttons(); }
    }
  }
  async function save() {
    const s = state;
    if (!s || s.busy || !s.prepared) return;
    s.busy = true; buttons();
    try {
      requireSession(s.session);
      const name = `Wayfinder-photos-${s.exportId}-part-${s.part + 1}-of-${s.parts.length}.wfpbackup`;
      const capacitor = global.Capacitor;
      if (capacitor && capacitor.isNativePlatform && capacitor.isNativePlatform()) {
        const files = capacitor.Plugins.Filesystem, share = capacitor.Plugins.Share;
        if (!files || !share) throw new Error('File export is unavailable in this build.');
        const path = `wayfinder-photo-exports/${name}`;
        const data = await s.prepared.text(); requireSession(s.session);
        const saved = await files.writeFile({ path, directory: 'CACHE', data, encoding: 'utf8', recursive: true });
        try {
          requireSession(s.session);
          await share.share({ title: 'Wayfinder photo backup', files: [saved.uri], dialogTitle: 'Save your encrypted backup' });
        } finally {
          try { await files.deleteFile({ path, directory: 'CACHE' }); } catch { /* encrypted cache is reclaimable */ }
        }
      } else {
        const file = new global.File([s.prepared], name, { type: 'application/octet-stream' });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file], title: 'Wayfinder photo backup' });
        } else {
          const url = URL.createObjectURL(file), link = document.createElement('a');
          link.href = url; link.download = name; document.body.appendChild(link); link.click(); link.remove();
          setTimeout(() => URL.revokeObjectURL(url), 60000);
        }
      }
      requireSession(s.session); s.offered = true;
      message(`The save/share dialog opened for part ${s.part + 1} of ${s.parts.length}. Check that you saved it before continuing or deleting anything. You can save this part again if needed.`);
    } catch (error) {
      if (state === s && same(s.session)) message(error.name === 'AbortError' ? 'Save cancelled. Your backup is still ready.' : 'The file was not confirmed saved. Try Save again.');
    } finally { if (state === s) { s.busy = false; buttons(); } }
  }
  async function next() {
    const s = state;
    if (!s || s.busy || s.part + 1 >= s.parts.length) return;
    if (!s.offered) return message('Save this part before continuing.');
    s.part++; s.prepared = null; s.busy = true; buttons();
    try { await preparePart(s); }
    catch (error) {
      if (state === s && same(s.session)) {
        // Starting again exports a fresh complete numbered set; it never says
        // that a failed part was saved or silently advances past it.
        s.parts = []; s.part = 0;
        message((error.message || 'Could not prepare this part.') + ' Start again and save the complete new set.');
      }
    }
    finally { if (state === s) { s.busy = false; buttons(); } }
  }
  function mount(options) {
    adapter = options;
    $('#exportPhotosBtn').onclick = () => open('export');
    $('#importPhotosBtn').onclick = () => open('import');
    $('#photoBackupClose').onclick = () => close();
    $('#photoBackupStart').onclick = start;
    $('#photoBackupSave').onclick = save;
    $('#photoBackupNext').onclick = next;
  }
  global.WayfinderPhotoTransfer = Object.freeze({ mount, close, sessionChanged, importPhotos });
})(window);
