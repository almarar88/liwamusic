'use strict';
/**
 * LiwaTube — جسر آمن بين العملية الرئيسية والواجهة.
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
    onOpen: (fn) => on('app:open', fn),
    pathOf: (file) => { try { return webUtils.getPathForFile(file); } catch { return null; } },
  },
  window: {
    minimize: () => call('window:minimize'),
    maximize: () => call('window:maximize'),
    close: () => call('window:close'),
    fullscreen: (on_) => call('window:fullscreen', on_),
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
    scan: () => call('library:scan'),
    probe: (id, info) => call('library:probe', id, info),
    saveThumb: (id, buf, at) => call('library:saveThumb', id, buf, at),
    pending: () => call('library:pending'),
    resetThumbs: () => call('library:resetThumbs'),
    onProgress: (fn) => on('library:progress', fn),
    onUpdated: (fn) => on('library:updated', fn),
  },
  user: {
    get: () => call('user:get'),
    like: (id, val) => call('user:like', id, val),
    watchLater: (id, on_) => call('user:watchLater', id, on_),
    progress: (id, pos, dur) => call('user:progress', id, pos, dur),
    played: (id) => call('user:played', id),
    override: (id, patch) => call('user:override', id, patch),
    subscribe: (channelId, on_) => call('user:subscribe', channelId, on_),
    hide: (id, on_) => call('user:hide', id, on_),
    notInterested: (channelId, on_) => call('user:notInterested', channelId, on_),
    clearHistory: () => call('user:clearHistory'),
    removeHistory: (id) => call('user:removeHistory', id),
    comment: (id, text) => call('user:comment', id, text),
    deleteComment: (id, cid) => call('user:deleteComment', id, cid),
    markWatched: (id, on_) => call('user:markWatched', id, on_),
  },
  playlists: {
    list: () => call('playlist:list'),
    create: (data) => call('playlist:create', data),
    update: (id, patch) => call('playlist:update', id, patch),
    remove: (id) => call('playlist:delete', id),
    add: (id, ids) => call('playlist:add', id, ids),
    removeVideo: (id, vid) => call('playlist:removeVideo', id, vid),
  },
  feed: {
    home: (opts) => call('feed:home', opts),
    related: (id) => call('feed:related', id),
    search: (q) => call('feed:search', q),
  },
  subtitles: {
    list: (id) => call('subtitles:list', id),
  },
  ai: {
    status: () => call('ai:status'),
    setKey: (key) => call('ai:setKey', key),
    clearKey: () => call('ai:clearKey'),
    analyze: (id, frames, subtitles) => call('ai:analyze', id, frames, subtitles),
    search: (query) => call('ai:search', query),
    forYou: () => call('ai:forYou'),
    smartPlaylist: (prompt) => call('ai:smartPlaylist', prompt),
    ask: (id, question, history, frames, subtitles) => call('ai:ask', id, question, history, frames, subtitles),
    onAskDelta: (fn) => on('ai:askDelta', fn),
    insights: () => call('ai:insights'),
    clearAnalysis: (id) => call('ai:clearAnalysis', id),
  },
  lock: {
    status: () => call('lock:status'),
    setPin: (pin, current) => call('lock:setPin', pin, current),
    clearPin: (pin) => call('lock:clearPin', pin),
    verify: (pin) => call('lock:verify', pin),
  },
});
