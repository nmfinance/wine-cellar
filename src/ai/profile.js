import { db } from '../db.js';
import { computeTasteProfileData, formatTasteProfile } from './profileCore.js';

// Профиль вкуса для {{ПРОФИЛЬ_ВКУСА}} в S5 (движок — P18, включение в UI — P19).
// null при < порога дегустаций → подставляется заглушка холодного старта.
// Порог живёт в meta 'personalThreshold' (правится из консоли для тестов).

export const DEFAULT_PERSONAL_THRESHOLD = 10;

export async function getPersonalThreshold() {
  const m = await db.meta.get('personalThreshold');
  const v = Number(m?.value);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_PERSONAL_THRESHOLD;
}

// Структура профиля для шита; minTastings = null → порог из meta
export async function buildTasteProfileData(minTastings = null) {
  const threshold = minTastings ?? (await getPersonalThreshold());
  const tastings = await db.tastings.toArray();
  if (tastings.length < threshold) return null;
  const wines = await db.wines.toArray();
  return computeTasteProfileData(tastings, wines);
}

export async function buildTasteProfile(minTastings = null) {
  const data = await buildTasteProfileData(minTastings);
  return data ? formatTasteProfile(data) : null;
}
