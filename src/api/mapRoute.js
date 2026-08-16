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

// ?v=2 пробивает клиентские кэши, отравленные 403-ответами с Cache-Control
// (баг P21.3, исправлен в P21.5); функция query не форвардит — upstream чист
export const toProxyUrl = (url) =>
  url.startsWith(DIRECT_PREFIX)
    ? `${TILES_PROXY_BASE}${url.slice(DIRECT_PREFIX.length)}${url.includes('?') ? '&' : '?'}v=2`
    : url;

// transformRequest для MapLibre: в режиме proxy переписывает все запросы
// карты (стиль, TileJSON, тайлы, глифы, спрайты) на шлюз
export const makeTransformRequest = (routeRef) => (url, resourceType) => {
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
  if (routeRef.current === 'proxy' && url.startsWith(DIRECT_PREFIX)) {
    return { url: toProxyUrl(url) };
  }
  return undefined;
};
