// P0.5: эксперимент — живые рейтинги Vivino для вин, распознанных в P0.
// Запуск: npm run test-vivino
//
// Выводы зондирования (2026-08-12):
// - /api/explore/explore требует хотя бы один фильтр (иначе 400), но параметр q
//   ИГНОРИРУЕТ — возвращает глобальный топ. Оставлен как метод 1 с проверкой
//   релевантности: если выдача не похожа на запрос, падаем на метод 2.
// - /search/wines?q= рендерит SSR-компонент ExplorePage; результаты вшиты в
//   HTML-атрибут data-ssr-props (HTML-экранированный JSON, ключ initialExploreResults).
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const RAW_DIR = path.join('results', 'raw');
const REPORT_PATH = path.join('results', 'vivino-report.md');
const PAUSE_MS = 1500;
const TIMEOUT_MS = 10_000;
const MATCH_THRESHOLD = 0.5; // доля токенов запроса, найденных в кандидате

const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

const requestTimes = [];
let blockedCount = 0;

// fetch с таймаутом и фиксацией времени; 403/429 = «заблокирован», без ретраев
async function timedFetch(url, headers) {
  const started = Date.now();
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
    requestTimes.push(Date.now() - started);
    if (res.status === 403 || res.status === 429) {
      blockedCount++;
      return { blocked: true, status: res.status };
    }
    if (!res.ok) return { error: `HTTP ${res.status}` };
    return { res };
  } catch (err) {
    requestTimes.push(Date.now() - started);
    return { error: err.name === 'TimeoutError' ? 'таймаут 10с' : err.message };
  }
}

