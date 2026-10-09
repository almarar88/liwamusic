/* LiwaIPTV — قراءة قوائم M3U/M3U8 وتصنيفها إلى قنوات وأفلام ومسلسلات.
   يتعامل مع سمات EXTINF الشائعة (tvg-*, group-title, catchup) ومع خيارات
   EXTVLCOPT/KODIPROP (User-Agent و Referer)، ويجمع الحلقات في مسلسلات. */
'use strict';

import { parseEpisode, parseTitle, urlExt, hash, isAdult } from './util.js';

const ATTR = /([\w-]+)="([^"]*)"/g;

/** يحلل نص M3U إلى قائمة إدخالات خام + سمات الرأس (url-tvg...). */
export function parseM3U(text) {
  const lines = String(text || '').replace(/^﻿/, '').split(/\r?\n/);
  const header = {};
  const entries = [];
  let cur = null;
  for (let raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#EXTM3U')) {
      for (const [, k, v] of line.matchAll(ATTR)) header[k.toLowerCase()] = v;
      continue;
    }
    if (line.startsWith('#EXTINF')) {
      cur = { attrs: {}, name: '', opts: {} };
      // الاسم بعد أول فاصلة خارج علامات الاقتباس (وقد يحوي الاسم نفسه فواصل)
      let inQ = false; let comma = -1;
      for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (c === '"') inQ = !inQ;
        else if (c === ',' && !inQ) { comma = i; break; }
      }
      const head = comma >= 0 ? line.slice(0, comma) : line;
      cur.name = comma >= 0 ? line.slice(comma + 1).trim() : '';
      for (const [, k, v] of head.matchAll(ATTR)) cur.attrs[k.toLowerCase()] = v.trim();
      const dur = head.match(/^#EXTINF:\s*(-?\d+)/);
      if (dur) cur.duration = Number(dur[1]);
      continue;
    }
    if (line.startsWith('#EXTGRP:')) { if (cur) cur.attrs['group-title'] ||= line.slice(8).trim(); continue; }
    if (line.startsWith('#EXTVLCOPT:')) {
      if (!cur) cur = { attrs: {}, name: '', opts: {} };
      const kv = line.slice(11);
      const i = kv.indexOf('=');
      if (i > 0) {
        const k = kv.slice(0, i).toLowerCase();
        const v = kv.slice(i + 1);
        if (k === 'http-user-agent') cur.opts.ua = v;
        else if (k === 'http-referrer' || k === 'http-referer') cur.opts.referer = v;
      }
      continue;
    }
    if (line.startsWith('#KODIPROP:')) {
      if (!cur) cur = { attrs: {}, name: '', opts: {} };
      const m = line.match(/stream_headers=(.*)$/i);
      if (m) for (const part of m[1].split('&')) {
        const [k, v] = part.split('=');
        if (/user-agent/i.test(k)) cur.opts.ua = decodeURIComponent(v || '');
        if (/referr?er/i.test(k)) cur.opts.referer = decodeURIComponent(v || '');
      }
      continue;
    }
    if (line.startsWith('#')) continue;
    // سطر الرابط — قد يحمل خيارات بعد "|" كما في Kodi: url|User-Agent=..&Referer=..
    const e = cur || { attrs: {}, name: '', opts: {} };
    let url = line;
    const pipe = url.indexOf('|');
    if (pipe > 0) {
      for (const part of url.slice(pipe + 1).split('&')) {
        const [k, v] = part.split('=');
        if (/user-agent/i.test(k)) e.opts.ua = decodeURIComponent(v || '');
        if (/referr?er/i.test(k)) e.opts.referer = decodeURIComponent(v || '');
      }
      url = url.slice(0, pipe);
    }
    e.url = url;
    if (!e.name) e.name = e.attrs['tvg-name'] || url.split('/').pop();
    entries.push(e);
    cur = null;
  }
  return { header, entries };
}

const VOD_EXT = new Set(['mp4', 'mkv', 'avi', 'mov', 'wmv', 'flv', 'webm', 'm4v', 'mpg', 'mpeg', 'divx']);

