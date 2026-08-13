// Страховочный JSON-парсер: срезать ```-обёртки, взять от первой { до последней }
function safeParseJson(text) {
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

module.exports = { safeParseJson };
