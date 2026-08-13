// P9: облачный прогон Vivino — те же 10 вин через развёрнутый прокси,
// сравнение с локальным отчётом P0.5.
// Запуск: node vivino-cloud-test.js --url=https://... --key=<APP_KEY>
//         (или env PROXY_URL / APP_KEY)
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const PROXY_URL = (arg('url') ?? process.env.PROXY_URL ?? '').replace(/\/$/, '');
const APP_KEY = arg('key') ?? process.env.APP_KEY ?? '';
if (!PROXY_URL || !APP_KEY) {
  console.error('✗ Нужны --url= и --key= (или env PROXY_URL / APP_KEY)');
  process.exit(1);
}

const RAW_DIR = path.join('results', 'raw');
const LOCAL_REPORT = path.join('results', 'vivino-report.md');
const OUT = path.join('results', 'vivino-cloud-report.md');
const PAUSE_MS = 2000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const norm = (s) =>
  String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9а-яё\s]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

// локальный отчёт P0.5: | вино | год | найдено | rating | ...
async function readLocalRatings() {
  const md = await readFile(LOCAL_REPORT, 'utf8');
  const map = new Map();
  for (const line of md.split('\n')) {
    const cells = line.split('|').map((c) => c.trim());
    if (cells.length < 6 || cells[1] === 'вино (из P0)' || cells[1].startsWith('---')) continue;
    if (cells[1]) map.set(cells[1], cells[4] === '—' ? null : Number(cells[4]));
  }
  return map;
}

const files = (await readdir(RAW_DIR)).filter((f) => f.endsWith('.json')).sort();
const localRatings = await readLocalRatings();

const rows = [];
let matches = 0;
let blockedCount = 0;

for (const [i, file] of files.entries()) {
  const data = JSON.parse(await readFile(path.join(RAW_DIR, file), 'utf8'));
  if (!data.name) continue;

  const seen = new Set();
  const query = norm(`${data.winery ?? ''} ${data.name}`)
    .split(' ')
    .filter((t) => !seen.has(t) && seen.add(t))
    .join(' ');

  console.log(`[${i + 1}/${files.length}] ${data.name} → "${query}"`);
  let cloudRating = null;
  let status = 'ok';
  try {
    const url = `${PROXY_URL}/vivino?q=${encodeURIComponent(query)}${data.year ? `&year=${data.year}` : ''}`;
    const res = await fetch(url, {
      headers: { 'X-App-Key': APP_KEY },
      signal: AbortSignal.timeout(30_000),
    });
    const json = await res.json();
    if (json.ok) cloudRating = json.data.rating;
    else {
      status = json.error;
      if (json.error === 'blocked') blockedCount++;
    }
  } catch (err) {
    status = `ошибка: ${err.message}`;
  }

  const localRating = localRatings.get(data.name) ?? null;
  const same = localRating === cloudRating;
  if (same) matches++;
  rows.push({ name: data.name, localRating, cloudRating, same, status });
  console.log(`  локально ${localRating ?? '—'} · облако ${cloudRating ?? '—'} · ${same ? '✓' : '✗'} (${status})`);
  if (i < files.length - 1) await sleep(PAUSE_MS);
}

const report = [
  '# P9 · Отчёт: Vivino из облака (Яндекс Cloud Functions)',
  '',
  `Прокси: ${PROXY_URL} · Дата: ${new Date().toISOString().slice(0, 10)}`,
  '',
  '| вино | rating локально | rating из облака | совпадение | статус |',
  `|${' --- |'.repeat(5)}`,
  ...rows.map(
    (r) =>
      `| ${r.name} | ${r.localRating ?? '—'} | ${r.cloudRating ?? '—'} | ${r.same ? '✅' : '❌'} | ${r.status} |`
  ),
  '',
  `Совпадений: **${matches}/${rows.length}** · блокировок: ${blockedCount}`,
  '',
].join('\n');

await writeFile(OUT, report, 'utf8');
console.log(`\nСовпадений ${matches}/${rows.length}, блокировок ${blockedCount}.`);
console.log(`Отчёт: ${path.resolve(OUT)}`);
