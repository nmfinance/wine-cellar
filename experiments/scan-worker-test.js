// P9.5: решающий тест — те же 10 этикеток через Cloudflare Worker (Gemini),
// сравнение распознавания с GigaChat (results/raw из P0).
// Запуск: node scan-worker-test.js --url=https://pogreb-ai.<sub>.workers.dev --key=<APP_KEY>
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const WORKER_URL = (arg('url') ?? process.env.WORKER_URL ?? '').replace(/\/$/, '');
const APP_KEY = arg('key') ?? process.env.APP_KEY ?? '';
// --direct + --gemini-key=: мимо воркера, сразу в Gemini API (когда исходящие
// IP Cloudflare затроттлены Google — качество модели меряем напрямую)
const DIRECT = process.argv.includes('--direct');
const GEMINI_KEY = arg('gemini-key') ?? process.env.GEMINI_API_KEY ?? '';
const GEMINI_MODEL = arg('model') ?? 'gemini-flash-latest';
if (DIRECT ? !GEMINI_KEY : !WORKER_URL || !APP_KEY) {
  console.error('✗ Нужны --url= и --key= (или --direct и --gemini-key=)');
  process.exit(1);
}

const PHOTOS_DIR = 'C:\\Users\\Администратор\\Desktop\\Мой погреб\\Тест';
const RAW_DIR = path.join('results', 'raw');
const OUT = path.join('results', 'scan-worker-report.md');
let pauseMs = 7000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- промпт S1 из prompts.md (как в scan-test.js) ----------------------------
async function loadPromptS1() {
  const md = await readFile('../prompts.md', 'utf8');
  const s1Section = md.split(/^## /m).find((s) => s.startsWith('S1'));
  const block = s1Section?.match(/```\r?\n([\s\S]*?)```/);
  if (!block) throw new Error('Не нашёл блок S1 в prompts.md');
  const antiIdx = md.indexOf('Блок анти-markdown');
  const antiLines = md
    .slice(antiIdx)
    .split(/\r?\n/)
    .filter((l) => l.startsWith('>'))
    .map((l) => l.replace(/^>\s?/, ''));
  return `${block[1].trim()}\n\n${antiLines.join('\n')}`;
}

const cell = (v) => String(v ?? '—').replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ').slice(0, 90);

const prompt = await loadPromptS1();
console.log('Промпт S1 загружен.');

const photos = (await readdir(PHOTOS_DIR)).filter((f) => /\.(jpe?g|png)$/i.test(f)).sort();
await mkdir(path.join(RAW_DIR, '..', 'raw-worker'), { recursive: true });

const rows = [];
const times = [];
let ok = 0;
let jsonErrors = 0;
let got429 = false;

for (const [i, photo] of photos.entries()) {
  console.log(`\n[${i + 1}/${photos.length}] ${photo}`);
  const jpeg = await sharp(path.join(PHOTOS_DIR, photo))
    .rotate()
    .resize({ width: 1280, height: 1280, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 80 })
    .toBuffer();

  let parsed = null;
  let status = 'ok';
  for (let attempt = 0; attempt < 2; attempt++) {
    const started = Date.now();
    let json;
    try {
      if (DIRECT) {
        // тот же payload, что собирает воркер
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_KEY}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [
                {
                  parts: [
                    { text: prompt },
                    { inline_data: { mime_type: 'image/jpeg', data: jpeg.toString('base64') } },
                  ],
                },
              ],
              generationConfig: { temperature: 0.2, responseMimeType: 'application/json' },
            }),
            signal: AbortSignal.timeout(90_000),
          }
        );
        if (res.status === 429) json = { ok: false, error: 'rate_limited' };
        else if (!res.ok) json = { ok: false, error: `gemini_error ${res.status}` };
        else {
          const g = await res.json();
          const text = (g.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('');
          try {
            json = { ok: true, data: JSON.parse(text.replace(/```json/gi, '').replace(/```/g, '')) };
          } catch {
            json = { ok: false, error: 'bad_json' };
          }
        }
      } else {
        const res = await fetch(`${WORKER_URL}/ai`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-App-Key': APP_KEY },
          body: JSON.stringify({ kind: 's1', prompt, images: [jpeg.toString('base64')] }),
          signal: AbortSignal.timeout(90_000),
        });
        json = await res.json();
      }
    } catch (err) {
      status = `ошибка: ${err.message}`;
      break;
    }
    times.push(Date.now() - started);
    if (json.ok) {
      parsed = json.data;
      break;
    }
    if (json.error === 'rate_limited' && attempt === 0) {
      got429 = true;
      pauseMs = 20_000;
      console.log('  ⚠ 429 — пауза увеличена до 20 с, повтор...');
      await sleep(pauseMs);
      continue;
    }
    status = json.error;
    if (json.error === 'bad_json') jsonErrors++;
    break;
  }

  let diff = '—';
  if (parsed) {
    ok++;
    await writeFile(
      path.join(RAW_DIR, '..', 'raw-worker', `${path.parse(photo).name}.json`),
      JSON.stringify(parsed, null, 2),
      'utf8'
    );
    // сравнение с GigaChat (P0)
    try {
      const old = JSON.parse(
        await readFile(path.join(RAW_DIR, `${path.parse(photo).name}.json`), 'utf8')
      );
      const diffs = [];
      for (const field of ['name', 'winery', 'year']) {
        const a = old[field] ?? null;
        const b = parsed[field] ?? null;
        if (String(a) !== String(b)) diffs.push(`${field}: ${a ?? '—'} → ${b ?? '—'}`);
      }
      diff = diffs.length ? diffs.join('; ') : 'совпало';
    } catch {
      diff = 'нет данных P0';
    }
    const lows = parsed.confidence
      ? Object.keys(parsed.confidence).filter((k) => parsed.confidence[k] === 'low')
      : [];
    rows.push({
      photo,
      status: parsed.status,
      name: parsed.name,
      winery: parsed.winery,
      year: parsed.nvFlag || parsed.nv_flag ? 'NV' : parsed.year,
      grapes: (parsed.grapes ?? [])
        .map((g) => (g.percent != null ? `${g.name} ${g.percent}%` : g.name))
        .join('; '),
      appellation: parsed.appellation,
      lows: lows.length ? lows.join(', ') : 'нет',
      diff,
    });
    console.log(`  ✓ ${parsed.name ?? '—'} / ${parsed.winery ?? '—'} / ${parsed.year ?? '—'} | ${diff}`);
  } else {
    rows.push({ photo, status, name: null, winery: null, year: null, grapes: null, appellation: null, lows: null, diff: '—' });
    console.log(`  ✗ ${status}`);
  }

  if (i < photos.length - 1) await sleep(pauseMs);
}

