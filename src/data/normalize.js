// Нормализация имён: дедупликация виноделен, скоринг матчей Vivino, поиск.
// Пунктуация вырезается (P10.6: «&», кавычки и тире считались токенами
// и роняли скоринг матча до low на честных совпадениях).
export function normalizeName(str) {
  return String(str ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zа-яё0-9\s]/gi, ' ')
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

// Свёртка к общей форме: кириллица → латиница, затем схлопывание вариантов
// записи одного звука (Rioja / Риоха / Rioha → rioha).
function foldForSearch(str) {
  return transliterate(normalizeName(str))
    .replace(/kh/g, 'h')
    .replace(/j/g, 'h');
}

// Поиск: «бар» находит «Barolo», «риоха» — «Rioja»
export function matchesQuery(fields, query) {
  const q = normalizeName(query);
  if (!q) return true;
  const raw = fields.filter(Boolean).map(normalizeName).join(' ');
  if (raw.includes(q)) return true;
  return foldForSearch(raw).includes(foldForSearch(query));
}
