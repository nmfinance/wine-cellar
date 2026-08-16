import { addProtocol } from 'maplibre-gl';

// P21.6: протокол mt:// — загрузка ресурса ГЛАВНЫМ потоком.
// Диагноз парных отчётов: на устройстве владельца fetch изнутри
// Web Worker'ов MapLibre виснет (векторные тайлы «ПОВИС» на обоих
// маршрутах), при этом тот же URL главным потоком отвечает мгновенно.
// addProtocol штатно доставляет байты в воркер, а парсинг остаётся там.

let registered = false;

// P21.7: счётчики вызовов обработчика по видам ресурса — «mt вызван:
// вектор 0/2» в вердикте теста сразу показывает, дошло ли GR-сообщение
// из воркера до главного потока (0 при запрошенных = обрыв ВНУТРИ воркера)
const stats = { vector: 0, raster: 0, glyphs: 0, other: 0 };

const kindOf = (url) =>
  url.includes('/fonts/') ? 'glyphs' : url.endsWith('.pbf') || url.includes('.pbf?') ? 'vector' : /\.(png|jpe?g|webp)/.test(url) ? 'raster' : 'other';

export const getMtStats = () => ({ ...stats });
export const resetMtStats = () => {
  for (const k of Object.keys(stats)) stats[k] = 0;
};

export function ensureMainThreadProtocol() {
  if (registered) return;
  registered = true;
  addProtocol('mt', async (params) => {
    const url = params.url.replace(/^mt:\/\//, '');
    stats[kindOf(url)] += 1;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`mt://: HTTP ${res.status} · ${url}`);
    return { data: await res.arrayBuffer() };
  });
}
