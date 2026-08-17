// P21.11: сборка собственных стилей карты.
// Светлая = liberty как есть; тёмная = программный форк liberty с контрастной
// тёмной палитрой (полная детализация: дороги/здания/landuse/POI/подписи).
// Запуск: npm run build:map-styles — результат коммитится (стили локальные,
// styles-эндпоинт openfreemap в рантайме больше не нужен).
// sources/glyphs/sprite НЕ переписываются: transformRequest клиента сам
// маршрутизирует их через выбранный маршрут (direct/proxy).

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', 'public', 'map-styles');

const LIBERTY_URL = 'https://tiles.openfreemap.org/styles/liberty';

// ============ ПАЛИТРА — единственный блок для итераций вкуса ============
const PALETTE = {
  background: '#17181c',
  raster: { 'raster-opacity': 0.35, 'raster-brightness-max': 0.25, 'raster-saturation': -0.6 },
  water: '#22304a', // читаемо темнее фона
  waterLine: '#2c3e5e',
  green: '#1d2620',
  landuse: '#1e2023',
  sand: '#26241d',
  ice: '#232830',
  roadMinor: '#34363c',
  roadMajor: '#4a4d55',
  roadHighway: '#5d5432', // тёплый акцент магистралей
  roadCasing: '#101114',
  rail: '#3a3d45',
  boundary: '#6b6f7a',
  building: '#202227',
  aeroway: '#2a2c31',
  text: '#d6d8de',
  textHalo: '#17181c', // главное условие контраста подписей
  poiText: '#9aa0ad',
  poiIconOpacity: 0.7, // светлые иконки спрайта приглушаем (спрайт не перерисовываем)
  shieldIconOpacity: 0.9, // щиты дорог: свой светлый фон, текст не трогаем
};
// ========================================================================

// Правила ролей: первый матч по id выигрывает. covered=true без перекраски —
// слой осознанно оставлен как есть (щиты, стрелки).
const RULES = [
  { test: (l) => l.type === 'background', apply: (l) => setPaint(l, { 'background-color': PALETTE.background }) },
  { test: (l) => l.type === 'raster', apply: (l) => setPaint(l, PALETTE.raster) },
  { test: (l) => /shield/.test(l.id), apply: (l) => setPaint(l, { 'icon-opacity': PALETTE.shieldIconOpacity }) },
  { test: (l) => /one_way_arrow/.test(l.id), apply: (l) => setPaint(l, { 'icon-opacity': 0.5 }) },
  {
    test: (l) => /^poi_|^airport$/.test(l.id),
    apply: (l) =>
      setPaint(l, {
        'text-color': PALETTE.poiText,
        'text-halo-color': PALETTE.textHalo,
        'icon-opacity': PALETTE.poiIconOpacity,
      }),
  },
  {
    test: (l) => l.type === 'symbol',
    apply: (l) => setPaint(l, { 'text-color': PALETTE.text, 'text-halo-color': PALETTE.textHalo }),
  },
  { test: (l) => /^water$|^landcover_wetland$/.test(l.id) && l.type === 'fill', apply: (l) => fillColor(l, PALETTE.water) },
  { test: (l) => /^waterway/.test(l.id), apply: (l) => setPaint(l, { 'line-color': PALETTE.waterLine }) },
  { test: (l) => /landcover_ice/.test(l.id), apply: (l) => fillColor(l, PALETTE.ice) },
  { test: (l) => /landcover_sand/.test(l.id), apply: (l) => fillColor(l, PALETTE.sand) },
  { test: (l) => /park|landcover_wood|landcover_grass/.test(l.id), apply: (l) => (l.type === 'line' ? setPaint(l, { 'line-color': PALETTE.green }) : fillColor(l, PALETTE.green)) },
  { test: (l) => /^landuse_|road_area_pattern/.test(l.id), apply: (l) => fillColor(l, PALETTE.landuse) },
  { test: (l) => /^aeroway/.test(l.id), apply: (l) => (l.type === 'line' ? setPaint(l, { 'line-color': PALETTE.aeroway }) : fillColor(l, PALETTE.aeroway)) },
  { test: (l) => l.id === 'building', apply: (l) => setPaint(l, { 'fill-color': PALETTE.building, 'fill-outline-color': PALETTE.roadCasing }) },
  { test: (l) => l.id === 'building-3d', apply: (l) => setPaint(l, { 'fill-extrusion-color': PALETTE.building }) },
  { test: (l) => /^boundary/.test(l.id), apply: (l) => setPaint(l, { 'line-color': PALETTE.boundary }) },
  { test: (l) => /rail/.test(l.id), apply: (l) => setPaint(l, { 'line-color': PALETTE.rail }) },
  { test: (l) => /_casing$/.test(l.id), apply: (l) => setPaint(l, { 'line-color': PALETTE.roadCasing }) },
  { test: (l) => /motorway|trunk_primary/.test(l.id), apply: (l) => setPaint(l, { 'line-color': PALETTE.roadHighway }) },
  { test: (l) => /secondary_tertiary|street|link/.test(l.id), apply: (l) => setPaint(l, { 'line-color': PALETTE.roadMajor }) },
  { test: (l) => /minor|service_track|path_pedestrian/.test(l.id), apply: (l) => setPaint(l, { 'line-color': PALETTE.roadMinor }) },
];

