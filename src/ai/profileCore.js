// Чистая логика профиля вкуса — без БД и импортов, чтобы гоняться
// юнит-скриптом (experiments/profile-test.js) обычным node.
// Отсечки гигиены (P19): сорт — паттерн от 2 дегустаций; единственное
// исключение — единичный провал с оценкой <4 попадает в «Не зашло»
// с пометкой «единожды». Цитаты из заметок — до 6 слов, только для «Не зашло».

const TYPE_RU = { red: 'красных', white: 'белых', rose: 'розовых', orange: 'оранжевых' };

const percentile = (sorted, p) => sorted[Math.floor((sorted.length - 1) * p)];
const roundBudget = (n) => Math.round(n / 500) * 500 || 500;
const firstWords = (s, n) => s.trim().split(/\s+/).slice(0, n).join(' ');

// tastings + wines → структура профиля (для шита «Твой профиль вкуса» и текста S5)
export function computeTasteProfileData(tastings, wines) {
  const byId = new Map(wines.map((w) => [w.id, w]));

  const grapeScores = {}; // сорт → [оценки]
  const aromaCounts = {}; // ароматы дегустаций с оценкой 8+
  const dislikeNotes = {}; // сорт → цитата заметки низкой оценки (≤6 слов)
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
        dislikeNotes[grape] = firstWords(t.notesNow, 6);
      }
    }
    if (score >= 8) for (const a of t.aromas ?? []) aromaCounts[a] = (aromaCounts[a] ?? 0) + 1;
  }

  const tastedWines = [...tastedWineIds].map((id) => byId.get(id));
  const avgAll = tastings.length
    ? tastings.reduce((a, t) => a + (t.totalScore ?? 0), 0) / tastings.length
    : 0;

  const grapeAvg = Object.entries(grapeScores).map(([grape, scores]) => ({
    grape,
    avg: scores.reduce((a, b) => a + b, 0) / scores.length,
    n: scores.length,
  }));
  const solid = grapeAvg.filter((g) => g.n >= 2);
  const loves = solid.filter((g) => g.avg >= 8).sort((a, b) => b.avg - a.avg);
  const neutral = solid.filter((g) => g.avg >= 6 && g.avg < 8).sort((a, b) => b.avg - a.avg);
  const dislikes = [
    ...solid.filter((g) => g.avg < 5),
    ...grapeAvg.filter((g) => g.n === 1 && g.avg < 4).map((g) => ({ ...g, once: true })),
  ]
    .sort((a, b) => a.avg - b.avg)
    .map((g) => ({ ...g, note: dislikeNotes[g.grape] ?? null }));

  // любимые регионы — из вин с сортами «Любит»
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
  const rareColor = ['white', 'red', 'rose', 'orange']
    .filter((c) => TYPE_RU[c])
    .sort((a, b) => (typeCounts[a] ?? 0) - (typeCounts[b] ?? 0))[0];
  const rareType =
    rareColor && (typeCounts[rareColor] ?? 0) < tastedWineIds.size / 4
      ? { color: rareColor, label: TYPE_RU[rareColor], count: typeCounts[rareColor] ?? 0 }
      : null;

  const prices = tastedWines.map((w) => w.price).filter((p) => p > 0).sort((a, b) => a - b);
  const budget =
    prices.length >= 3
      ? `${roundBudget(percentile(prices, 0.25))}–${roundBudget(percentile(prices, 0.75))} ₽`
      : null;

  return {
    winesCount: tastedWineIds.size,
    tastingsCount: tastings.length,
    avgAll,
    loves,
    neutral,
    dislikes,
    loveRegions,
    topAromas,
    rareType,
    budget,
  };
}

// Структура → текст подстановки {{ПРОФИЛЬ_ВКУСА}} (формат — prompts.md, S5 режим Б)
export function formatTasteProfile(d) {
  const fmt = (list) => list.map((g) => `${g.grape} (ср. ${g.avg.toFixed(1)})`).join(', ');
  const lines = [
    `Профиль вкуса пользователя (${d.winesCount} вин, ${d.tastingsCount} дегустаций, средняя ${d.avgAll.toFixed(1)}):`,
  ];
  if (d.loves.length) {
    lines.push(
      `- Любит (8+): ${fmt(d.loves)}${d.loveRegions.length ? `; ${d.loveRegions.join(', ')}` : ''}${
        d.topAromas.length ? `; частые ароматы в высоких оценках: ${d.topAromas.join(', ')}` : ''
      }`
    );
  }
  if (d.neutral.length) lines.push(`- Нейтрально (6-7): ${fmt(d.neutral)}`);
  if (d.dislikes.length) {
    lines.push(
      `- Не любит (<5): ${d.dislikes
        .map(
          (g) =>
            `${g.grape} (${g.avg.toFixed(1)}${g.once ? ', единожды' : ''}${g.note ? `, "${g.note}"` : ''})`
        )
        .join(', ')}`
    );
  }
  if (d.rareType) {
    lines.push(
      `- ${d.rareType.label[0].toUpperCase() + d.rareType.label.slice(1)} пробовал мало (${d.rareType.count} из ${d.winesCount}) — зона для discover`
    );
  }
  if (d.budget) lines.push(`- Обычный бюджет: ${d.budget}`);
  lines.push('Рекомендации match — на основе «Любит», избегай паттернов «Не любит».');
  return lines.join('\n');
}
