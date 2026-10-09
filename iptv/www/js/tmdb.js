/* LiwaIPTV — إثراء الأفلام والمسلسلات من TMDB (اختياري): ملصق، خلفية، قصة،
   تقييم، ممثلون — للقوائم التي لا تحمل صورًا أو وصفًا (M3U غالبًا).
   يقبل مفتاح v3 أو رمز القراءة v4 (Bearer). النتائج تُخزَّن محليًا. */
'use strict';

import { http } from './http.js';
import { store } from './store.js';

const API = 'https://api.themoviedb.org/3';
export const IMG = (path, size = 'w342') => (path ? `https://image.tmdb.org/t/p/${size}${path}` : '');

function auth(key) {
  return key.length > 40 ? { headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' }, q: '' } : { headers: { Accept: 'application/json' }, q: `api_key=${encodeURIComponent(key)}&` };
}

const mem = new Map();

/** يبحث عن عنوان ويعيد بيانات العرض أو null. kind: movie | series */
export async function enrich(key, kind, title, year, lang = 'ar') {
  if (!key || !title) return null;
  const type = kind === 'series' ? 'tv' : 'movie';
  const cacheKey = `tmdb:${type}:${title.toLowerCase()}:${year || ''}:${lang}`;
  if (mem.has(cacheKey)) return mem.get(cacheKey);
  const cached = await store.get(cacheKey);
  if (cached !== null && cached !== undefined) { mem.set(cacheKey, cached); return cached; }
  const a = auth(key);
  const yq = year ? `&${type === 'tv' ? 'first_air_date_year' : 'year'}=${year}` : '';
  let result = null;
  try {
    const s = await http.json(`${API}/search/${type}?${a.q}language=${lang}&query=${encodeURIComponent(title)}${yq}`, { headers: a.headers, timeout: 15000 });
    const hit = s && s.results && s.results[0];
    if (hit) {
      const d = await http.json(`${API}/${type}/${hit.id}?${a.q}language=${lang}&append_to_response=credits,videos`, { headers: a.headers, timeout: 15000 });
      const trailer = ((d.videos && d.videos.results) || []).find((v) => v.site === 'YouTube' && /Trailer|Teaser/.test(v.type));
      result = {
        tmdb: hit.id,
        poster: IMG(d.poster_path),
        backdrop: IMG(d.backdrop_path, 'w1280'),
        plot: d.overview || '',
        rating: d.vote_average || 0,
        year: Number(String(d.release_date || d.first_air_date || '').slice(0, 4)) || year || null,
        genre: (d.genres || []).map((g) => g.name).join('، '),
        cast: ((d.credits && d.credits.cast) || []).slice(0, 8).map((c) => c.name).join('، '),
        duration: d.runtime || (d.episode_run_time && d.episode_run_time[0]) || 0,
        trailer: trailer ? trailer.key : '',
      };
    }
  } catch { return null; } // لا نخزّن الفشل الشبكي
  mem.set(cacheKey, result);
  store.set(cacheKey, result);
  return result;
}
