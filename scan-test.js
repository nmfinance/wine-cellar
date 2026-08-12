// P0: эксперимент — насколько хорошо GigaChat распознаёт винные этикетки.
// Запуск: npm run test-labels (нужен NODE_EXTRA_CA_CERTS, см. package.json)
import 'dotenv/config';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import sharp from 'sharp';

const PHOTOS_DIR = 'C:\\Users\\Администратор\\Desktop\\Мой погреб\\Тест';
const OAUTH_URL = 'https://ngw.devices.sberbank.ru:9443/api/v2/oauth';
const API_BASE = 'https://gigachat.devices.sberbank.ru/api/v1';
const RESULTS_DIR = 'results';
const PAUSE_MS = 2000;

const modelOverride = process.argv
  .find((a) => a.startsWith('--model='))
  ?.slice('--model='.length);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function die(msg) {
  console.error(`\n✗ ${msg}`);
  process.exit(1);
}

function hintOnFetchError(err) {
  const code = err?.cause?.code ?? err?.code ?? '';
  if (/CERT|UNABLE_TO_VERIFY|SELF_SIGNED|ISSUER/i.test(code)) {
    die(
      `Ошибка TLS-сертификата (${code}). Запускай через "npm run test-labels" — ` +
        `он подставляет NODE_EXTRA_CA_CERTS=./certs/russiantrustedca.pem.`
    );
  }
  throw err;
}

// --- prompts.md ------------------------------------------------------------

