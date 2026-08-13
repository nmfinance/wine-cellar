import { normalizeName } from '../data/normalize.js';

// Скоринг матча Vivino на клиенте: доля токенов запроса, найденных в имени
// матча. ≥0.7 — high, ≥0.4 — medium, ниже — low.
export function matchScore(query, matchedName) {
  const qTokens = [...new Set(normalizeName(query).split(' ').filter(Boolean))];
  if (!qTokens.length) return 'low';
  const mTokens = new Set(normalizeName(matchedName ?? '').split(' ').filter(Boolean));
  const ratio = qTokens.filter((t) => mTokens.has(t)).length / qTokens.length;
  if (ratio >= 0.7) return 'high';
  if (ratio >= 0.4) return 'medium';
  return 'low';
}
