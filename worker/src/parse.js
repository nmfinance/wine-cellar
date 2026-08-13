// Страховочный JSON-парсер (копия proxy/parse.js в ESM — воркер не может
// импортировать из proxy/): срезать ```-обёртки, от первой { до последней }
export function safeParseJson(text) {
  const cleaned = String(text ?? '')
    .replace(/```json/gi, '')
    .replace(/```/g, '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
}
