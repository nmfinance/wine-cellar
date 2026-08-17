// Стили карты — общие для MapScreen и диагностики (/map-check).
// P21.11: оба стиля ЛОКАЛЬНЫЕ (public/map-styles, собираются
// npm run build:map-styles): светлый = liberty как есть, тёмный =
// программный форк liberty с контрастной тёмной палитрой — полная
// детализация в обеих темах, и styles-эндпоинт openfreemap в рантайме
// не нужен. Внутренние sources/glyphs/sprite стилей ведут на
// tiles.openfreemap.org — их маршрутизирует transformRequest.

export const LIGHT_STYLE = `${import.meta.env.BASE_URL}map-styles/light.json`;

const FIORD_STYLE = 'https://tiles.openfreemap.org/styles/fiord';

// DEV-хук: window.__mapStyleOverride подменяет тёмный стиль (тест fallback);
// localStorage 'darkStyleVariant'='fiord' — временный переключатель сравнения
// нашего тёмного с fiord (крутилка в Диагностике карты)
export const darkStyle = () =>
  (import.meta.env.DEV && window.__mapStyleOverride) ||
  (localStorage.getItem('darkStyleVariant') === 'fiord'
    ? FIORD_STYLE
    : `${import.meta.env.BASE_URL}map-styles/dark.json`);

export const effectiveStyleUrl = () =>
  document.documentElement.classList.contains('dark') ? darkStyle() : LIGHT_STYLE;

// деградация (офлайн/битый стиль/таймаут): точки живут на сером фоне
export const FALLBACK_STYLE = {
  version: 8,
  sources: {},
  layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#d6d3d1' } }],
};

export const STYLE_TIMEOUT_MS = 10_000;

// тайл Милана для проб (z10: lon 9.19, lat 45.46)
export const PROBE_TILE = { z: 10, x: 538, y: 366 };

// P21.7/P21.9: «классический» режим — гарантированно без векторного
// конвейера (мёртв на устройстве владельца). P21.9: полноценный растровый
// бейсмэп CARTO с городами/дорогами/подписями на всех зумах; точки/кластеры
// добавляются обычным addLayers (GeoJSON-тайлы локальные, без network-fetch).
// {r}-токен maplibre не понимает — ретина зашивается при сборке стиля.
export const simpleStyle = (dark) => {
  const flavor = dark ? 'dark_all' : 'voyager';
  const r = (window.devicePixelRatio ?? 1) > 1.5 ? '@2x' : '';
  return {
    version: 8,
    sources: {
      carto: {
        type: 'raster',
        tiles: ['a', 'b', 'c', 'd'].map(
          (s) => `https://${s}.basemaps.cartocdn.com/rastertiles/${flavor}/{z}/{x}/{y}${r}.png`
        ),
        tileSize: 256,
        maxzoom: 20,
        attribution: '© OpenStreetMap contributors © CARTO',
      },
    },
    layers: [
      {
        id: 'background',
        type: 'background',
        paint: { 'background-color': dark ? '#1c1917' : '#e7e5e4' },
      },
      { id: 'carto', type: 'raster', source: 'carto' },
    ],
  };
};

// фолбэк-подложка P21.7 (ne2) — для диагностической ячейки матрицы,
// если cartocdn с устройства недоступен
export const simpleNe2Style = (dark) => ({
  version: 8,
  sources: {
    ne2_shaded: {
      type: 'raster',
      tiles: ['https://tiles.openfreemap.org/natural_earth/ne2sr/{z}/{x}/{y}.png'],
      tileSize: 256,
      maxzoom: 6,
    },
  },
  layers: [
    {
      id: 'background',
      type: 'background',
      paint: { 'background-color': dark ? '#1c1917' : '#e7e5e4' },
    },
    {
      id: 'ne2',
      type: 'raster',
      source: 'ne2_shaded',
      paint: dark ? { 'raster-brightness-max': 0.55, 'raster-saturation': -0.35 } : {},
    },
  ],
});
