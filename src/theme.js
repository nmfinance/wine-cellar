// Дизайн-токены проекта. Акцент: винный #722F37 (тёмная тема #C4626E) —
// продублирован в палитре @theme в src/index.css (wine-600 / wine-400).
// Радиусы: карточки 12px (rounded-xl), кнопки/поля 8px (rounded-lg), бейджи 999px.

// Плейсхолдеры фото-зоны карточки по цвету вина
export const PLACEHOLDER_BY_COLOR = {
  red: { bg: '#722F37', icon: '#F5C4B3' },
  white: { bg: '#E8D9A0', icon: '#854F0B' },
  rose: { bg: '#8A3A4D', icon: '#F4C0D1' },
  orange: { bg: '#B5651D', icon: '#F5D9B3' },
};

// Бейдж моей оценки: ≥8 зелёный, 5–7.9 янтарный, <5 красный
export function scoreBadgeClasses(score) {
  if (score >= 8) return 'bg-[#27500A] text-[#EAF3DE] dark:bg-[#A3D977] dark:text-[#1A2E08]';
  if (score >= 5) return 'bg-[#854F0B] text-[#FAEEDA] dark:bg-[#E8B44C] dark:text-[#2E1E05]';
  return 'bg-[#A32D2D] text-[#FCEBEB] dark:bg-[#E88C8C] dark:text-[#2E0A0A]';
}

export function formatPrice(value, currency = 'RUB') {
  if (value == null) return null;
  const sign = currency === 'RUB' ? '₽' : currency;
  return `${Math.round(value).toLocaleString('ru-RU')} ${sign}`;
}
