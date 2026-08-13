import { db } from '../db.js';
import { normalizeName } from '../data/normalize.js';
import { APP_KEY, VIVINO_URL } from './config.js';

// Живой рейтинг Vivino через шлюз в Яндекс Облаке.
// Возврат: { ok:true, data } | { ok:false, error: 'not_found'|'blocked'|
//           'vivino_format_changed'|'vivino_error'|'network' }
export async function lookupVivino(query, year = null) {
  try {
    const url = `${VIVINO_URL}/vivino?q=${encodeURIComponent(query)}${year ? `&year=${year}` : ''}`;
    const res = await fetch(url, {
      headers: { 'X-App-Key': APP_KEY },
      signal: AbortSignal.timeout(15_000),
    });
    return await res.json();
  } catch {
    return { ok: false, error: 'network' };
  }
}

// Кэш 30 дней в aiCache: повторный скан той же бутылки не дёргает Яндекс.
// Ошибки (сеть/блокировка) не кэшируются, not_found — кэшируется.
export async function lookupVivinoCached(query, year = null) {
  const key = `${normalizeName(query)}|${year ?? ''}`;
  const id = `vivino:${key}`;
  const now = new Date().toISOString();
  const hit = await db.aiCache.get(id);
  if (hit && (!hit.expiresAt || hit.expiresAt > now)) {
    console.debug('[vivino] из кэша:', key);
    return hit.payload;
  }
  const result = await lookupVivino(query, year);
  if (result.ok || result.error === 'not_found') {
    await db.aiCache.put({
      id,
      kind: 'vivino',
      key,
      payload: result,
      createdAt: now,
      expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    });
  }
  return result;
}

// Запрос для поиска: winery + name + первый сорт (сорт — только при
// уверенном распознавании), нормализация пробелов.
export function buildVivinoQuery(s1data) {
  const parts = [s1data.winery, s1data.name];
  if (s1data.confidence?.grapes === 'high' && s1data.grapes?.[0]?.name) {
    parts.push(s1data.grapes[0].name);
  }
  return parts.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}
