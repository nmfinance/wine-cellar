import { db } from '../db.js';
import { matchesQuery, normalizeName } from './normalize.js';

const now = () => new Date().toISOString();

export function listByStatus(status) {
  return db.wines.where('status').equals(status).toArray();
}

export function search(query) {
  if (!normalizeName(query)) return db.wines.toArray();
  return db.wines.filter((w) => matchesQuery([w.name, w.wineryName], query)).toArray();
}

// Каталог с поиском и фильтрами: внутри секции — ИЛИ, между секциями — И.
// filters: { colors, sweetness, special, countries, grapes, tasted } (массивы)
export async function listFiltered(status, query = '', filters = {}) {
  const f = {
    colors: [],
    sweetness: [],
    special: [],
    countries: [],
    grapes: [],
    tasted: [],
    ...filters,
  };
  const wines = await db.wines.where('status').equals(status).toArray();

  // статистика дегустаций нужна только для секции «Дегустации»
  let stats = null;
  if (f.tasted.length) {
    stats = new Map();
    await db.tastings.each((t) => {
      const cur = stats.get(t.wineId) ?? { count: 0, max: 0 };
      cur.count += 1;
      cur.max = Math.max(cur.max, t.totalScore ?? 0);
      stats.set(t.wineId, cur);
    });
  }

  return wines
    .filter((w) => {
      if (!matchesQuery([w.name, w.wineryName], query)) return false;
      if (f.colors.length && !f.colors.includes(w.color)) return false;
      if (f.sweetness.length && !f.sweetness.includes(w.sweetness)) return false;
      if (f.special.length && !f.special.some((key) => w[key])) return false;
      if (f.countries.length && !f.countries.includes(w.country)) return false;
      if (f.grapes.length && !(w.grapes ?? []).some((g) => f.grapes.includes(g.name)))
        return false;
      if (f.tasted.length) {
        const st = stats.get(w.id);
        const ok = f.tasted.some((key) =>
          key === 'none' ? !st : key === 'tasted' ? !!st : key === 'high' ? (st?.max ?? 0) >= 8 : false
        );
        if (!ok) return false;
      }
      return true;
    })
    .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
}

// Опции для секций «Страна» и «Сорт» — собираются из вин текущей вкладки
export async function facetOptions(status) {
  const wines = await db.wines.where('status').equals(status).toArray();
  const collator = new Intl.Collator('ru');
  const countries = [...new Set(wines.map((w) => w.country).filter(Boolean))].sort(
    collator.compare
  );
  const grapes = [
    ...new Set(wines.flatMap((w) => (w.grapes ?? []).map((g) => g.name)).filter(Boolean)),
  ].sort(collator.compare);
  return { countries, grapes };
}

export async function addWine(data) {
  const ts = now();
  const wine = {
    id: crypto.randomUUID(),
    status: 'cellar',
    source: 'manual',
    historyReason: null,
    historyAt: null,
    name: '',
    wineryName: '',
    wineryId: null,
    year: null,
    nvFlag: false,
    color: 'red',
    sweetness: null,
    sparkling: false,
    fortified: false,
    grapes: [],
    appellation: null,
    region: null,
    country: null,
    alcohol: null,
    quantity: 1,
    price: null,
    currency: 'RUB',
    location: null,
    locationFreeText: null,
    vivino: null,
    aiReference: null,
    confidence: null,
    notes: null,
    ...data,
    createdAt: ts,
    updatedAt: ts,
  };
  await db.wines.add(wine);
  return wine;
}

export async function updateWine(id, patch) {
  await db.wines.update(id, { ...patch, updatedAt: now() });
  return db.wines.get(id);
}

// Выпили бутылку: quantity-1; на нуле вино уезжает в Историю
export function drinkBottle(id) {
  return db.transaction('rw', db.wines, async () => {
    const wine = await db.wines.get(id);
    if (!wine) throw new Error(`Вино ${id} не найдено`);
    const quantity = Math.max(0, (wine.quantity ?? 0) - 1);
    const patch = { quantity, updatedAt: now() };
    if (quantity === 0 && wine.status === 'cellar') {
      patch.status = 'history';
      patch.historyReason = 'drunk';
      patch.historyAt = now();
    }
    await db.wines.update(id, patch);
    return db.wines.get(id);
  });
}

// Перемещение между вкладками (в т.ч. возврат из Истории)
export async function moveTo(id, status) {
  const patch = { status, updatedAt: now() };
  if (status === 'history') {
    patch.historyReason = 'drunk';
    patch.historyAt = now();
  } else {
    patch.historyReason = null;
    patch.historyAt = null;
  }
  await db.wines.update(id, patch);
  return db.wines.get(id);
}
