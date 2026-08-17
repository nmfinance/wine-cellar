import { db } from '../db.js';
import { normalizeName } from './normalize.js';
import { askWineryInfo } from '../api/ai.js';
import { geocodeWinery } from '../api/geocode.js';

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
  // P22: S2 v3 — полный паспорт хранится как есть (passport), плоские поля
  // остаются для совместимости (WineryBlock, гео, старые экраны)
  await db.wineries.update(winery.id, {
    passport: {
      knownLevel: d.known_level ?? (d.known === true ? 'partial' : 'minimal'),
      identity: d.identity ?? null,
      terroir: d.terroir ?? null,
      vineyard: d.vineyard ?? null,
      cellar: d.cellar ?? null,
      wines: Array.isArray(d.wines) ? d.wines : [],
    },
    infoVersion: 3,
    known: d.known === true,
    founded: typeof d.identity?.founded === 'number' ? d.identity.founded : null,
    regionNote: d.identity?.appellation_zone ?? null,
    positioning: d.positioning ?? null,
    opinion: d.opinion ?? null,
    history: d.history ?? null,
    locationHint: d.location_hint ?? null,
    aiSummary: d.opinion ?? null, // совместимость со старым полем
    infoStatus: 'ready',
    updatedAt: now(),
  });
  console.debug('[winery] паспорт v3 сохранён:', winery.name);
}

// Гео-фаза (P17): координаты при первой дегустации вин винодельни.
// Успех → тост через событие; офлайн → needsGeocode для фоновой доборки.
export async function ensureWineryGeo(wineryId) {
  const winery = await db.wineries.get(wineryId);
  if (!winery || winery.lat != null) return;
  if (navigator.onLine === false) {
    await db.wineries.update(wineryId, { needsGeocode: true, updatedAt: now() });
    console.debug('[geo] офлайн — отложено:', winery.name);
    return;
  }
  const geo = await geocodeWinery(winery);
  if (geo) {
    await db.wineries.update(wineryId, {
      lat: geo.lat,
      lng: geo.lng,
      geoStatus: geo.precision,
      needsGeocode: false,
      geoTriedAt: now(),
      updatedAt: now(),
    });
    // ненавязчивый тост, если пользователь ещё в приложении
    window.dispatchEvent(
      new CustomEvent('winery-geocoded', { detail: { name: winery.name } })
    );
  } else {
    await db.wineries.update(wineryId, {
      geoStatus: 'manual_needed',
      needsGeocode: false,
      geoTriedAt: now(),
      updatedAt: now(),
    });
  }
}

// Фоновая доборка при старте: отложенные (needsGeocode) + самолечение старых
// записей без координат с дегустациями (если ещё не пробовали геокодить)
export async function backfillGeocode() {
  if (navigator.onLine === false) return;
  const candidates = await db.wineries.filter((w) => w.lat == null).toArray();
  for (const winery of candidates) {
    if (!winery.needsGeocode) {
      if (winery.geoTriedAt) continue; // уже пробовали — не долбим Nominatim
      const wineIds = (await db.wines.filter((x) => x.wineryId === winery.id).toArray()).map(
        (x) => x.id
      );
      const tasted = await db.tastings.filter((t) => wineIds.includes(t.wineId)).count();
      if (!tasted) continue;
    }
    await ensureWineryGeo(winery.id);
  }
}

// «Обновить справку»: повторный S2 с перезаписью — дообогащение старых записей
export async function refreshWineryInfo(wineryId) {
  const winery = await db.wineries.get(wineryId);
  if (!winery) return;
  await db.wineries.update(wineryId, { infoStatus: 'loading', updatedAt: now() });
  await fillWineryInfo(winery);
}
