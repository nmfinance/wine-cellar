import { db } from '../db.js';

// Курсы ЦБ РФ для честной наценки (vivino.price EUR/USD → ₽).
// Источник: cbr-xml-daily.ru (без ключа, работает из РФ). Кэш в meta 24 ч.
export async function getCbrRates() {
  const cached = (await db.meta.get('cbrRates'))?.value;
  if (cached && Date.now() - new Date(cached.at).getTime() < 24 * 3600_000) {
    return cached.rates;
  }
  try {
    const res = await fetch('https://www.cbr-xml-daily.ru/daily_json.js', {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`cbr ${res.status}`);
    const json = await res.json();
    const rates = {
      EUR: json.Valute?.EUR?.Value ?? null,
      USD: json.Valute?.USD?.Value ?? null,
    };
    await db.meta.put({ key: 'cbrRates', value: { at: new Date().toISOString(), rates } });
    return rates;
  } catch (err) {
    console.warn('[cbr] курс недоступен:', err.message);
    return cached?.rates ?? null; // старый кэш лучше, чем ничего
  }
}
