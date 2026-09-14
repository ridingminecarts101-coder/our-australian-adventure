/* Native, app-private storage for local Wayfinder photos.
 *
 * The PWA keeps its own IndexedDB implementation in app.js. This adapter is
 * deliberately native-only: it keeps large JPEG bytes out of iOS WebView
 * storage, while every path is scoped to the signed-in account UUID.
 */
(function exposePhotoFiles(global) {
  'use strict';

  const DIRECTORY = 'DATA';
  const ROOT = 'wayfinder/photos';
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const FILE_ID = /^[A-Za-z0-9_-]{1,128}$/;
  const NOT_FOUND = 'OS-PLUG-FILE-0008';

  function ownerUuid(owner) {
    if (typeof owner !== 'string' || !UUID.test(owner)) {
      throw new TypeError('A valid account UUID is required for photo storage.');
    }
    return owner.toLowerCase();
  }

  function photoId(id) {
    if (typeof id !== 'string' || !FILE_ID.test(id)) {
      throw new TypeError('A valid photo ID is required for photo storage.');
    }
    return id;
  }

  function ownerDirectory(owner) {
    return `${ROOT}/${ownerUuid(owner)}`;
  }

  function photoPath(owner, id) {
    return `${ownerDirectory(owner)}/${photoId(id)}.jpg`;
  }

  function scopedPath(owner, path) {
    const prefix = `${ownerDirectory(owner)}/`;
    if (typeof path !== 'string' || !path.startsWith(prefix)) {
      throw new TypeError('Photo path does not belong to this account.');
    }
    const name = path.slice(prefix.length);
    if (!name.endsWith('.jpg') || !FILE_ID.test(name.slice(0, -4))) {
      throw new TypeError('Photo path is not a canonical Wayfinder JPEG path.');
    }
    return path;
  }

  function filesystem() {
    const capacitor = global.Capacitor;
    const native = capacitor && capacitor.isNativePlatform
      && capacitor.isNativePlatform();
    return native && capacitor.Plugins ? capacitor.Plugins.Filesystem : null;
  }

  function requiredFilesystem() {
    const plugin = filesystem();
    if (!plugin) throw new Error('Native photo storage is unavailable.');
    return plugin;
  }

  function iosBackupGuard() {
    const capacitor = global.Capacitor;
    if (!capacitor || typeof capacitor.getPlatform !== 'function'
        || capacitor.getPlatform() !== 'ios') return null;
    const plugin = capacitor.Plugins && capacitor.Plugins.WayfinderPhotoBackup;
    if (!plugin || typeof plugin.prepare !== 'function' || typeof plugin.exclude !== 'function') {
      throw new Error('iOS device-only photo storage is unavailable.');
    }
    return plugin;
  }

  function isMissing(error) {
    return !!error && error.code === NOT_FOUND;
  }

  async function blobToBase64(blob) {
    if (!blob || typeof blob.arrayBuffer !== 'function') {
      throw new TypeError('Photo data must be a Blob.');
    }
    if (blob.type && blob.type !== 'image/jpeg') {
      throw new TypeError('Native photo storage accepts JPEG data only.');
    }
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    const chunk = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunk) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
    }
    return global.btoa(binary);
  }

  function base64ToBlob(value) {
    if (typeof value !== 'string') {
      throw new TypeError('Native photo data was not returned as base64.');
    }
    const compact = value.replace(/\s/g, '');
    if (compact && !/^[A-Za-z0-9+/]*={0,2}$/.test(compact)) {
      throw new TypeError('Native photo data is not valid base64.');
    }
    const binary = global.atob(compact);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new global.Blob([bytes], { type: 'image/jpeg' });
  }

  async function save(owner, id, blob) {
    const path = photoPath(owner, id);
    const data = await blobToBase64(blob);
    const files = requiredFilesystem();
    const backupGuard = iosBackupGuard(); // fail before writing if the guard is absent
    if (backupGuard) await backupGuard.prepare();
    await files.writeFile({
      path, directory: DIRECTORY, data, recursive: true,
    });
    if (backupGuard) {
      try {
        await backupGuard.exclude({ path });
      } catch (error) {
        try { await files.deleteFile({ path, directory: DIRECTORY }); } catch { /* best effort */ }
        throw error;
      }
    }
    return { path, bytes: blob.size };
  }

  async function read(owner, path) {
    const safe = scopedPath(owner, path);
    const result = await requiredFilesystem().readFile({
      path: safe, directory: DIRECTORY,
    });
    return base64ToBlob(result.data);
  }

  async function remove(owner, path) {
    const safe = scopedPath(owner, path);
    try {
      await requiredFilesystem().deleteFile({ path: safe, directory: DIRECTORY });
      return true;
    } catch (error) {
      if (isMissing(error)) return false;
      throw error;
    }
  }

  async function list(owner) {
    const directory = ownerDirectory(owner);
    let result;
    try {
      result = await requiredFilesystem().readdir({ path: directory, directory: DIRECTORY });
    } catch (error) {
      if (isMissing(error)) return [];
      throw error;
    }
    return (result.files || []).filter(file => {
      if (!file || file.type !== 'file' || typeof file.name !== 'string') return false;
      return file.name.endsWith('.jpg') && FILE_ID.test(file.name.slice(0, -4));
    }).map(file => ({
      path: `${directory}/${file.name}`,
      bytes: Number.isFinite(file.size) ? file.size : undefined,
      mtime: Number.isFinite(file.mtime) ? file.mtime : undefined,
    }));
  }

  global.WayfinderPhotoFiles = Object.freeze({
    isNative: () => !!filesystem(), save, read, remove, list,
  });
})(window);
