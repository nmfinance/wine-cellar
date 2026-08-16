import { db } from '../db.js';
import { VIVINO_URL } from './config.js';

// P21.3: маршрут тайлов карты. 'direct' — напрямую в tiles.openfreemap.org,
// 'proxy' — через наш Яндекс-шлюз (когда прямое соединение деградирует;
// диагноз map-check с телефона: прямые запросы виснут 60+ с при живом шлюзе).

const DIRECT_PREFIX = 'https://tiles.openfreemap.org/';
export const TILES_PROXY_BASE = `${VIVINO_URL}/tiles/`;

export async function getMapRoute() {
  return (await db.meta.get('mapRoute'))?.value ?? 'direct';
}

export async function setMapRoute(value) {
  await db.meta.put({ key: 'mapRoute', value });
}

// P21.6: загрузчик тайлов. 'worker' — штатные воркеры MapLibre (дефолт),
// 'main' — векторные тайлы и глифы через mt:// главным потоком
// (устройства, где fetch внутри воркеров виснет)
export async function getTileLoader() {
  return (await db.meta.get('tileLoader'))?.value ?? 'worker';
}

export async function setTileLoader(value) {
  await db.meta.put({ key: 'tileLoader', value });
}

// P21.7: режим карты. 'full' — векторный стиль, 'simple' — растр + точки
// (гарантированный выход для устройств с проклятым векторным конвейером)
export async function getMapMode() {
  return (await db.meta.get('mapMode'))?.value ?? 'full';
}

export async function setMapMode(value) {
  await db.meta.put({ key: 'mapMode', value });
}

// ?v=2 пробивает клиентские кэши, отравленные 403-ответами с Cache-Control
// (баг P21.3, исправлен в P21.5); функция query не форвардит — upstream чист.
// P21.9: cartocdn (включая поддомены a-d) проксируется через /tiles/carto/
const CARTO_RE = /^https:\/\/(?:[a-d]\.)?basemaps\.cartocdn\.com\//;
export const toProxyUrl = (url) => {
  if (url.startsWith(DIRECT_PREFIX)) {
    return `${TILES_PROXY_BASE}${url.slice(DIRECT_PREFIX.length)}${url.includes('?') ? '&' : '?'}v=2`;
  }
  if (CARTO_RE.test(url)) {
    return `${TILES_PROXY_BASE}carto/${url.replace(CARTO_RE, '')}${url.includes('?') ? '&' : '?'}v=2`;
  }
  return url;
};

// transformRequest для MapLibre: режим proxy переписывает запросы на шлюз,
// режим tileLoader='main' оборачивает Tile и Glyphs в mt:// (главный поток;
// растр/стиль/спрайты не трогаем — они и так грузятся главным потоком)
export const makeTransformRequest = (routeRef, loaderRef = null) => (url, resourceType) => {
  // DEV-хук: window.__mapTileHang «вешает» тайлы прямого маршрута
  // (нерутируемый IP → запрос без ответа) — тест вотчдога P21.5
  if (
    import.meta.env.DEV &&
    window.__mapTileHang &&
    resourceType === 'Tile' &&
    routeRef.current === 'direct'
  ) {
    return { url: 'https://10.255.255.1/hang.pbf' };
  }
  let out = url;
  if (routeRef.current === 'proxy') {
    out = toProxyUrl(out); // no-op для URL вне openfreemap/cartocdn
  }
  if (
    loaderRef?.current === 'main' &&
    (resourceType === 'Tile' || resourceType === 'Glyphs') &&
    !out.startsWith('mt://')
  ) {
    out = `mt://${out}`;
  }
  return out !== url ? { url: out } : undefined;
};
