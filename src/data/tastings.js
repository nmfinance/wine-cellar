import { db } from '../db.js';
import { normalizeName } from './normalize.js';
import { ensureWineryGeo } from './wineries.js';
import { askScoreOpinion } from '../api/ai.js';
import { pluralize } from '../utils/plural.js';

const now = () => new Date().toISOString();

const round1 = (n) => Math.round(n * 10) / 10;

export function totalOf(scores) {
  const { appearance = 0, nose = 0, taste = 0, finish = 0, overall = 0 } = scores ?? {};
  return round1(appearance + nose + taste + finish + overall);
}

// Винодельня создаётся ЛЕНИВО — при первой дегустации её вина.
// Пока только запись + wineryId; геокодинг и S2-справка подключатся в P17.
export async function ensureWinery(wine) {
  if (!wine?.wineryName) return null;
  if (wine.wineryId) return db.wineries.get(wine.wineryId);

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
      createdAt: ts,
      updatedAt: ts,
    };
    await db.wineries.add(winery);
  }
  await db.wines.update(wine.id, { wineryId: winery.id, updatedAt: now() });
  return winery;
}

const isFirstWineryTasting = async (wineryId, excludeTastingId) => {
  const wineIds = (await db.wines.filter((w) => w.wineryId === wineryId).toArray()).map(
    (w) => w.id
  );
  const count = await db.tastings
    .filter((t) => wineIds.includes(t.wineId) && t.id !== excludeTastingId)
    .count();
  return count === 0;
};

export async function addTasting(wineId, data) {
  const ts = now();
  const tasting = {
    id: crypto.randomUUID(),
    wineId,
    date: ts,
    place: 'home',
    decantMinutes: null,
    colorNote: null,
    aromas: [],
    aromaIntensity: 0,
    taste: null,
    notesNow: null,
    aerationNotes: null,
    aerationPending: false,
    aiQuestions: [],
    aiOpinion: null,
    scores: { appearance: 0, nose: 0, taste: 0, finish: 0, overall: 0 },
    ...data,
    createdAt: ts,
    updatedAt: ts,
  };
  tasting.totalScore = data.totalScore ?? totalOf(tasting.scores);
  await db.tastings.add(tasting);

  const wine = await db.wines.get(wineId);
  if (wine) {
    const winery = await ensureWinery(wine);
    // гео-фаза (P17): первая дегустация вин винодельни → координаты,
    // асинхронно — переход в карточку не ждёт Nominatim
    if (winery && winery.lat == null) {
      isFirstWineryTasting(winery.id, tasting.id).then((first) => {
        // первая — всегда; повторные — если геокодинг отложен или не пробовался
        if (first || winery.needsGeocode || !winery.geoTriedAt) {
          ensureWineryGeo(winery.id).catch((e) => console.warn('[geo] не удалось:', e));
        }
      });
    }
  }
  return tasting;
}

export function listByWine(wineId) {
  return db.tastings.where('wineId').equals(wineId).sortBy('date');
}

// {{GRAPE_EXPERIENCE}} для S3: прошлые дегустации вин с тем же первым сортом
// (включая прошлые дегустации этого же вина)
export async function buildGrapeExperience(wine) {
  const grape = wine.grapes?.[0]?.name;
  if (!grape) return 'пробует этот сорт впервые';
  const sameGrapeWines = await db.wines
    .filter((w) => w.grapes?.[0]?.name === grape)
    .toArray();
  const wineIds = new Set(sameGrapeWines.map((w) => w.id));
  const tastings = await db.tastings.filter((t) => wineIds.has(t.wineId)).toArray();
  if (!tastings.length) return 'пробует этот сорт впервые';
  const avg = tastings.reduce((a, t) => a + (t.totalScore ?? 0), 0) / tastings.length;
  const counts = {};
  for (const t of tastings) for (const a of t.aromas ?? []) counts[a] = (counts[a] ?? 0) + 1;
  const top = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([a]) => a);
  return `пробовал ${tastings.length} ${pluralize(tastings.length, 'раз', 'раза', 'раз')}, средняя оценка ${avg.toFixed(1)}${
    top.length ? `, чаще всего отмечал ароматы: ${top.join(', ')}` : ''
  }`;
}

// S4 вдогонку после сохранения: мгновенное сохранение не ждёт AI,
// результат приедет в tasting.aiOpinion через liveQuery
export function fireScoreOpinion(wine, tasting) {
  db.tastings.update(tasting.id, { aiOpinionPending: true }).catch(() => {});
  askScoreOpinion(wine, tasting)
    .then(async (res) => {
      if (res.ok && typeof res.data?.ai_score === 'number') {
        await db.tastings.update(tasting.id, {
          aiOpinion: {
            score: res.data.ai_score,
            verdict: res.data.verdict === 'differs' ? 'differs' : 'match',
            comment: res.data.comment ?? null,
          },
          aiOpinionPending: false,
          updatedAt: now(),
        });
      } else {
        await db.tastings.update(tasting.id, { aiOpinionPending: false });
      }
    })
    .catch(() => db.tastings.update(tasting.id, { aiOpinionPending: false }));
}
