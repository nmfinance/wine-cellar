// Живые рейтинги Vivino. Портировано из experiments/vivino-test.js (P0.5):
// поиск /search/wines, JSON из SSR-пропсов, скобочный сканер, правило винтажей
// с учётом is_wine_rating. Логика проверена экспериментом — не переписывать.
const MATCH_THRESHOLD = 0.5; // доля токенов запроса, найденных в кандидате
const TIMEOUT_MS = 10_000;

const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en',
};

const norm = (s) =>
  String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9а-яё\s]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

// доля токенов запроса, присутствующих в "winery name" кандидата
function matchScore(query, candidate) {
  const qTokens = [...new Set(norm(query).split(' ').filter(Boolean))];
  if (!qTokens.length) return 0;
  const cTokens = new Set(norm(candidate).split(' ').filter(Boolean));
  return qTokens.filter((t) => cTokens.has(t)).length / qTokens.length;
}

const unescapeHtml = (s) =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

// вырезать сбалансированный JSON-объект, начиная с '{' на позиции start
function extractJsonObject(text, start) {
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === '\\') i++;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return text.slice(start, i + 1);
  }
  return null;
}

function mapVintageMatch(m) {
  const v = m?.vintage;
  if (!v) return null;
  const stats = v.statistics ?? {};
  return {
    name: v.wine?.name ?? null,
    winery: v.wine?.winery?.name ?? null,
    wineId: v.wine?.id ?? null,
    year: Number(v.year) || null,
    vintageRating: stats.ratings_average || null,
    vintageCount: stats.ratings_count ?? null,
    // is_wine_rating=true значит «рейтинга именно этого винтажа мало,
    // показан общий по вину» — не выдаём его за винтажный
    isWineRating: stats.is_wine_rating === true,
    wineRating: stats.wine_ratings_average || null,
    wineCount: stats.wine_ratings_count ?? null,
    price: m.price?.amount ?? null,
  };
}

// Правило винтажей: точный год → соседний (±2) → общий рейтинг вина.
// matchedYear — год выбранного винтажа, null для all_vintages.
function pickRating(candidates, query, wantYear) {
  const scored = candidates
    .map((c) => ({ ...c, score: matchScore(query, `${c.winery ?? ''} ${c.name ?? ''}`) }))
    .sort((a, b) => b.score - a.score);
  const best = scored[0];
  if (!best || best.score < MATCH_THRESHOLD) return { found: false };

  const sameWine = scored.filter(
    (c) => norm(`${c.winery} ${c.name}`) === norm(`${best.winery} ${best.name}`)
  );
  if (wantYear != null) {
    const exact = sameWine.find((c) => c.year === wantYear && c.vintageRating);
    if (exact) {
      return exact.isWineRating
        ? { found: true, match: exact, rating: exact.wineRating, count: exact.wineCount, source: 'all_vintages', matchedYear: null }
        : { found: true, match: exact, rating: exact.vintageRating, count: exact.vintageCount, source: 'vintage', matchedYear: exact.year };
    }
    const nearby = sameWine
      .filter((c) => c.year != null && Math.abs(c.year - wantYear) <= 2 && c.vintageRating && !c.isWineRating)
      .sort((a, b) => Math.abs(a.year - wantYear) - Math.abs(b.year - wantYear))[0];
    if (nearby) {
      return { found: true, match: nearby, rating: nearby.vintageRating, count: nearby.vintageCount, source: 'nearby_vintage', matchedYear: nearby.year };
    }
  }
  const rating = best.wineRating ?? best.vintageRating;
  return { found: true, match: best, rating, count: best.wineCount ?? best.vintageCount, source: 'all_vintages', matchedYear: null };
}

async function lookupVivino(query, wantYear = null) {
  let res;
  try {
    res = await fetch(`https://www.vivino.com/search/wines?q=${encodeURIComponent(query)}`, {
      headers: BROWSER_HEADERS,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return { ok: false, error: 'vivino_error' };
  }
  if (res.status === 403 || res.status === 429) return { ok: false, error: 'blocked' };
  if (/captcha|challenge/i.test(res.url ?? '')) return { ok: false, error: 'blocked' };
  if (!res.ok) return { ok: false, error: 'vivino_error' };

  const decoded = unescapeHtml(await res.text());
  const key = '"initialExploreResults":';
  const idx = decoded.indexOf(key);
  if (idx === -1) return { ok: false, error: 'vivino_format_changed' };

  const objText = extractJsonObject(decoded, decoded.indexOf('{', idx + key.length));
  let data;
  try {
    data = JSON.parse(objText);
  } catch {
    return { ok: false, error: 'vivino_format_changed' };
  }
  if (!Array.isArray(data.matches)) return { ok: false, error: 'vivino_format_changed' };

  const candidates = data.matches.map(mapVintageMatch).filter(Boolean);
  const picked = pickRating(candidates, query, wantYear);
  if (!picked.found || picked.rating == null) return { ok: false, error: 'not_found' };

  const m = picked.match;
  return {
    ok: true,
    data: {
      rating: picked.rating,
      ratingsCount: picked.count ?? null,
      source: picked.source,
      matchedName: `${m.name}${m.winery ? ` — ${m.winery}` : ''}`,
      matchedYear: picked.matchedYear,
      price: m.price,
      priceCurrency: m.price != null ? (data.market?.currency?.code ?? null) : null,
      url: m.wineId ? `https://www.vivino.com/wines/${m.wineId}` : null,
    },
  };
}

module.exports = { lookupVivino };
