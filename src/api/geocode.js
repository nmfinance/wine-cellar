import { NOMINATIM_EMAIL } from './config.js';

// Nominatim (OSM). Вежливость: идентификация через email-параметр (кастомный
// User-Agent из браузера не поставить, Referer уходит сам) + минимум 1.5 с
// между запросами. У нас 1 запрос на новую винодельню — политика с запасом.
let lastCall = 0;

// P22.3: язык и ISO-код страны режут ложные матчи в чужих странах
const COUNTRY_META = {
  россия: { code: 'ru', lang: 'ru' },
  италия: { code: 'it', lang: 'it' },
  франция: { code: 'fr', lang: 'fr' },
  испания: { code: 'es', lang: 'es' },
  португалия: { code: 'pt', lang: 'pt' },
  германия: { code: 'de', lang: 'de' },
  австрия: { code: 'at', lang: 'de' },
  сша: { code: 'us', lang: 'en' },
  чили: { code: 'cl', lang: 'es' },
  аргентина: { code: 'ar', lang: 'es' },
  грузия: { code: 'ge', lang: 'ka' },
  армения: { code: 'am', lang: 'hy' },
  венгрия: { code: 'hu', lang: 'hu' },
  греция: { code: 'gr', lang: 'el' },
};
const metaFor = (country) => COUNTRY_META[String(country ?? '').toLowerCase().trim()] ?? null;

async function nominatim(query, meta = null) {
  const wait = 1500 - (Date.now() - lastCall);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCall = Date.now();
  let url =
    `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=3` +
    `&q=${encodeURIComponent(query)}&email=${encodeURIComponent(NOMINATIM_EMAIL)}`;
  if (meta?.lang) url += `&accept-language=${meta.lang}`;
  if (meta?.code) url += `&countrycodes=${meta.code}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`nominatim ${res.status}`);
  return res.json();
}

// Каскад: location_hint из S2 → «{name} winery / винодельня {name}» → центр
// региона. Возврат: { lat, lng, precision: 'ok'|'approximate' } | null
export async function geocodeWinery(winery) {
  const meta = metaFor(winery.country);
  const isRussia = meta?.code === 'ru';
  const regionCountry = [winery.region, winery.country].filter(Boolean).join(', ');
  const attempts = [
    winery.locationHint ? { q: winery.locationHint, precision: 'ok' } : null,
    // P22.3: для России англ. слово winery рядом с русским именем Nominatim
    // не находит — кириллический шаблон «винодельня {name}, {region}»
    winery.name && isRussia
      ? { q: `винодельня ${winery.name}, ${regionCountry}`, precision: 'ok' }
      : null,
    winery.name ? { q: `${winery.name} winery, ${regionCountry}`, precision: 'ok' } : null,
    regionCountry ? { q: regionCountry, precision: 'approximate' } : null,
  ].filter(Boolean);

  for (const attempt of attempts) {
    try {
      console.debug('[geo] пробую:', attempt.q);
      const results = await nominatim(attempt.q, meta);
      if (results.length) {
        console.debug(`[geo] найдено (${attempt.precision}):`, attempt.q, '→', results[0].lat, results[0].lon);
        return {
          lat: Number(results[0].lat),
          lng: Number(results[0].lon),
          precision: attempt.precision,
        };
      }
    } catch (err) {
      console.warn('[geo] запрос упал:', err.message);
    }
  }
  console.debug('[geo] каскад не дал результата:', winery.name);
  return null;
}

// P22.3: каскад по S7-кандидатам (от точного к общему). Позиции 1–2 → 'ok',
// хвост → 'approximate'. Возврат { lat, lng, precision, matched } | null.
export async function geocodeByCandidates(candidates, country) {
  const meta = metaFor(country);
  for (let i = 0; i < candidates.length; i++) {
    const q = candidates[i];
    try {
      console.debug('[geo:s7] пробую:', q);
      const results = await nominatim(q, meta);
      if (results.length) {
        const precision = i < 2 ? 'ok' : 'approximate';
        console.debug(`[geo:s7] найдено (${precision}):`, q);
        return {
          lat: Number(results[0].lat),
          lng: Number(results[0].lon),
          precision,
          matched: q,
        };
      }
    } catch (err) {
      console.warn('[geo:s7] запрос упал:', err.message);
    }
  }
  return null;
}
