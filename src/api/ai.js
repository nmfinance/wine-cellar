import { AI_URL, APP_KEY } from './config.js';
import {
  PROMPT_S1,
  buildPromptS2,
  buildPromptS3,
  buildPromptS4,
  buildPromptS6,
} from '../ai/prompts.js';

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
async function askText(kind, prompt) {
  try {
    const res = await fetch(`${AI_URL}/ai`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-App-Key': APP_KEY },
      body: JSON.stringify({ kind, prompt }),
      signal: AbortSignal.timeout(30_000),
    });
    return await res.json();
  } catch {
    return { ok: false, error: navigator.onLine === false ? 'offline' : 'network' };
  }
}

// S2: справка о винодельне
export const askWineryInfo = (winery) => askText('s2', buildPromptS2(winery));

// S6: «глубже о вине» (кэш навсегда в wine.aiDeep)
export const askDeepWine = (wine) => askText('s6', buildPromptS6(wine));

// S3: вопросы дегустации (при открытии опросника)
export const askTastingQuestions = (wine, grapeExperience, sommelierTips) =>
  askText('s3', buildPromptS3(wine, grapeExperience, sommelierTips));

// S4: мнение об оценке (после сохранения дегустации)
export const askScoreOpinion = (wine, tasting) => askText('s4', buildPromptS4(wine, tasting));
