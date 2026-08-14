// P19 · Юнит-тест движка профиля вкуса (чистое ядро, без БД).
// Запуск: node experiments/profile-test.js
// 15 синтетических дегустаций с заданными паттернами → проверяем, что профиль
// их отражает и формат соответствует prompts.md (S5, режим Б).

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeTasteProfileData, formatTasteProfile } from '../src/ai/profileCore.js';

const here = dirname(fileURLToPath(import.meta.url));

// --- синтетика: 15 дегустаций -------------------------------------------------
// Паттерны: любит неббиоло (6 × 8+), нейтрален к санджовезе (4 × 6–7),
// стабильно не любит темпранильо (3 × ~4), единичный провал полусладкого
// муската (1 × 3 → «единожды»), одиночный шардоне 6.0 (НЕ должен попасть —
// одна оценка не паттерн).
let wineSeq = 0;
const mkWine = (grape, { color = 'red', region = null, price = null, sweetness = 'dry' } = {}) => ({
  id: `w${++wineSeq}`,
  name: `${grape} test ${wineSeq}`,
  color,
  sweetness,
  region,
  price,
  grapes: [{ name: grape, percent: 100 }],
});

const wines = [
  // неббиоло — 6 вин, Пьемонт, бюджет 2800–4500
  ...Array.from({ length: 6 }, (_, i) =>
    mkWine('Неббиоло', { region: 'Пьемонт', price: [2800, 3200, 3500, 4000, 4200, 4500][i] })
  ),
  // санджовезе — 4 вина, Тоскана
  ...Array.from({ length: 4 }, (_, i) =>
    mkWine('Санджовезе', { region: 'Тоскана', price: [1800, 2000, 2200, 2500][i] })
  ),
  // темпранильо — 3 вина
  ...Array.from({ length: 3 }, (_, i) => mkWine('Темпранильо', { price: [1500, 1600, 1700][i] })),
  // мускат полусладкий — 1 вино
  mkWine('Мускат', { color: 'white', sweetness: 'semi-sweet', price: 900 }),
  // шардоне — 1 вино (одиночный, не должен попасть в профиль)
  mkWine('Шардоне', { color: 'white', price: 2100 }),
];

let tSeq = 0;
const mkTasting = (wineId, totalScore, extra = {}) => ({
  id: `t${++tSeq}`,
  wineId,
  totalScore,
  aromas: [],
  notesNow: null,
  ...extra,
});

const tastings = [
  // неббиоло 8+ с повторяющимися ароматами
  mkTasting('w1', 8.5, { aromas: ['вишня', 'дёготь'] }),
  mkTasting('w2', 9.0, { aromas: ['вишня', 'кожа'] }),
  mkTasting('w3', 8.2, { aromas: ['дёготь', 'роза'] }),
  mkTasting('w4', 8.8, { aromas: ['вишня', 'кожа'] }),
  mkTasting('w5', 8.0, { aromas: ['вишня'] }),
  mkTasting('w6', 8.6, { aromas: ['дёготь'] }),
  // санджовезе 6–7
  mkTasting('w7', 6.5),
  mkTasting('w8', 7.0),
  mkTasting('w9', 6.0),
  mkTasting('w10', 6.8),
  // темпранильо ~4 (стабильно не зашло)
  mkTasting('w11', 4.0, { notesNow: 'плоско и скучно' }),
  mkTasting('w12', 4.5),
  mkTasting('w13', 3.8),
  // мускат полусладкий — единичный провал, длинная заметка (обрежется до 6 слов)
  mkTasting('w14', 3.0, { notesNow: 'приторно до зубной боли, совсем не моё это всё' }),
  // шардоне — одиночная нейтральная оценка (не паттерн)
  mkTasting('w15', 6.0),
];

// --- прогон -------------------------------------------------------------------
const data = computeTasteProfileData(tastings, wines);
const text = formatTasteProfile(data);

const checks = [];
const check = (name, cond) => checks.push({ name, pass: !!cond });

check('15 дегустаций учтены', data.tastingsCount === 15 && data.winesCount === 15);
check(
  'Любит: неббиоло 8+ (6 дегустаций)',
  data.loves.length === 1 && data.loves[0].grape === 'неббиоло' && data.loves[0].avg >= 8 && data.loves[0].n === 6
);
check('Регион любимых: Пьемонт', data.loveRegions.includes('Пьемонт'));
check(
  'Ароматы фаворитов: вишня первой',
  data.topAromas[0] === 'вишня' && data.topAromas.includes('дёготь')
);
check(
  'Нейтрально: санджовезе 6–7',
  data.neutral.length === 1 && data.neutral[0].grape === 'санджовезе'
);
check(
  'Не зашло: темпранильо (3 дегустации, без «единожды»)',
  data.dislikes.some((g) => g.grape === 'темпранильо' && !g.once && g.note === 'плоско и скучно')
);
const muscat = data.dislikes.find((g) => g.grape === 'мускат');
check('Не зашло: мускат — единичный провал с «единожды»', muscat?.once === true);
check(
  'Цитата муската обрезана до 6 слов',
  muscat?.note === 'приторно до зубной боли, совсем не'
);
check(
  'Одиночный шардоне (6.0) не попал никуда',
  !JSON.stringify([data.loves, data.neutral, data.dislikes]).includes('шардоне')
);
check('Бюджет посчитан', /^\d+–\d+ ₽$/.test(data.budget ?? ''));
check('Формат: заголовок', text.startsWith('Профиль вкуса пользователя (15 вин, 15 дегустаций,'));
check('Формат: секция «Любит (8+)»', text.includes('- Любит (8+): неббиоло (ср. 8.5)'));
check('Формат: «единожды» в тексте', text.includes('мускат (3.0, единожды, "приторно до зубной боли, совсем не")'));
check('Формат: финальная инструкция', text.endsWith('Рекомендации match — на основе «Любит», избегай паттернов «Не любит».'));

// --- отчёт --------------------------------------------------------------------
const failed = checks.filter((c) => !c.pass);
const lines = [
  '# P19 · Отчёт: юнит-тест движка профиля вкуса',
  '',
  `Дата: ${new Date().toISOString().slice(0, 10)} · Прогон: node experiments/profile-test.js`,
  '',
  '15 синтетических дегустаций: неббиоло 6×8+ (Пьемонт), санджовезе 4×6–7 (Тоскана),',
  'темпранильо 3×~4, мускат полусладкий 1×3 (единичный провал), шардоне 1×6 (одиночный).',
  '',
  '## Проверки',
  '',
  ...checks.map((c) => `- [${c.pass ? 'x' : ' '}] ${c.name}`),
  '',
  `**Итог: ${checks.length - failed.length}/${checks.length}**`,
  '',
  '## Сгенерированный профиль (подстановка {{ПРОФИЛЬ_ВКУСА}})',
  '',
  '```',
  text,
  '```',
  '',
];

mkdirSync(join(here, 'results'), { recursive: true });
writeFileSync(join(here, 'results', 'profile-test-report.md'), lines.join('\n'));

console.log(lines.slice(0, lines.indexOf('## Сгенерированный профиль (подстановка {{ПРОФИЛЬ_ВКУСА}})')).join('\n'));
console.log('\n' + text);
process.exit(failed.length ? 1 : 0);
