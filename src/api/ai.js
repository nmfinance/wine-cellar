import { db } from '../db.js';
import { AI_URL, APP_KEY } from './config.js';
import {
  PROMPT_S1,
  buildPromptS2,
  buildPromptS3,
  buildPromptS4,
  buildPromptS5,
  buildPromptS6,
} from '../ai/prompts.js';
import { buildTasteProfile } from '../ai/profile.js';

const blobToBase64 = (blob) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

// Скан этикетки: 1–2 фото → S1 через воркер.
// Возврат: { ok:true, data, model } | { ok:false, error }
// Коды ошибок сервера: daily_limit | ai_overloaded | safety | bad_json |
// gemini_error | forbidden; клиентские: offline | network.
export async function scanLabel(images, signal = null) {
  let body;
  try {
    body = JSON.stringify({
      kind: 's1',
      prompt: PROMPT_S1,
      images: await Promise.all(images.map(blobToBase64)),
    });
  } catch {
    return { ok: false, error: 'bad_request' };
  }

  try {
    const signals = [AbortSignal.timeout(45_000)]; // Gemini на фото небыстрый
    if (signal) signals.push(signal);
    const res = await fetch(`${AI_URL}/ai`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-App-Key': APP_KEY },
      body,
      signal: AbortSignal.any(signals),
    });
    return await res.json();
  } catch (err) {
    if (err?.name === 'AbortError' && signal?.aborted) return { ok: false, error: 'cancelled' };
    return { ok: false, error: navigator.onLine === false ? 'offline' : 'network' };
  }
}

// Текстовый вызов /ai без фото
async function askText(kind, prompt, timeoutMs = 30_000) {
  try {
    const res = await fetch(`${AI_URL}/ai`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-App-Key': APP_KEY },
      body: JSON.stringify({ kind, prompt }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    return await res.json();
  } catch {
    return { ok: false, error: navigator.onLine === false ? 'offline' : 'network' };
  }
}

// S2 v3: паспорт винодельни — длинный JSON, генерация небыстрая (P22)
export const askWineryInfo = (winery) => askText('s2', buildPromptS2(winery), 90_000);

// S6: «глубже о вине» (кэш навсегда в wine.aiDeep)
export const askDeepWine = (wine) => askText('s6', buildPromptS6(wine));

// S3: вопросы дегустации (при открытии опросника)
export const askTastingQuestions = (wine, grapeExperience, sommelierTips) =>
  askText('s3', buildPromptS3(wine, grapeExperience, sommelierTips));

// S4: мнение об оценке (после сохранения дегустации)
export const askScoreOpinion = (wine, tasting) => askText('s4', buildPromptS4(wine, tasting));

const hashBlobs = async (blobs) => {
  const buffers = await Promise.all(blobs.map((b) => b.arrayBuffer()));
  const total = new Uint8Array(buffers.reduce((a, b) => a + b.byteLength, 0));
  let offset = 0;
  for (const buf of buffers) {
    total.set(new Uint8Array(buf), offset);
    offset += buf.byteLength;
  }
  const digest = await crypto.subtle.digest('SHA-256', total);
  return [...new Uint8Array(digest)].map((x) => x.toString(16).padStart(2, '0')).join('');
};

// S5: винная карта — все страницы одним запросом.
// Кэш по хэшу набора фото (24 ч): повторный анализ тех же страниц бесплатен.
export async function analyzeWineList(images, signal = null) {
  const hash = await hashBlobs(images);
  const cacheId = `s5:${hash}`;
  const now = new Date().toISOString();
  const hit = await db.aiCache.get(cacheId);
  if (hit && hit.expiresAt > now) {
    console.debug('[s5] из кэша по хэшу фото');
    return hit.payload;
  }

  const profile = await buildTasteProfile();
  const tastingsCount = await db.tastings.count();
  console.debug(`[s5] режим: ${profile ? 'персональный (Б)' : 'холодный старт (А)'}`);
  if (profile) console.debug('[s5] профиль в промпте:\n' + profile);
  let body;
  try {
    body = JSON.stringify({
      kind: 's5',
      prompt: buildPromptS5(profile),
      images: await Promise.all(images.map(blobToBase64)),
    });
  } catch {
    return { ok: false, error: 'bad_request' };
  }

  try {
    const signals = [AbortSignal.timeout(90_000)]; // несколько страниц — долго
    if (signal) signals.push(signal);
    const res = await fetch(`${AI_URL}/ai`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-App-Key': APP_KEY },
      body,
      signal: AbortSignal.any(signals),
    });
    const json = await res.json();
    if (json.ok) {
      // чем был профиль на момент анализа — для подписи в совете сомелье
      json.data.profileMeta = { personal: !!profile, tastings: tastingsCount };
      await db.aiCache.put({
        id: cacheId,
        kind: 's5',
        key: hash,
        payload: json,
        createdAt: now,
        expiresAt: new Date(Date.now() + 24 * 3600_000).toISOString(),
      });
    }
    return json;
  } catch (err) {
    if (err?.name === 'AbortError' && signal?.aborted) return { ok: false, error: 'cancelled' };
    return { ok: false, error: navigator.onLine === false ? 'offline' : 'network' };
  }
}