function mapVintageMatch(m) {
  const v = m?.vintage;
  if (!v) return null;
  const stats = v.statistics ?? {};
  return {
    name: v.wine?.name ?? null,
    winery: v.wine?.winery?.name ?? null,
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

// --- Метод 1: внутренний explore API --------------------------------------

async function searchExploreApi(query) {
  const url = new URL('https://www.vivino.com/api/explore/explore');
  url.searchParams.set('q', query);
  url.searchParams.set('per_page', '5');
  url.searchParams.set('min_rating', '1'); // без хотя бы одного фильтра API отвечает 400
  const r = await timedFetch(url, { ...BROWSER_HEADERS, Accept: 'application/json' });
  if (!r.res) return r;
  let json;
  try {
    json = await r.res.json();
  } catch {
    return { error: 'не JSON' };
  }
  const matches = json?.explore_vintage?.matches;
  if (!Array.isArray(matches)) return { error: 'нет matches в ответе' };
  return { candidates: matches.map(mapVintageMatch).filter(Boolean) };
}

// --- Метод 2: HTML страницы поиска, JSON в data-ssr-props -------------------

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

async function searchHtmlPage(query) {
  const url = `https://www.vivino.com/search/wines?q=${encodeURIComponent(query)}`;
  const r = await timedFetch(url, BROWSER_HEADERS);
  if (!r.res) return r;
  const decoded = unescapeHtml(await r.res.text());
  const key = '"initialExploreResults":';
  const idx = decoded.indexOf(key);
  if (idx === -1) return { error: 'initialExploreResults не найден в HTML' };
  const objText = extractJsonObject(decoded, decoded.indexOf('{', idx + key.length));
  let data;
  try {
    data = JSON.parse(objText);
  } catch {
    return { error: 'вшитый JSON не распарсился' };
  }
  if (!Array.isArray(data.matches)) return { error: 'нет matches во вшитом JSON' };
  return { candidates: data.matches.map(mapVintageMatch).filter(Boolean) };
}

// --- Правило винтажей -------------------------------------------------------

function pickRating(candidates, query, wantYear) {
  const scored = candidates
    .map((c) => ({ ...c, score: matchScore(query, `${c.winery ?? ''} ${c.name ?? ''}`) }))
    .sort((a, b) => b.score - a.score);
  const best = scored[0];
  if (!best || best.score < MATCH_THRESHOLD) return { found: false, top1: scored[0] ?? null };

  // все винтажи того же вина из выдачи
  const sameWine = scored.filter(
    (c) => norm(`${c.winery} ${c.name}`) === norm(`${best.winery} ${best.name}`)
  );
  if (wantYear != null) {
    const exact = sameWine.find((c) => c.year === wantYear && c.vintageRating);
    if (exact) {
      return exact.isWineRating
        ? { found: true, match: exact, rating: exact.wineRating, count: exact.wineCount, source: 'all_vintages' }
        : { found: true, match: exact, rating: exact.vintageRating, count: exact.vintageCount, source: 'vintage' };
    }
    const nearby = sameWine
      .filter((c) => c.year != null && Math.abs(c.year - wantYear) <= 2 && c.vintageRating && !c.isWineRating)
      .sort((a, b) => Math.abs(a.year - wantYear) - Math.abs(b.year - wantYear))[0];
    if (nearby) {
      return { found: true, match: nearby, rating: nearby.vintageRating, count: nearby.vintageCount, source: 'nearby_vintage' };
    }
  }
  const rating = best.wineRating ?? best.vintageRating;
  return {
    found: true,
    match: best,
    rating,
    count: best.wineCount ?? best.vintageCount,
    source: rating != null ? 'all_vintages' : null,
  };
}

// --- main --------------------------------------------------------------------

const files = (await readdir(RAW_DIR)).filter((f) => f.endsWith('.json')).sort();
if (!files.length) {
  console.error(`✗ Нет результатов P0 в ${RAW_DIR} — сначала npm run test-labels.`);
  process.exit(1);
}

const wines = [];
for (const f of files) {
  const data = JSON.parse(await readFile(path.join(RAW_DIR, f), 'utf8'));
  if (data.name) wines.push({ file: f, name: data.name, winery: data.winery, year: data.year ?? null });
  else console.log(`  (пропуск ${f}: name=null)`);
}

const rows = [];
const misses = [];
const methodUsed = { 1: 0, 2: 0 };

for (const [i, wine] of wines.entries()) {
  // запрос "<winery> <name>" без года, с дедупликацией повторных слов
  const seen = new Set();
  const query = norm(`${wine.winery ?? ''} ${wine.name}`)
    .split(' ')
    .filter((t) => !seen.has(t) && seen.add(t))
    .join(' ');
  console.log(`\n[${i + 1}/${wines.length}] ${wine.name} (${wine.year ?? 'NV'}) → "${query}"`);

  let result = null;
  let method = null;
  let status = 'ok';
  let anyBlocked = false;
  let lastError = null;

  const r1 = await searchExploreApi(query);
  anyBlocked ||= !!r1.blocked;
  lastError = r1.error ?? lastError;
  if (r1.candidates?.length) {
    const picked = pickRating(r1.candidates, query, wine.year);
    if (picked.found) {
      result = picked;
      method = 1;
    } else {
      console.log('  метод 1: выдача нерелевантна запросу (API игнорирует q), пробую метод 2');
    }
  } else {
    console.log(`  метод 1 не дал результата (${r1.blocked ? `блокировка ${r1.status}` : r1.error ?? 'пусто'}), пробую метод 2`);
  }

  if (!result) {
    await sleep(PAUSE_MS);
    const r2 = await searchHtmlPage(query);
    anyBlocked ||= !!r2.blocked;
    lastError = r2.error ?? lastError;
    if (r2.candidates?.length) {
      const picked = pickRating(r2.candidates, query, wine.year);
      method = 2;
      if (picked.found) result = picked;
      else {
        status = 'не найдено';
        if (picked.top1) misses.push({ wine, top1: picked.top1 });
      }
    } else {
      status = anyBlocked ? 'заблокирован' : `ошибка: ${lastError}`;
    }
  }

  if (result) {
    methodUsed[method]++;
    const m = result.match;
    rows.push({
      wine, method, status: 'ok',
      matchLabel: `${m.name}${m.winery ? ` — ${m.winery}` : ''}`,
      rating: result.rating, source: result.source, count: result.count, price: m.price,
    });
    console.log(`  ✓ ${m.name} — ${m.winery ?? '?'} | ${result.rating ?? '—'} (${result.source ?? '—'}), оценок: ${result.count ?? '—'}`);
  } else {
    if (method) methodUsed[method]++;
    rows.push({ wine, method, status, matchLabel: null, rating: null, source: null, count: null, price: null });
    console.log(`  ✗ ${status}`);
  }
  if (i < wines.length - 1) await sleep(PAUSE_MS);
}

// --- отчёт --------------------------------------------------------------------

const cell = (v) => String(v ?? '—').replace(/\|/g, '\\|').slice(0, 100);
const found = rows.filter((r) => r.rating != null).length;
const avgMs = requestTimes.length
  ? Math.round(requestTimes.reduce((a, b) => a + b, 0) / requestTimes.length)
  : 0;

const report = [
  '# P0.5 · Отчёт: живые рейтинги Vivino',
  '',
  `Вин из P0: ${wines.length} · Дата: ${new Date().toISOString().slice(0, 10)}`,
  '',
  '| вино (из P0) | год | найдено на Vivino | rating | source | ratings_count | price | метод | статус |',
  `|${' --- |'.repeat(9)}`,
  ...rows.map((r) =>
    `| ${[r.wine.name, r.wine.year ?? 'NV', r.matchLabel, r.rating, r.source, r.count, r.price, r.method, r.status]
      .map(cell).join(' | ')} |`
  ),
  '',
  '## Сводка',
  '',
  `- Найдено с рейтингом: **${found}/${wines.length}**`,
  `- Методом 1 (explore API): ${methodUsed[1]} · методом 2 (HTML страницы поиска): ${methodUsed[2]}`,
  `- Среднее время запроса: ${avgMs} мс (всего запросов: ${requestTimes.length})`,
  `- Блокировок 403/429: ${blockedCount}`,
  '',
  '> Примечание: explore API игнорирует текстовый запрос q (проверено зондированием),',
  '> поэтому рабочий метод — разбор JSON, вшитого в страницу /search/wines.',
  '',
  ...(misses.length
    ? [
        '## Промахи (топ-1 выдачи для анализа)',
        '',
        ...misses.map(
          (m) =>
            `- **${m.wine.name}** (${m.wine.year ?? 'NV'}) → топ-1: ${m.top1.name} — ${m.top1.winery ?? '?'} (score ${m.top1.score.toFixed(2)})`
        ),
        '',
      ]
    : []),
  '## Сверь вручную',
  '',
  '- [ ] ≥8/10 вин найдены и матч правильный (то самое вино, не однофамилец)',
  '- [ ] рейтинги совпадают с приложением Vivino (проверяю руками)',
  '- [ ] логика винтажей отработала осмысленно',
  '- [ ] ни одной блокировки 403/captcha',
  '',
  '> ⚠ Этот прогон шёл с домашнего IP. Перед переносом в прокси нужно повторить прогон',
  '> с IP Яндекс Cloud Functions — датацентровые IP сайты фильтруют чаще.',
  '',
].join('\n');

await writeFile(REPORT_PATH, report, 'utf8');
console.log(`\nГотово: найдено ${found}/${wines.length}, блокировок ${blockedCount}, среднее время ${avgMs} мс.`);
console.log(`Отчёт: ${path.resolve(REPORT_PATH)}`);
