import { db } from '../db.js';
import { askDeepWine } from '../api/ai.js';

// S6 «Глубже о вине»: один раз на вино, кэш навсегда в wine.aiDeep.
// Guard в памяти — чтобы неудачный запрос не долбился при каждом рендере
// (после перезапуска приложения попытка повторится).
const requested = new Set();

export function ensureDeepInfo(wine) {
  if (!wine?.id || wine.aiDeep || requested.has(wine.id)) return;
  // для ручных вин без сорта и региона рассказывать не о чем
  if (!wine.grapes?.length && !wine.region && !wine.appellation) return;
  requested.add(wine.id);

  askDeepWine(wine)
    .then((res) => {
      if (!res.ok) {
        console.warn('[deep] S6 не удался:', res.error);
        requested.delete(wine.id); // позволим повтор позже
        return;
      }
      return db.wines.update(wine.id, {
        aiDeep: res.data,
        updatedAt: new Date().toISOString(),
      });
    })
    .catch((err) => {
      console.error('[deep] S6 ошибка:', err);
      requested.delete(wine.id);
    });
}

// P22: «обновить» в блоке «Глубже о вине» — свежий S6 с перезаписью
// (старые aiDeep без vintage_note получают поле после обновления)
export async function refreshDeepInfo(wine) {
  const res = await askDeepWine(wine);
  if (!res.ok) return res;
  await db.wines.update(wine.id, { aiDeep: res.data, updatedAt: new Date().toISOString() });
  return res;
}
