// Русские склонения: pluralize(2, 'бутылка', 'бутылки', 'бутылок') → 'бутылки'
export function pluralize(n, one, few, many) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}
