// P10.6: проверка канонических URL Vivino + структура flavor/food в SSR.
// Запуск: node vivino-url-test.js  (использует развёрнутую Яндекс-функцию)
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const PROXY = 'https://d5dlupicqp46hpphst15.y5sm01em.apigw.yandexcloud.net';
const APP_KEY = 'c2fecae3-61f9-4627-b2b7-2643fe9d5ca5';
const RAW_DIR = path.join('results', 'raw');
const OUT = path.join('results', 'vivino-url-report.md');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
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

const files = (await readdir(RAW_DIR)).filter((f) => f.endsWith('.json')).sort();
const rows = [];

for (const [i, file] of files.entries()) {
  const d = JSON.parse(await readFile(path.join(RAW_DIR, file), 'utf8'));
  if (!d.name) continue;
  const seen = new Set();
  const query = norm(`${d.winery ?? ''} ${d.name}`)
    .split(' ')
    .filter((t) => !seen.has(t) && seen.add(t))
    .join(' ');
  console.log(`[${i + 1}/${files.length}] ${query}`);

  let row = { wine: d.name, url: null, status: '—', matched: null };
  try {
    const res = await fetch(
      `${PROXY}/vivino?q=${encodeURIComponent(query)}${d.year ? `&year=${d.year}` : ''}`,
      { headers: { 'X-App-Key': APP_KEY }, signal: AbortSignal.timeout(30_000) }
    );
    const json = await res.json();
    if (json.ok) {
      row.matched = json.data.matchedName;
      row.url = json.data.url;
    } else row.status = json.error;
  } catch (e) {
    row.status = `ошибка: ${e.message}`;
  }

  if (row.url) {
    await sleep(2000);
    try {
      const r = await fetch(row.url, {
        headers: BROWSER_HEADERS,
        signal: AbortSignal.timeout(15_000),
        redirect: 'follow',
      });
      row.status = `HTTP ${r.status}${r.url !== row.url ? ` → ${new URL(r.url).pathname.slice(0, 50)}` : ''}`;
    } catch (e) {
      row.status = `GET упал: ${e.message}`;
    }
  }
  rows.push(row);
  console.log(`  ${row.url ?? '—'} · ${row.status}`);
  await sleep(2000);
}

// структура flavor/food — один поиск, разбор SSR
console.log('\n--- структура flavor/food ---');
const unescapeHtml = (s) =>
  s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
function extractJsonObject(text, start) {
  let depth = 0, inString = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) { if (ch === '\\') i++; else if (ch === '"') inString = false; }
    else if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return text.slice(start, i + 1);
  }
  return null;
}
const sres = await fetch('https://www.vivino.com/search/wines?q=aldo%20conterno%20barolo', {
  headers: BROWSER_HEADERS, signal: AbortSignal.timeout(15_000),
});
const decoded = unescapeHtml(await sres.text());
const idx = decoded.indexOf('"initialExploreResults":');
const data = JSON.parse(extractJsonObject(decoded, decoded.indexOf('{', idx + 24)));
const wine = data.matches?.[0]?.vintage?.wine;
const flavorSample = (wine?.taste?.flavor ?? []).slice(0, 3).map((g) => ({
  group: g.group,
  count: g.stats?.count,
  keywords: (g.primary_keywords ?? []).slice(0, 3).map((k) => `${k.name}:${k.count}`),
}));
const foodSample = wine?.style?.food;
console.log('flavor:', JSON.stringify(flavorSample));
console.log('food:', JSON.stringify(foodSample)?.slice(0, 400));

const ok = rows.filter((r) => r.status.startsWith('HTTP 200')).length;
const report = [
  '# P10.6 · Отчёт: канонические URL Vivino + flavor/food',
  '',
  `Дата: ${new Date().toISOString().slice(0, 10)} · URL-формат: https://www.vivino.com/wines/{числовой id матча}`,
  '',
  '| вино | матч | url | GET |',
  `|${' --- |'.repeat(4)}`,
  ...rows.map((r) => `| ${r.wine} | ${r.matched ?? '—'} | ${r.url ?? 'null'} | ${r.status} |`),
  '',
  `Рабочих URL: **${ok}/${rows.filter((r) => r.url).length}** (вина без матча url не имеют).`,
  '',
  '## Структура flavor (по отзывам)',
  '',
  '```json',
  JSON.stringify(flavorSample, null, 2),
  '```',
  '',
  '## Структура food (гастропары стиля)',
  '',
  '```json',
  JSON.stringify(foodSample, null, 2)?.slice(0, 1500) ?? 'null',
  '```',
  '',
].join('\n');
await writeFile(OUT, report, 'utf8');
console.log(`\nРабочих URL: ${ok}. Отчёт: ${path.resolve(OUT)}`);
