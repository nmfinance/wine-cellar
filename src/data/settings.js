import { db } from '../db.js';

// P20: пользовательские настройки в meta — тема и режим оценки вина.

// --- тема: 'system' | 'light' | 'dark' ---------------------------------------
// Tailwind переведён на класс .dark на <html> (см. @custom-variant в index.css);
// в режиме 'system' класс следует за prefers-color-scheme.

export const THEME_LABELS = { system: 'Системная', light: 'Светлая', dark: 'Тёмная' };

const mq = window.matchMedia('(prefers-color-scheme: dark)');

export async function getThemeSetting() {
  return (await db.meta.get('theme'))?.value ?? 'system';
}

export function isDark(setting) {
  return setting === 'dark' || (setting === 'system' && mq.matches);
}

// Вешает/снимает .dark и оповещает подписчиков (карта слушает 'themechange')
export function applyTheme(setting) {
  const dark = isDark(setting);
  document.documentElement.classList.toggle('dark', dark);
  window.dispatchEvent(new CustomEvent('themechange', { detail: { dark } }));
}

export async function setThemeSetting(value) {
  await db.meta.put({ key: 'theme', value });
  applyTheme(value);
}

// При старте: применить сохранённую тему и следить за ОС в режиме 'system'
export async function initTheme() {
  applyTheme(await getThemeSetting());
  mq.addEventListener('change', async () => applyTheme(await getThemeSetting()));
}

// --- оценка вина: 'last' | 'best' | 'avg' ------------------------------------

export const SCORE_MODE_LABELS = {
  last: 'Последняя дегустация',
  best: 'Лучшая',
  avg: 'Средняя',
};

export async function getScoreMode() {
  return (await db.meta.get('scoreMode'))?.value ?? 'last';
}

export async function setScoreMode(value) {
  await db.meta.put({ key: 'scoreMode', value });
}

// Единая точка расчёта «моей оценки» вина: бейджи карточек, детальная
// карточка, точки карты. null — вино не пробовано.
export async function wineScore(wine, mode) {
  const tastings = await db.tastings.where('wineId').equals(wine.id).sortBy('date');
  if (!tastings.length) return null;
  const scores = tastings.map((t) => t.totalScore ?? 0);
  if (mode === 'best') return Math.max(...scores);
  if (mode === 'avg') return Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10;
  return scores.at(-1);
}
