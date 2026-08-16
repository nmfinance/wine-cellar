import { addProtocol } from 'maplibre-gl';

// P21.6: протокол mt:// — загрузка ресурса ГЛАВНЫМ потоком.
// Диагноз парных отчётов: на устройстве владельца fetch изнутри
// Web Worker'ов MapLibre виснет (векторные тайлы «ПОВИС» на обоих
// маршрутах), при этом тот же URL главным потоком отвечает мгновенно.
// addProtocol штатно доставляет байты в воркер, а парсинг остаётся там.

let registered = false;

export function ensureMainThreadProtocol() {
  if (registered) return;
  registered = true;
  addProtocol('mt', async (params) => {
    const url = params.url.replace(/^mt:\/\//, '');
    const res = await fetch(url);
    if (!res.ok) throw new Error(`mt://: HTTP ${res.status} · ${url}`);
    return { data: await res.arrayBuffer() };
  });
}
