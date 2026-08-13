import { db } from '../db.js';
import { normalizeName } from './normalize.js';

const now = () => new Date().toISOString();

export function listByStatus(status) {
  return db.wines.where('status').equals(status).toArray();
}

export function search(query) {
  const q = normalizeName(query);
  if (!q) return db.wines.toArray();
  return db.wines
    .filter(
      (w) =>
        normalizeName(w.name).includes(q) || normalizeName(w.wineryName).includes(q)
    )
    .toArray();
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