async function loadPromptS1() {
  let md;
  try {
    md = await readFile('prompts.md', 'utf8');
  } catch {
    die('Не найден prompts.md рядом со скриптом. Положи файл и запусти снова.');
  }
  const s1Section = md.split(/^## /m).find((s) => s.startsWith('S1'));
  const block = s1Section?.match(/```\r?\n([\s\S]*?)```/);
  if (!block) die('В prompts.md не нашёл блок кода в разделе «S1 · Скан этикетки».');

  const antiIdx = md.indexOf('Блок анти-markdown');
  const antiLines = antiIdx >= 0
    ? md.slice(antiIdx).split(/\r?\n/).filter((l) => l.startsWith('>'))
        .map((l) => l.replace(/^>\s?/, ''))
    : [];
  if (!antiLines.length) die('В prompts.md не нашёл анти-markdown блок в «Общих правилах вызова».');

  return `${block[1].trim()}\n\n${antiLines.join('\n')}`;
}

// --- HTTP с одной повторной попыткой на 429/5xx ------------------------------

async function apiFetch(url, options, label) {
  for (let attempt = 1; ; attempt++) {
    let res;
    try {
      res = await fetch(url, options);
    } catch (err) {
      hintOnFetchError(err);
    }
    if (res.ok) return res;
    const body = await res.text().catch(() => '');
    if ((res.status === 429 || res.status >= 500) && attempt === 1) {
      console.log(`  ⚠ ${label}: HTTP ${res.status}, повтор через 5 с...`);
      await sleep(5000);
      continue;
    }
    throw new Error(`${label}: HTTP ${res.status} ${body.slice(0, 300)}`);
  }
}

// --- GigaChat ----------------------------------------------------------------

async function getAccessToken() {
  const key = process.env.GIGACHAT_AUTH_KEY;
  if (!key) die('Нет GIGACHAT_AUTH_KEY — проверь файл .env.');
  let res;
  try {
    res = await fetch(OAUTH_URL, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${key}`,
        RqUID: randomUUID(),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'scope=GIGACHAT_API_PERS',
    });
  } catch (err) {
    hintOnFetchError(err);
  }
  if (res.status === 401) die('OAuth вернул 401 — проверь GIGACHAT_AUTH_KEY в .env.');
  if (!res.ok) die(`OAuth не удался: HTTP ${res.status} ${await res.text().catch(() => '')}`);
  return (await res.json()).access_token;
}

async function pickModel(token) {
  const res = await apiFetch(
    `${API_BASE}/models`,
    { headers: { Authorization: `Bearer ${token}` } },
    'GET /models'
  );
  const models = (await res.json()).data ?? [];
  console.log('\nДоступные модели:');
  for (const m of models) console.log(`  - ${m.id}`);

  if (modelOverride) {
    console.log(`\nМодель задана флагом --model: ${modelOverride}`);
    return modelOverride;
  }
  const rank = (id) =>
    /ultra/i.test(id) ? 3 : /max/i.test(id) ? 2 : /pro/i.test(id) ? 1 : 0;
  const best = models.map((m) => m.id).sort((a, b) => rank(b) - rank(a))[0];
  if (!best) die('Список моделей пуст.');
  console.log(`\nВыбрана модель: ${best} (переопределить: --model=<id>)`);
  return best;
}

async function uploadPhoto(token, filePath) {
  const compressed = await sharp(filePath)
    .rotate()
    .resize({ width: 1280, height: 1280, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 80 })
    .toBuffer();

  const form = new FormData();
  form.append('file', new Blob([compressed], { type: 'image/jpeg' }), 'label.jpg');
  form.append('purpose', 'general');

  const res = await apiFetch(
    `${API_BASE}/files`,
    { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form },
    'POST /files'
  );
  return (await res.json()).id;
}

async function askModel(token, model, prompt, fileId) {
  const res = await apiFetch(
    `${API_BASE}/chat/completions`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        messages: [{ role: 'user', content: prompt, attachments: [fileId] }],
      }),
    },
    'POST /chat/completions'
  );
  return (await res.json()).choices?.[0]?.message?.content ?? '';
}

// Страховочный парсер: срезать ```json / ```, взять от первой { до последней }
function safeParseJson(text) {
  const cleaned = text.replace(/```json/gi, '').replace(/```/g, '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
}

// --- report helpers ----------------------------------------------------------

const cell = (v) =>
  String(v ?? '—').replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ').slice(0, 120);

function grapesCell(grapes) {
  if (!Array.isArray(grapes) || !grapes.length) return null;
  return grapes
    .map((g) => (g?.percent != null ? `${g.name} ${g.percent}%` : g?.name))
    .filter(Boolean)
    .join('; ');
}

function lowConfidenceFields(parsed) {
  const conf = parsed?.confidence;
  if (!conf || typeof conf !== 'object') return null;
  const low = Object.keys(conf).filter((k) => conf[k] === 'low');
  return low.length ? low.join(', ') : 'нет';
}

// --- main --------------------------------------------------------------------

const prompt = await loadPromptS1();
console.log('Промпт S1 загружен из prompts.md.');

const token = await getAccessToken();
console.log('Токен получен.');
const model = await pickModel(token);

const photos = (await readdir(PHOTOS_DIR))
  .filter((f) => /\.(jpe?g|png)$/i.test(f))
  .sort();
if (!photos.length) die(`В папке ${PHOTOS_DIR} нет jpg/png.`);

await mkdir(path.join(RESULTS_DIR, 'raw'), { recursive: true });

const rows = [];
let retryCount = 0;
let failCount = 0;

for (const [i, photo] of photos.entries()) {
  console.log(`\n[${i + 1}/${photos.length}] ${photo}`);
  try {
    const fileId = await uploadPhoto(token, path.join(PHOTOS_DIR, photo));
    console.log(`  загружено, file_id=${fileId}`);

    let raw = await askModel(token, model, prompt, fileId);
    let parsed = safeParseJson(raw);
    let jsonRetry = false;
    if (!parsed) {
      jsonRetry = true;
      retryCount++;
      console.log('  ⚠ невалидный JSON, повторяю запрос...');
      raw = await askModel(
        token,
        model,
        `${prompt}\n\nТы вернул невалидный JSON. Верни тот же ответ строго в JSON.`,
        fileId
      );
      parsed = safeParseJson(raw);
    }
    if (!parsed) throw new Error(`JSON не распарсился и после повтора. Ответ: ${raw.slice(0, 200)}`);

    await writeFile(
      path.join(RESULTS_DIR, 'raw', `${path.parse(photo).name}.json`),
      JSON.stringify(parsed, null, 2),
      'utf8'
    );

    const year = parsed.nv_flag === true ? 'NV' : parsed.year;
    const rating =
      parsed.vivino_rating != null
        ? `${parsed.vivino_rating} (${parsed.vivino_source ?? '?'})`
        : null;
    rows.push([
      photo, parsed.status, parsed.name, parsed.winery, year,
      grapesCell(parsed.grapes), parsed.appellation, rating,
      lowConfidenceFields(parsed), jsonRetry ? 'да' : 'нет',
    ]);
    console.log(
      `  ✓ status=${parsed.status} | ${parsed.name ?? '—'} / ${parsed.winery ?? '—'} / ${year ?? '—'}` +
        (rating ? ` | vivino ${rating}` : '')
    );
  } catch (err) {
    failCount++;
    console.error(`  ✗ ошибка: ${err.message}`);
    rows.push([photo, 'error', ...Array(7).fill(null), '—']);
  }
  if (i < photos.length - 1) await sleep(PAUSE_MS);
}

// --- report.md ---------------------------------------------------------------

const header =
  '| фото | status | name | winery | year | grapes | appellation | vivino_rating (source) | поля с confidence=low | json_retry |';
const report = [
  '# P0 · Отчёт: GigaChat читает этикетки',
  '',
  `Модель: **${model}** · Фото: ${photos.length} · Дата: ${new Date().toISOString().slice(0, 10)}`,
  '',
  header,
  `|${' --- |'.repeat(10)}`,
  ...rows.map((r) => `| ${r.map(cell).join(' | ')} |`),
  '',
  `Ошибок прогона: ${failCount} · json_retry: ${retryCount}/${photos.length} (${Math.round((retryCount / photos.length) * 100)}%)`,
  '',
  '## Сверь вручную',
  '',
  '- [ ] ≥8/10: name+winery+year верны (сверяю с бутылками)',
  '- [ ] ≥6/10: vivino_rating в пределах ±0.3 от реального Vivino',
  '- [ ] нет выдуманных рейтингов у неизвестных вин',
  '- [ ] json_retry < 20%',
  '',
].join('\n');

const reportPath = path.join(RESULTS_DIR, 'report.md');
await writeFile(reportPath, report, 'utf8');

console.log(`\nГотово: ${photos.length - failCount}/${photos.length} успешно, json_retry ${retryCount}, ошибок ${failCount}.`);
console.log(`Отчёт: ${path.resolve(reportPath)}`);
