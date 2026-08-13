// Описание фильтров каталога: структура состояния, статические секции, чипы.

export const emptyFilters = () => ({
  colors: [],
  sweetness: [],
  special: [],
  countries: [],
  grapes: [],
  tasted: [],
});

// Статические секции (динамические — Страна и Сорт — собираются из базы)
export const STATIC_OPTIONS = {
  colors: [
    ['red', 'Красное'],
    ['white', 'Белое'],
    ['rose', 'Розовое'],
    ['orange', 'Оранжевое'],
  ],
  sweetness: [
    ['dry', 'Сухое'],
    ['semidry', 'Полусухое'],
    ['semisweet', 'Полусладкое'],
    ['sweet', 'Сладкое'],
  ],
  special: [
    ['sparkling', 'Игристое'],
    ['fortified', 'Креплёное'],
  ],
  tasted: [
    ['none', 'Не пробовал'],
    ['tasted', 'Пробовал'],
    ['high', 'Оценка 8+'],
  ],
};

const STATIC_LABELS = Object.fromEntries(
  Object.entries(STATIC_OPTIONS).map(([section, opts]) => [section, Object.fromEntries(opts)])
);

export function labelFor(section, value) {
  return STATIC_LABELS[section]?.[value] ?? value; // страны и сорта — сами себе подпись
}

export const hasActive = (filters) => Object.values(filters).some((arr) => arr.length > 0);

// Плоский список активных фильтров для ряда чипов
export function chipsOf(filters) {
  return Object.entries(filters).flatMap(([section, values]) =>
    values.map((value) => ({ section, value, label: labelFor(section, value) }))
  );
}

export function toggleFilter(filters, section, value) {
  const arr = filters[section];
  return {
    ...filters,
    [section]: arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value],
  };
}

export function pluralWines(n) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return 'вино';
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'вина';
  return 'вин';
}
