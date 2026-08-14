import { db } from '../db.js';

// Профиль вкуса для {{ПРОФИЛЬ_ВКУСА}} в S5 (движок — P18, интеграция в UI — P19).
// null при < minTastings дегустаций → подставляется заглушка холодного старта.
const TYPE_RU = { red: 'красных', white: 'белых', rose: 'розовых', orange: 'оранжевых' };

const percentile = (sorted, p) => sorted[Math.floor((sorted.length - 1) * p)];
const roundBudget = (n) => Math.round(n / 500) * 500 || 500;

export async function buildTasteProfile(minTastings = 10) {
  const tastings = await db.tastings.toArray();
  if (tastings.length < minTastings) return null;

  const wines = await db.wines.toArray();
  const byId = new Map(wines.map((w) => [w.id, w]));

  const grapeScores = {}; // сорт → [оценки]
  const aromaCounts = {}; // ароматы дегустаций с оценкой 8+
  const dislikeNotes = {}; // сорт → заметка низкой оценки (для колорита)
  const tastedWineIds = new Set();

  for (const t of tastings) {
    const wine = byId.get(t.wineId);
    if (!wine) continue;
    tastedWineIds.add(wine.id);
    const grape = wine.grapes?.[0]?.name?.toLowerCase();
    const score = t.totalScore ?? 0;
    if (grape) {
      (grapeScores[grape] ??= []).push(score);
      if (score < 5 && t.notesNow && !dislikeNotes[grape]) {
        dislikeNotes[grape] = t.notesNow.slice(0, 30);
      }
    }
    if (score >= 8) for (const a of t.aromas ?? []) aromaCounts[a] = (aromaCounts[a] ?? 0) + 1;
  }

  const tastedWines = [...tastedWineIds].map((id) => byId.get(id));
  const avgAll = tastings.reduce((a, t) => a + (t.totalScore ?? 0), 0) / tastings.length;

  const grapeAvg = Object.entries(grapeScores).map(([grape, scores]) => ({
    grape,
    avg: scores.reduce((a, b) => a + b, 0) / scores.length,
    n: scores.length,
  }));
  const fmt = (list) => list.map((g) => `${g.grape} (ср. ${g.avg.toFixed(1)})`).join(', ');
  const loves = grapeAvg.filter((g) => g.avg >= 8).sort((a, b) => b.avg - a.avg);
  const neutral = grapeAvg.filter((g) => g.avg >= 6 && g.avg < 8).sort((a, b) => b.avg - a.avg);
  const dislikes = grapeAvg.filter((g) => g.avg < 5).sort((a, b) => a.avg - b.avg);

  // любимые регионы — из вин с высокой средней сортов «любит»
  const loveGrapes = new Set(loves.map((g) => g.grape));
  const loveRegions = [
    ...new Set(
      tastedWines
        .filter((w) => loveGrapes.has(w.grapes?.[0]?.name?.toLowerCase()) && w.region)
        .map((w) => w.region)
    ),
  ].slice(0, 3);

  const topAromas = Object.entries(aromaCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([a]) => a);

  // наименее представленный тип — зона discover
  const typeCounts = {};
  for (const w of tastedWines) typeCounts[w.color] = (typeCounts[w.color] ?? 0) + 1;
  const rareType = ['white', 'red', 'rose', 'orange']
    .filter((c) => TYPE_RU[c])
    .sort((a, b) => (typeCounts[a] ?? 0) - (typeCounts[b] ?? 0))[0];

  const prices = tastedWines.map((w) => w.price).filter((p) => p > 0).sort((a, b) => a - b);
  const budget = prices.length >= 3
    ? `${roundBudget(percentile(prices, 0.25))}–${roundBudget(percentile(prices, 0.75))} ₽`
    : null;

  const lines = [
    `Профиль вкуса пользователя (${tastedWineIds.size} вин, ${tastings.length} дегустаций, средняя ${avgAll.toFixed(1)}):`,
  ];
  if (loves.length) {
    lines.push(
      `- Любит (8+): ${fmt(loves)}${loveRegions.length ? `; ${loveRegions.join(', ')}` : ''}${
        topAromas.length ? `; частые ароматы в высоких оценках: ${topAromas.join(', ')}` : ''
      }`
    );
  }
  if (neutral.length) lines.push(`- Нейтрально (6-7): ${fmt(neutral)}`);
  if (dislikes.length) {
    lines.push(
      `- Не любит (<5): ${dislikes
        .map((g) => `${g.grape} (${g.avg.toFixed(1)}${dislikeNotes[g.grape] ? `, "${dislikeNotes[g.grape]}"` : ''})`)
        .join(', ')}`
    );
  }
  if (rareType && (typeCounts[rareType] ?? 0) < tastedWineIds.size / 4) {
    lines.push(
      `- ${TYPE_RU[rareType][0].toUpperCase() + TYPE_RU[rareType].slice(1)} пробовал мало (${typeCounts[rareType] ?? 0} из ${tastedWineIds.size}) — зона для discover`
    );
  }
  if (budget) lines.push(`- Обычный бюджет: ${budget}`);
  lines.push('Рекомендации match — на основе «Любит», избегай паттернов «Не любит».');
  return lines.join('\n');
}
