// P21.3: прокси тайлов OpenFreeMap — резервный маршрут, когда прямое
// соединение с tiles.openfreemap.org у клиента деградирует (диагноз
// map-check: те же URL с телефона то 200 за 221 мс, то виснут 60+ с).
// НЕ открытый прокси: только GET и только whitelist путей.

const UPSTREAM = 'https://tiles.openfreemap.org/';
const WHITELIST = ['styles/', 'planet/', 'natural_earth/', 'fonts/', 'sprites/'];
const TIMEOUT_MS = 15_000;

const allowed = (path) => WHITELIST.some((p) => path.startsWith(p));

// path — часть URL после /tiles/ (уже без query)
async function fetchTile(path) {
  const decoded = decodeURIComponent(path);
  if (!allowed(decoded) || decoded.includes('..')) {
    return { status: 403, contentType: 'application/json', body: Buffer.from('{"ok":false,"error":"path_not_allowed"}') };
  }
  const res = await fetch(UPSTREAM + path, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { 'User-Agent': 'pogreb-proxy/1.0 (personal wine cellar app)' },
  });
  const body = Buffer.from(await res.arrayBuffer());
  return {
    status: res.status,
    contentType: res.headers.get('content-type') ?? 'application/octet-stream',
    body,
  };
}

module.exports = { fetchTile };
