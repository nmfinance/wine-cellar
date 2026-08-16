// Микро-прокси «Мой погреб»: единственный серверный компонент проекта.
// Яндекс Cloud Functions, HTTP-вызов.
// Роутинг: POST /ai (GigaChat), GET /vivino, GET /tiles/* (P21.3).
const { safeParseJson } = require('./parse.js');
const gigachat = require('./gigachat.js');
const { lookupVivino } = require('./vivino.js');
const { fetchTile } = require('./tiles.js');

// Прод на GitHub Pages + локальная разработка
const ALLOWED_ORIGINS = ['https://nmfinance.github.io', 'http://localhost:5173'];

const TEMPERATURE_BY_KIND = { s1: 0.2, s2: 0.5, s3: 0.7, s4: 0.3, s5: 0.3 };

const header = (event, name) => {
  const headers = event.headers ?? {};
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name);
  return key ? headers[key] : undefined;
};

function corsHeaders(event) {
  const origin = header(event, 'origin');
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-App-Key',
  };
}

function reply(event, statusCode, payload, err = null) {
  // подробности ошибки — только по явному X-Debug: 1 (и валидному APP_KEY)
  if (err && header(event, 'x-debug') === '1') payload = { ...payload, detail: err.detail ?? err.message };
  if (err) console.error('[proxy]', payload.error, err.detail ?? err.message);
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders(event) },
    body: JSON.stringify(payload),
  };
}

module.exports.handler = async (event) => {
  const method = event.httpMethod ?? 'GET';
  const pathname = (event.url ?? event.path ?? '/').split('?')[0];

  if (method === 'OPTIONS') return { statusCode: 204, headers: corsHeaders(event) };

  // /tiles/* — ДО проверки ключа: MapLibre не умеет свои заголовки без
  // transformRequest-возни, а GET + whitelist путей безопасны и без ключа.
  if (method === 'GET' && pathname.includes('/tiles/')) {
    return handleTiles(event, pathname);
  }

  // Лёгкий заслон от чужих: ключ виден в клиентском коде, это НЕ криптозащита —
  // просто отсекает случайных сканеров, чтобы не жгли токены GigaChat.
  if (header(event, 'x-app-key') !== process.env.APP_KEY) {
    return reply(event, 403, { ok: false, error: 'forbidden' });
  }

  try {
    if (method === 'POST' && pathname.endsWith('/ai')) return await handleAi(event);
    if (method === 'GET' && pathname.endsWith('/vivino')) return await handleVivino(event);
    return reply(event, 404, { ok: false, error: 'not_found_route' });
  } catch (err) {
    return reply(event, 502, { ok: false, error: err.code ?? 'internal' }, err);
  }
};

async function handleAi(event) {
  let body;
  try {
    const raw = event.isBase64Encoded
      ? Buffer.from(event.body, 'base64').toString('utf8')
      : event.body;
    body = JSON.parse(raw);
  } catch {
    return reply(event, 400, { ok: false, error: 'bad_request' });
  }
  const { kind, prompt, images } = body ?? {};
  if (!prompt || !TEMPERATURE_BY_KIND[kind]) {
    return reply(event, 400, { ok: false, error: 'bad_request' });
  }

  let token;
  try {
    token = await gigachat.getToken();
  } catch (err) {
    return reply(event, 502, { ok: false, error: err.code ?? 'gigachat_auth' }, err);
  }

  const attachments = [];
  try {
    for (const image of images ?? []) attachments.push(await gigachat.uploadImage(token, image));
  } catch (err) {
    return reply(event, 502, { ok: false, error: err.code ?? 'gigachat_error' }, err);
  }

  const model = process.env.GIGACHAT_MODEL || 'GigaChat-2-Max';
  const temperature = TEMPERATURE_BY_KIND[kind];

  let text;
  try {
    text = await gigachat.chat(token, { model, temperature, prompt, attachments });
  } catch (err) {
    return reply(event, 502, { ok: false, error: err.code ?? 'gigachat_error' }, err);
  }

  let parsed = safeParseJson(text);
  if (!parsed) {
    // один повтор с требованием валидного JSON (страховка из prompts.md)
    try {
      text = await gigachat.chat(token, {
        model,
        temperature,
        prompt: `${prompt}\n\nТы вернул невалидный JSON. Верни тот же ответ строго в JSON.`,
        attachments,
      });
    } catch (err) {
      return reply(event, 502, { ok: false, error: err.code ?? 'gigachat_error' }, err);
    }
    parsed = safeParseJson(text);
  }
  if (!parsed) return reply(event, 502, { ok: false, error: 'bad_json' });
  return reply(event, 200, { ok: true, data: parsed });
}

// GET /tiles/{путь} → https://tiles.openfreemap.org/{путь}, тело как есть.
// Cache-Control сутки: браузер кэширует тайлы сам, повторные сессии
// в функцию не ходят.
async function handleTiles(event, pathname) {
  // шлюз кладёт greedy-параметр в event.params.path; запасной путь — из URL
  const path =
    event.params?.path ?? pathname.slice(pathname.indexOf('/tiles/') + '/tiles/'.length);
  if (!path) return reply(event, 400, { ok: false, error: 'bad_request' });
  try {
    const tile = await fetchTile(path);
    return {
      statusCode: tile.status,
      headers: {
        'Content-Type': tile.contentType,
        'Cache-Control': 'public, max-age=86400',
        ...corsHeaders(event),
      },
      body: tile.body.toString('base64'),
      isBase64Encoded: true,
    };
  } catch (err) {
    return reply(event, 502, { ok: false, error: 'tiles_upstream' }, err);
  }
}

async function handleVivino(event) {
  const params = event.queryStringParameters ?? {};
  const q = (params.q ?? '').trim();
  if (!q) return reply(event, 400, { ok: false, error: 'bad_request' });
  const year = params.year ? Number(params.year) : null;
  const result = await lookupVivino(q, Number.isNaN(year) ? null : year);
  return reply(event, 200, result);
}
