// Стили карты — общие для MapScreen и диагностики (/map-check).
// P21.1: тёмный — fiord, НЕ styles/dark (тот на малых зумах чёрный по дизайну).

export const LIGHT_STYLE = 'https://tiles.openfreemap.org/styles/liberty';

// DEV-хук: window.__mapStyleOverride подменяет тёмный стиль (тест fallback)
export const darkStyle = () =>
  (import.meta.env.DEV && window.__mapStyleOverride) || 'https://tiles.openfreemap.org/styles/fiord';

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

// P21.7: упрощённый режим — гарантированно без векторного конвейера:
// фон + растр ne2 (доказан «ок» на устройстве владельца), точки/кластеры
// добавляются обычным addLayers (GeoJSON-тайлы локальные, без network-fetch)
export const simpleStyle = (dark) => ({
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
      // в тёмной теме приглушаем растр, чтобы точки читались
      paint: dark ? { 'raster-brightness-max': 0.55, 'raster-saturation': -0.35 } : {},
    },
  ],
});
