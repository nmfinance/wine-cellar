// AI-ветка «Моего погреба»: Cloudflare Worker → Gemini.
// Контракт /ai не изменился со времён GigaChat-прокси — клиенту всё равно,
// кто внутри. /vivino живёт отдельно, в Яндекс Облаке.
import { safeParseJson } from './parse.js';

const ALLOWED_ORIGINS = ['https://nmfinance.github.io', 'http://localhost:5173'];
const TEMPERATURE_BY_KIND = { s1: 0.2, s2: 0.5, s3: 0.7, s4: 0.3, s5: 0.3 };

function corsHeaders(request) {
  const origin = request.headers.get('Origin');
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-App-Key',
  };
}

const json = (request, status, payload) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders(request) },
  });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }
    if (request.method === 'GET' && url.pathname === '/health') {
      // ВРЕМЕННО: диагностика привязки секретов
      return json(request, 200, {
        ok: true,
        appKeyLen: env.APP_KEY?.length ?? 0,
        geminiKeyLen: env.GEMINI_API_KEY?.length ?? 0,
      });
    }

    // Лёгкий заслон от чужих: ключ виден в клиентском коде, это НЕ криптозащита —
    // просто отсекает случайных сканеров, чтобы не жгли квоту Gemini.
    if (request.headers.get('X-App-Key') !== env.APP_KEY) {
      return json(request, 403, { ok: false, error: 'forbidden' });
    }

    if (request.method === 'POST' && url.pathname === '/ai') return handleAi(request, env);
    return json(request, 404, { ok: false, error: 'not_found_route' });
  },
};

async function handleAi(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json(request, 400, { ok: false, error: 'bad_request' });
  }
  const { kind, prompt, images } = body ?? {};
  if (!prompt || !TEMPERATURE_BY_KIND[kind]) {
    return json(request, 400, { ok: false, error: 'bad_request' });
  }

  const model = env.GEMINI_MODEL || 'gemini-2.5-flash';
  const payload = {
    contents: [
      {
        parts: [
          { text: prompt },
          ...(images ?? []).map((b64) => ({
            inline_data: { mime_type: 'image/jpeg', data: b64 },
          })),
        ],
      },
    ],
    generationConfig: {
      temperature: TEMPERATURE_BY_KIND[kind],
      responseMimeType: 'application/json', // строгий JSON-режим Gemini
    },
  };

  // один ретрай на сетевые ошибки и 5xx
  let res = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }
      );
      if (res.status >= 500 && attempt === 0) continue;
      break;
    } catch {
      if (attempt === 0) continue;
      return json(request, 502, { ok: false, error: 'gemini_error' });
    }
  }
  if (!res) return json(request, 502, { ok: false, error: 'gemini_error' });
  if (res.status === 429) return json(request, 429, { ok: false, error: 'rate_limited' });
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 300);
    console.error('[worker] gemini', res.status, detail);
    const payload = { ok: false, error: 'gemini_error' };
    // подробности — только по явному X-Debug: 1 (и валидному APP_KEY)
    if (request.headers.get('X-Debug') === '1') payload.detail = `${res.status} ${detail}`;
    return json(request, 502, payload);
  }

  const data = await res.json();
  const candidate = data.candidates?.[0];
  if (candidate?.finishReason === 'SAFETY') return json(request, 200, { ok: false, error: 'safety' });

  const text = (candidate?.content?.parts ?? []).map((p) => p.text ?? '').join('');
  const parsed = safeParseJson(text);
  if (!parsed) return json(request, 502, { ok: false, error: 'bad_json' });
  return json(request, 200, { ok: true, data: parsed });
}
