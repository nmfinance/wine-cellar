// P21.3: прокси тайлов — резервный маршрут, когда прямое соединение
// с тайловыми хостами у клиента деградирует.
// P21.9: два upstream'а — OpenFreeMap (вектор/растр/шрифты) и CARTO
// (растровый бейсмэп классического режима).
// НЕ открытый прокси: только GET и только whitelist путей.

const OFM_UPSTREAM = 'https://tiles.openfreemap.org/';
const CARTO_UPSTREAM = 'https://basemaps.cartocdn.com/';
const OFM_SECTIONS = ['styles', 'planet', 'natural_earth', 'fonts', 'sprites'];
const TIMEOUT_MS = 15_000;

// path — часть URL после /tiles/ (без query).
// 'carto/rastertiles/…' → CARTO, иначе — разделы OpenFreeMap.
function resolve(path) {
  const decoded = decodeURIComponent(path);
  if (decoded.includes('..')) return null;
  if (decoded.startsWith('carto/')) {
    const rest = decoded.slice('carto/'.length);
    if (!rest.startsWith('rastertiles/')) return null;
    return CARTO_UPSTREAM + path.slice('carto/'.length);
  }
  // P21.5: и голое имя раздела (TileJSON живёт на пути `planet` без слэша)
  const ok = OFM_SECTIONS.some((p) => decoded === p || decoded.startsWith(p + '/'));
  return ok ? OFM_UPSTREAM + path : null;
}

async function fetchTile(path) {
  const target = resolve(path);
  if (!target) {
    return {
      status: 403,
      contentType: 'application/json',
      body: Buffer.from('{"ok":false,"error":"path_not_allowed"}'),
    };
  }
  const res = await fetch(target, {
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
