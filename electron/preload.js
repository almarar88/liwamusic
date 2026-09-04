'use strict';
/**
 * LiwaMusic — جسر آمن بين العملية الرئيسية والواجهة.
 * الواجهة لا تملك أي وصول مباشر إلى Node أو نظام الملفات أو مفتاح الـ API.
 */
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const call = (channel, ...args) => ipcRenderer.invoke(channel, ...args).then((res) => {
  if (res && res.ok) return res.data;
  const err = new Error((res && res.error) || 'UNKNOWN_ERROR');
  err.code = res && res.code;
  throw err;
});

const on = (channel, fn) => {
  const listener = (_e, payload) => fn(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

contextBridge.exposeInMainWorld('liwa', {
  app: {
    info: () => call('app:info'),
    openExternal: (url) => call('shell:open', url),
    reveal: (id) => call('shell:reveal', id),
  },
  window: {
    minimize: () => call('window:minimize'),
    maximize: () => call('window:maximize'),
    close: () => call('window:close'),
    mini: (on_) => call('window:mini', on_),
    progress: (v) => call('window:progress', v),
    onState: (fn) => on('window:state', fn),
  },
  settings: {
    get: () => call('settings:get'),
    set: (patch) => call('settings:set', patch),
  },
  library: {
    get: () => call('library:get'),
    addFolder: () => call('library:addFolder'),
    addPaths: (paths) => call('library:addPaths', paths),
    removeFolder: (folder) => call('library:removeFolder', folder),
    scan: (opts) => call('library:scan', opts),
    duplicates: () => call('library:duplicates'),
    export: () => call('library:export'),
    import: () => call('library:import'),
    onProgress: (fn) => on('library:progress', fn),
    onUpdated: (fn) => on('library:updated', fn),
  },
  user: {
    get: () => call('user:get'),
    favorite: (id, on_) => call('user:favorite', id, on_),
    rate: (id, stars) => call('user:rate', id, stars),
    played: (id) => call('user:played', id),
    override: (id, patch) => call('user:override', id, patch),
    bulkOverride: (ids, patch) => call('user:bulkOverride', ids, patch),
    clearHistory: () => call('user:clearHistory'),
  },
  playlists: {
    list: () => call('playlist:list'),
    create: (data) => call('playlist:create', data),
    update: (id, patch) => call('playlist:update', id, patch),
    remove: (id) => call('playlist:delete', id),
    addTracks: (id, ids) => call('playlist:addTracks', id, ids),
    exportM3U: (id) => call('playlist:exportM3U', id),
    importM3U: () => call('playlist:importM3U'),
  },
  online: {
    status: () => call('online:status'),
    art: (id) => call('online:art', id),
    lyrics: (id) => call('online:lyrics', id),
    meta: (id) => call('online:meta', id),
    artist: (name, lang) => call('online:artist', name, lang),
  },
  drive: {
    status: () => call('drive:status'),
    setClient: (id, secret) => call('drive:setClient', id, secret),
    connect: () => call('drive:connect'),
    disconnect: () => call('drive:disconnect'),
    listFolder: (folderId) => call('drive:listFolder', folderId),
    addFolder: (folderId, name) => call('drive:addFolder', folderId, name),
    removeFolder: (folderId) => call('drive:removeFolder', folderId),
    scan: () => call('drive:scan'),
    enrich: (limit) => call('drive:enrich', limit),
    cacheStats: () => call('drive:cacheStats'),
    clearCache: () => call('drive:clearCache'),
    pin: (ids) => call('drive:pin', ids),
    unpin: (ids) => call('drive:unpin', ids),
    onEnrich: (fn) => on('drive:enrich', fn),
    onPinProgress: (fn) => on('drive:pinProgress', fn),
  },
  sync: {
    now: () => call('sync:now'),
    set: (enabled, minutes) => call('sync:set', enabled, minutes),
    onDone: (fn) => on('sync:done', fn),
    onError: (fn) => on('sync:error', fn),
  },
  art: {
    pickFile: () => call('art:pickFile'),
    setFromFile: (ids, filePath) => call('art:setFromFile', ids, filePath),
    setFromUrl: (ids, url) => call('art:setFromUrl', ids, url),
    clear: (ids) => call('art:clear', ids),
    fetchMissing: (ids) => call('art:fetchMissing', ids),
    onProgress: (fn) => on('art:progress', fn),
  },
  ai: {
    status: () => call('ai:status'),
    setKey: (key) => call('ai:setKey', key),
    clearKey: () => call('ai:clearKey'),
    tag: (ids) => call('ai:tag', ids),
    playlist: (prompt, size) => call('ai:playlist', prompt, size),
    search: (query) => call('ai:search', query),
    radio: (id, size) => call('ai:radio', id, size),
    insights: () => call('ai:insights'),
    dj: (id, prevId) => call('ai:dj', id, prevId),
    onProgress: (fn) => on('ai:progress', fn),
    onDjDelta: (fn) => on('ai:djDelta', fn),
    onDjDone: (fn) => on('ai:djDone', fn),
  },
  media: {
    onKey: (fn) => on('media:key', fn),
    audioUrl: (id) => call('util:audioUrl', id),
  },
  // مسارات الملفات المسحوبة إلى النافذة (بديل آمن لـ File.path)
  pathsFor: (files) => Array.from(files || []).map((f) => {
    try { return webUtils.getPathForFile(f); } catch { return null; }
  }).filter(Boolean),
});
