import { NOMINATIM_EMAIL } from './config.js';

// Nominatim (OSM). Вежливость: идентификация через email-параметр (кастомный
// User-Agent из браузера не поставить, Referer уходит сам) + минимум 1.5 с
// между запросами. У нас 1 запрос на новую винодельню — политика с запасом.
let lastCall = 0;

async function nominatim(query) {
  const wait = 1500 - (Date.now() - lastCall);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCall = Date.now();
  const url =
    `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=3` +
    `&q=${encodeURIComponent(query)}&email=${encodeURIComponent(NOMINATIM_EMAIL)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`nominatim ${res.status}`);
  return res.json();
}

// Каскад: location_hint из S2 → «{name} winery, регион, страна» → центр региона.
// Возврат: { lat, lng, precision: 'ok'|'approximate' } | null
export async function geocodeWinery(winery) {
  const attempts = [
    winery.locationHint ? { q: winery.locationHint, precision: 'ok' } : null,
    winery.name
      ? {
          q: `${winery.name} winery, ${[winery.region, winery.country].filter(Boolean).join(', ')}`,
          precision: 'ok',
        }
      : null,
    winery.region || winery.country
      ? { q: [winery.region, winery.country].filter(Boolean).join(', '), precision: 'approximate' }
      : null,
  ].filter(Boolean);

  for (const attempt of attempts) {
    try {
      console.debug('[geo] пробую:', attempt.q);
      const results = await nominatim(attempt.q);
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
