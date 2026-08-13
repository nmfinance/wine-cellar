// Нормализация имён: дедупликация виноделен, скоринг матчей Vivino, поиск.
export function normalizeName(str) {
  return String(str ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const RU_TO_LAT = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z',
  и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
  с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh',
  щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};

export function transliterate(str) {
  return String(str ?? '')
    .split('')
    .map((ch) => RU_TO_LAT[ch] ?? ch)
    .join('');
}

// Поиск: «бар» находит и «Barolo» (транслитерация), и «Барбареско»
export function matchesQuery(fields, query) {
  const q = normalizeName(query);
  if (!q) return true;
  const haystack = fields.filter(Boolean).map(normalizeName).join(' ');
  const variants = [...new Set([q, transliterate(q)])];
  return variants.some((v) => haystack.includes(v));
}