const avgMs = times.length ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : 0;
const report = [
  '# P9.5 · Отчёт: скан этикеток через Cloudflare Worker (Gemini)',
  '',
  `Транспорт: ${DIRECT ? 'напрямую в Gemini API (--direct)' : `воркер ${WORKER_URL}`} · Модель: ${GEMINI_MODEL} · Дата: ${new Date().toISOString().slice(0, 10)}`,
  '',
  '| фото | status | name | winery | year | grapes | appellation | confidence low | отличия от GigaChat |',
  `|${' --- |'.repeat(9)}`,
  ...rows.map((r) =>
    `| ${[r.photo, r.status, r.name, r.winery, r.year, r.grapes, r.appellation, r.lows, r.diff].map(cell).join(' | ')} |`
  ),
  '',
  '## Сводка',
  '',
  `- Распознано: **${ok}/${photos.length}**`,
  `- JSON-ошибок: ${jsonErrors}`,
  `- Среднее время ответа: ${avgMs} мс`,
  got429
    ? '- ⚠ Ловили 429 — пауза была увеличена до 20 с'
    : '- Блокировок по лимиту (429) не было (пауза 7 с)',
  '',
].join('\n');

await writeFile(OUT, report, 'utf8');
console.log(`\nГотово: ${ok}/${photos.length}, json-ошибок ${jsonErrors}, среднее ${avgMs} мс.`);
console.log(`Отчёт: ${path.resolve(OUT)}`);
