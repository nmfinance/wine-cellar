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
