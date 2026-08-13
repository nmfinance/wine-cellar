// Нормализация имён: дедупликация виноделен, скоринг матчей Vivino.
export function normalizeName(str) {
  return String(str ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