/** نوع الإدخال: live / movie / episode — من مسار Xtream أولًا، ثم الامتداد والاسم والمجموعة. */
export function classify(e) {
  const url = e.url || '';
  if (/\/series\//i.test(url)) return 'episode';
  if (/\/movie\//i.test(url)) return 'movie';
  const ext = urlExt(url);
  const group = e.attrs['group-title'] || '';
  const ep = parseEpisode(e.name);
  if (VOD_EXT.has(ext) || (e.duration > 0)) {
    if (ep || /series|مسلسل|مسلسلات/i.test(group)) return ep ? 'episode' : 'movie';
    return 'movie';
  }
  if (/\/live\//i.test(url)) return 'live';
  if (ep && /series|مسلسل|مسلسلات/i.test(group)) return 'episode';
  if (/movie|vod|film|أفلام|افلام|فيلم/i.test(group) && ext !== 'm3u8' && ext !== 'ts') return 'movie';
  return 'live';
}

/**
 * يحوّل قائمة M3U إلى مكتبة LiwaIPTV:
 * { cats: {live, movie, series}, items: [...], series: { id: {seasons} }, epgUrl }
 */
export function buildLibrary(text) {
  const { header, entries } = parseM3U(text);
  const cats = { live: new Map(), movie: new Map(), series: new Map() };
  const items = [];
  const seriesMap = new Map();
  const catId = (kind, name) => {
    const n = name || 'غير مصنّف';
    const id = `${kind[0]}:${hash(n)}`;
    if (!cats[kind].has(id)) cats[kind].set(id, { id, name: n, adult: isAdult(n) });
    return id;
  };
  let num = 0;
  for (const e of entries) {
    const kind = classify(e);
    const a = e.attrs;
    const group = a['group-title'];
    const logo = a['tvg-logo'] || a['logo'] || '';
    const headers = (e.opts.ua || e.opts.referer) ? { ua: e.opts.ua, referer: e.opts.referer } : undefined;
    if (kind === 'live') {
      num++;
      const catchupDays = Number(a['catchup-days'] || a['tvg-rec'] || 0);
      items.push({
        id: `l:${hash(e.url + e.name)}`, kind: 'live', name: e.name, logo,
        cat: catId('live', group), num: Number(a['tvg-chno']) || num, url: e.url,
        epgId: a['tvg-id'] || a['tvg-name'] || '', headers,
        catchup: catchupDays ? { days: catchupDays, type: a.catchup || 'default', src: a['catchup-source'] || '' } : undefined,
      });
    } else if (kind === 'movie') {
      const t = parseTitle(e.name);
      items.push({
        id: `m:${hash(e.url)}`, kind: 'movie', name: e.name, title: t.title, year: t.year, quality: t.quality,
        logo, cat: catId('movie', group), url: e.url, headers,
      });
    } else {
      const ep = parseEpisode(e.name) || { series: group || e.name, season: 1, episode: 0, title: e.name };
      const sTitle = parseTitle(ep.series);
      const key = `s:${hash((group || '') + '|' + sTitle.title.toLowerCase())}`;
      let s = seriesMap.get(key);
      if (!s) {
        s = {
          id: key, kind: 'series', name: sTitle.title, title: sTitle.title, year: sTitle.year,
          logo, cat: catId('series', group), seasons: {}, headers,
        };
        seriesMap.set(key, s);
        items.push(s);
      }
      if (!s.logo && logo) s.logo = logo;
      (s.seasons[ep.season] ||= []).push({
        id: `e:${hash(e.url)}`, season: ep.season, episode: ep.episode,
        title: ep.title || `الحلقة ${ep.episode}`, url: e.url, img: logo, headers,
      });
    }
  }
  for (const s of seriesMap.values()) {
    for (const k of Object.keys(s.seasons)) s.seasons[k].sort((x, y) => x.episode - y.episode);
  }
  return {
    cats: { live: [...cats.live.values()], movie: [...cats.movie.values()], series: [...cats.series.values()] },
    items,
    epgUrl: header['url-tvg'] || header['x-tvg-url'] || '',
  };
}

/** يستخرج بيانات Xtream من رابط get.php إن كان رابط M3U منه — لنحوّله لوضع API الأغنى. */
export function xtreamFromM3UUrl(url) {
  try {
    const u = new URL(url);
    if (!/get\.php$/i.test(u.pathname)) return null;
    const username = u.searchParams.get('username');
    const password = u.searchParams.get('password');
    if (!username || !password) return null;
    return { server: `${u.protocol}//${u.host}${u.pathname.replace(/get\.php$/i, '').replace(/\/$/, '')}`, username, password };
  } catch { return null; }
}
