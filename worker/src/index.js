// AI-ветка «Моего погреба»: Cloudflare Worker → Gemini (цепочка моделей).
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

const todayKey = () => `ai:${new Date().toISOString().slice(0, 10)}`;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }
    if (request.method === 'GET' && url.pathname === '/health') {
      const usedToday = Number((await env.POGREB_LIMITS.get(todayKey())) ?? 0);
      return json(request, 200, { ok: true, usedToday });
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

  // Жёсткий дневной стоп-кран — НАШ, не гуглов (бюджеты Google только
  // уведомляют). KV — eventual consistency: при параллельных запросах счётчик
  // может чуть занижать — это предохранитель, а не биллинг, точность не критична.
  const cap = Number(env.DAILY_HARD_CAP ?? 100);
  const used = Number((await env.POGREB_LIMITS.get(todayKey())) ?? 0);
  if (used >= cap) {
    console.log(`[ai] стоп-кран: ${used}/${cap} — отказ без обращения к Google`);
    return json(request, 200, { ok: false, error: 'daily_limit' });
  }
  await env.POGREB_LIMITS.put(todayKey(), String(used + 1), { expirationTtl: 172_800 });

  const models = (env.GEMINI_MODELS || 'gemini-3.5-flash')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

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

  // Цепочка: 429 (квота) → сразу следующая модель; 503 (перегруз) → один
  // ретрай через 2 с, затем следующая. Прочие ошибки не переключают.
  let sawOverload = false;
  for (const model of models) {
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
      } catch (err) {
        console.log(`[ai] ${model}: сетевая ошибка${attempt === 0 ? ', ретрай' : ''}`);
        if (attempt === 0) continue;
        return json(request, 502, { ok: false, error: 'gemini_error' });
      }
      if (res.status === 503 && attempt === 0) {
        console.log(`[ai] ${model}: 503, ретрай через 2 с`);
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }
      break;
    }

    if (res.status === 429) {
      console.log(`[ai] ${model}: 429 (квота) → следующая модель`);
      continue;
    }
    if (res.status === 503) {
      console.log(`[ai] ${model}: 503 после ретрая → следующая модель`);
      sawOverload = true;
      continue;
    }
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 300);
      console.error(`[ai] ${model}: ${res.status}`, detail);
      const out = { ok: false, error: 'gemini_error', model };
      // подробности — только по явному X-Debug: 1 (и валидному APP_KEY)
      if (request.headers.get('X-Debug') === '1') out.detail = `${res.status} ${detail}`;
      return json(request, 502, out);
    }

    const data = await res.json();
    const candidate = data.candidates?.[0];
    if (candidate?.finishReason === 'SAFETY') {
      return json(request, 200, { ok: false, error: 'safety', model });
    }
    const text = (candidate?.content?.parts ?? []).map((p) => p.text ?? '').join('');
    const parsed = safeParseJson(text);
    if (!parsed) return json(request, 502, { ok: false, error: 'bad_json', model });
    console.log(`[ai] ${model}: ok`);
    return json(request, 200, { ok: true, data: parsed, model });
  }

  // вся цепочка исчерпана: только 429 → дневной лимит; были 503 → перегруз
  return json(request, 200, { ok: false, error: sawOverload ? 'ai_overloaded' : 'daily_limit' });
}
