import { db } from '../db.js';
import { normalizeName } from './normalize.js';
import { askWineryInfo } from '../api/ai.js';

const now = () => new Date().toISOString();

// Фаза 1 (P10.5): справка о винодельне при ПЕРВОМ появлении wineryName —
// сохранение скана или создание вина. Таблица wineries = вечный кэш:
// существующая запись S2 повторно не дёргает.
// Фаза 2 (геокодинг, карта) — без изменений, на первой дегустации (P17).
export async function ensureWineryInfo(wine) {
  if (!wine?.wineryName?.trim()) return null;
  const nameNormalized = normalizeName(wine.wineryName);
  let winery = await db.wineries.where('nameNormalized').equals(nameNormalized).first();
  if (!winery) {
    const ts = now();
    winery = {
      id: crypto.randomUUID(),
      name: wine.wineryName,
      nameNormalized,
      region: wine.region ?? null,
      country: wine.country ?? null,
      lat: null,
      lng: null,
      geoStatus: 'manual_needed',
      aiSummary: null,
      known: false,
      founded: null,
      regionNote: null,
      portfolio: null,
      positioning: null,
      opinion: null,
      locationHint: null,
      infoStatus: 'loading',
      createdAt: ts,
      updatedAt: ts,
    };
    await db.wineries.add(winery);
    // справка грузится асинхронно, сохранение вина не ждёт
    fillWineryInfo(winery).catch((err) =>
      console.error('[winery] справка не загрузилась:', err)
    );
  }
  await db.wines.update(wine.id, { wineryId: winery.id, updatedAt: now() });
  return winery;
}

async function fillWineryInfo(winery) {
  const res = await askWineryInfo({
    wineryName: winery.name,
    region: winery.region,
    country: winery.country,
  });
  if (!res.ok) {
    console.warn('[winery] S2 не удался:', res.error);
    await db.wineries.update(winery.id, { infoStatus: 'error', updatedAt: now() });
    return;
  }
  const d = res.data;
  await db.wineries.update(winery.id, {
    known: d.known === true,
    founded: typeof d.founded === 'number' ? d.founded : null,
    regionNote: d.region_note ?? null,
    portfolio: d.portfolio ?? null,
    positioning: d.positioning ?? null,
    opinion: d.opinion ?? null,
    history: d.history ?? null,
    notableWines: d.notable_wines ?? null,
    locationHint: d.location_hint ?? null,
    aiSummary: d.opinion ?? null, // совместимость со старым полем
    infoStatus: 'ready',
    updatedAt: now(),
  });
  console.debug('[winery] справка сохранена:', winery.name);
}

// «Обновить справку»: повторный S2 с перезаписью — дообогащение старых записей
export async function refreshWineryInfo(wineryId) {
  const winery = await db.wineries.get(wineryId);
  if (!winery) return;
  await db.wineries.update(wineryId, { infoStatus: 'loading', updatedAt: now() });
  await fillWineryInfo(winery);
}
