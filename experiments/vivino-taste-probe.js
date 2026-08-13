// P10.5: есть ли в SSR-пропсах /search/wines вкусовая структура (taste)?
// Запуск: node vivino-taste-probe.js
const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en',
};

const unescapeHtml = (s) =>
  s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

function extractJsonObject(text, start) {
  let depth = 0, inString = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) { if (ch === '\\') i++; else if (ch === '"') inString = false; }
    else if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return text.slice(start, i + 1);
  }
  return null;
}

for (const q of ['aldo conterno barolo', 'trimbach gewurztraminer']) {
  const res = await fetch(`https://www.vivino.com/search/wines?q=${encodeURIComponent(q)}`, {
    headers: BROWSER_HEADERS, signal: AbortSignal.timeout(15000),
  });
  const decoded = unescapeHtml(await res.text());
  const idx = decoded.indexOf('"initialExploreResults":');
  const data = JSON.parse(extractJsonObject(decoded, decoded.indexOf('{', idx + 24)));
  const m = data.matches?.[0]?.vintage;
  console.log(`=== ${q} → ${m?.name}`);
  console.log('wine.taste:', JSON.stringify(m?.wine?.taste)?.slice(0, 500));
  console.log('wine.style keys:', m?.wine?.style ? Object.keys(m.wine.style).join(', ') : null);
  await new Promise((r) => setTimeout(r, 2500));
}
