import { db } from '../db.js';
import { normalizeName } from './normalize.js';

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
  if (wine) await ensureWinery(wine);
  return tasting;
}

export function listByWine(wineId) {
  return db.tastings.where('wineId').equals(wineId).sortBy('date');
}