function setPaint(layer, props) {
  layer.paint = { ...(layer.paint ?? {}), ...props };
}
function fillColor(layer, color) {
  const props = { 'fill-color': color };
  if (layer.paint?.['fill-outline-color'] != null) props['fill-outline-color'] = color;
  setPaint(layer, props);
}

// -------- fallback для неохваченных: HSL-инверсия lightness --------------
function parseColor(str) {
  if (typeof str !== 'string') return null;
  const hex = str.match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1 };
  }
  const rgb = str.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+))?\)/i);
  if (rgb) return { r: +rgb[1], g: +rgb[2], b: +rgb[3], a: rgb[4] != null ? +rgb[4] : 1 };
  const hsl = str.match(/^hsla?\(\s*([\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%\s*(?:,\s*([\d.]+))?\)/i);
  if (hsl) return hslToRgb(+hsl[1], +hsl[2], +hsl[3], hsl[4] != null ? +hsl[4] : 1);
  return null;
}
function hslToRgb(h, s, l, a) {
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const f = (n) => l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return { r: Math.round(f(0) * 255), g: Math.round(f(8) * 255), b: Math.round(f(4) * 255), a };
}
function rgbToHsl({ r, g, b }) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h *= 60;
  }
  return { h, s: s * 100, l: l * 100 };
}
function darkenColorString(str) {
  const c = parseColor(str);
  if (!c) return null;
  const { h, s } = rgbToHsl(c);
  const l = rgbToHsl(c).l;
  // инверсия яркости: светлое → тёмное, сохраняем оттенок, глушим сатурацию
  const newL = Math.max(8, Math.min(35, 100 - l * 0.75));
  const rgb = hslToRgb(h, Math.min(s, 40), newL, c.a);
  return c.a < 1
    ? `rgba(${rgb.r},${rgb.g},${rgb.b},${c.a})`
    : `#${((rgb.r << 16) | (rgb.g << 8) | rgb.b).toString(16).padStart(6, '0')}`;
}
// рекурсивно пройти значение paint (строка или expression-массив)
function darkenValue(v) {
  if (typeof v === 'string') return darkenColorString(v) ?? v;
  if (Array.isArray(v)) return v.map(darkenValue);
  return v;
}
function fallbackDarken(layer) {
  for (const key of Object.keys(layer.paint ?? {})) {
    if (/color/.test(key)) layer.paint[key] = darkenValue(layer.paint[key]);
  }
}

// ------------------------------- сборка ---------------------------------
const res = await fetch(LIBERTY_URL);
if (!res.ok) throw new Error(`liberty недоступен: HTTP ${res.status}`);
const liberty = await res.json();

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'light.json'), JSON.stringify(liberty));
console.log(`light.json: liberty как есть · ${liberty.layers.length} слоёв`);

const dark = structuredClone(liberty);
dark.name = 'Pogreb Dark (liberty fork)';
const uncovered = [];
for (const layer of dark.layers) {
  const rule = RULES.find((r) => r.test(layer));
  if (rule) {
    rule.apply(layer);
  } else {
    fallbackDarken(layer);
    uncovered.push(`${layer.type}:${layer.id}`);
  }
}
writeFileSync(join(outDir, 'dark.json'), JSON.stringify(dark));
console.log(`dark.json: ${dark.layers.length} слоёв перекрашено`);
console.log(
  uncovered.length
    ? `неохваченные словарём (fallback HSL-инверсия), ${uncovered.length}:\n  ${uncovered.join('\n  ')}`
    : 'неохваченных слоёв нет — словарь покрыл всё'
);
