import { AI_URL, APP_KEY } from './config.js';
import { PROMPT_S1 } from '../ai/prompts.js';

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
