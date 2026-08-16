import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Map as MapLibreMap } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { ArrowLeft, Check, Copy, X } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { PROBE_TILE, effectiveStyleUrl } from '../map/styles.js';
import { getMapRoute, setMapRoute, toProxyUrl } from '../api/mapRoute.js';
import { usePageTitle } from '../utils/title.js';
import Toast from '../components/Toast.jsx';

// P21.2: самодиагностика карты — только честные факты, никакой починки.
// Гоняется с телефона владельца, отчёт копируется и отправляется.

const fmtSize = (b) =>
  b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} МБ` : b >= 1024 ? `${Math.round(b / 1024)} КБ` : `${b} б`;

// fetch с замером: статус/время/размер либо текст ошибки
async function probe(url, opts = {}) {
  const t0 = performance.now();
  try {
    const r = await fetch(url, opts);
    const blob = await r.blob();
    const ms = Math.round(performance.now() - t0);
    return {
      ok: r.ok,
      status: r.status,
      size: blob.size,
      detail: `HTTP ${r.status} · ${ms} мс · ${fmtSize(blob.size)}`,
    };
  } catch (e) {
    const ms = Math.round(performance.now() - t0);
    return { ok: false, detail: `${e.name}: ${e.message} · ${ms} мс` };
  }
}

const TESTS = [
  { id: 'style', name: '1 · Style JSON' },
  { id: 'tile', name: '2a · Векторный тайл (Милан)' },
  { id: 'glyphs', name: '2b · Глифы (шрифт)' },
  { id: 'sprite', name: '2c · Спрайт' },
  { id: 'tileProxy', name: '2d · Тот же тайл через шлюз' },
  { id: 'tileNoSw', name: '3 · Тайл в обход Service Worker' },
  { id: 'webgl', name: '4 · WebGL' },
  { id: 'minimap', name: '5 · Мини-карта (стиль темы)' },
  { id: 'minimapRaster', name: '5b · Мини-карта (изоляция: только растр)' },
  { id: 'tileAgain', name: '6 · Обычный тайл повторно (после всех)' },
];

// 5b: встроенный минимальный стиль — прямые растровые URL, ни TileJSON, ни вектора
const INLINE_RASTER_STYLE = {
  version: 8,
  sources: {
    ne2: {
      type: 'raster',
      tiles: ['https://tiles.openfreemap.org/natural_earth/ne2sr/{z}/{x}/{y}.png'],
      tileSize: 256,
      maxzoom: 6,
    },
  },
  layers: [
    { id: 'bg', type: 'background', paint: { 'background-color': '#dcd8d4' } },
    { id: 'ne2', type: 'raster', source: 'ne2' },
  ],
};

// P21.4: пульс requestAnimationFrame — НАТИВНЫЙ, без подмен: считаем кадры
const rafPulse = (ms) =>
  new Promise((resolve) => {
    let frames = 0;
    let stop = false;
    const tick = () => {
      frames += 1;
      if (!stop) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    setTimeout(() => {
      stop = true;
      resolve(frames);
    }, ms);
  });

// P21.4: инструментированный интегральный тест — мини-карта до idle за 15 с.
// В extra попадает всё: запросы transformRequest, таймлайн событий, RAF-пульс.
async function runMiniMapTest(container, styleArg, zoom, cancelledRef) {
  const extra = [];
  try {
    // замер RAF до создания карты
    const preFrames = await rafPulse(1000);
    extra.push(`RAF до карты: ${preFrames} кадров/с${preFrames === 0 ? ' — ЗАМОРОЖЕН' : ''}`);

    const t0 = performance.now();
    const ts = () => `${String(Math.round(performance.now() - t0)).padStart(5)}мс`;

    // transformRequest-логгер: каждый URL+тип + СТАТУС завершения (P21.5)
    const requests = []; // {t, type, url, key, status}
    const tileKey = (u) => u.match(/\/(\d+)\/(\d+)\/(\d+)\.\w+/)?.slice(1).join('/') ?? null;
    const route = await getMapRoute();
    const transformRequest = (url, resourceType) => {
      const proxied = route === 'proxy' ? toProxyUrl(url) : url;
      requests.push({
        t: ts(),
        type: resourceType ?? '?',
        url: proxied,
        key: resourceType === 'Tile' ? tileKey(proxied) : null,
        status: 'запрошен',
      });
      return proxied !== url ? { url: proxied } : undefined;
    };
    const markTile = (canonical, status) => {
      if (!canonical) return;
      const key = `${canonical.z}/${canonical.x}/${canonical.y}`;
      const row = requests.find((r) => r.key === key && (r.status === 'запрошен' || status.startsWith('ошибка')));
      if (row) row.status = status;
    };

    const map = new MapLibreMap({
      container,
      style: styleArg,
      center: [9.19, 45.46], // Милан — там же, где пробный тайл
      zoom,
      attributionControl: false,
      interactive: false,
      transformRequest,
    });

    // таймлайн событий; sourcedata шумный — пишем только смену состояния источника
    const timeline = [];
    const sourceState = {}; // sourceId → 'грузится' | 'loaded'
    const evt = (line) => {
      if (timeline.length < 40) timeline.push(`${ts()} ${line}`);
    };
    map.on('styledata', () => evt('styledata'));
    map.on('dataloading', (e) => {
      if (e.sourceId && sourceState[e.sourceId] !== 'грузится' && sourceState[e.sourceId] !== 'loaded') {
        sourceState[e.sourceId] = 'грузится';
        evt(`dataloading ${e.sourceId}`);
      }
    });
    map.on('sourcedata', (e) => {
      if (e.sourceId && e.isSourceLoaded && sourceState[e.sourceId] !== 'loaded') {
        sourceState[e.sourceId] = 'loaded';
        evt(`sourcedata ${e.sourceId} → loaded`);
      }
      // завершившиеся тайлы — статус в лог запросов
      const canon = e.tile?.tileID?.canonical ?? e.coord?.canonical;
      if (canon && e.tile?.state === 'loaded') markTile(canon, 'ок');
    });
    const errors = [];
    map.on('error', (e) => {
      const msg = String(e.error?.message ?? e.error ?? '?');
      errors.push(msg);
      evt(`ERROR ${msg}`); // полный текст, без обрезки — тут живут URL ошибок
      const canon = e.tile?.tileID?.canonical ?? e.coord?.canonical;
      if (canon) markTile(canon, `ошибка: ${msg}`);
    });
    let renders = 0;
    map.on('render', () => {
      renders += 1;
      if (renders <= 3) evt(`render #${renders}`);
    });

    // RAF-пульс во время теста — параллельно ожиданию idle
    let duringFrames = 0;
    let pulseStop = false;
    const pulseTick = () => {
      duringFrames += 1;
      if (!pulseStop) requestAnimationFrame(pulseTick);
    };
    requestAnimationFrame(pulseTick);

    const outcome = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve(null), 15_000);
      map.on('idle', () => {
        clearTimeout(timer);
        evt('idle');
        resolve(Math.round(performance.now() - t0));
      });
    });
    pulseStop = true;

    // незавершённые тайлы — повисли
    for (const r of requests) if (r.key && r.status === 'запрошен') r.status = 'ПОВИС (нет ответа за тест)';

    const tileRows = requests.filter((r) => r.type === 'Tile');
    const tilesOk = tileRows.filter((r) => r.status === 'ок').length;
    // честный критерий (P21.5): idle И все источники loaded И (при векторных
    // источниках) хотя бы один успешный тайл — иначе «нарисован фон»
    let hasVector = false;
    let allSourcesLoaded = true;
    try {
      const sources = map.getStyle()?.sources ?? {};
      hasVector = Object.values(sources).some((s) => s.type === 'vector');
      for (const id of Object.keys(sources)) {
        if (!map.isSourceLoaded(id)) allSourcesLoaded = false;
      }
    } catch {
      allSourcesLoaded = false;
    }

    const srcSummary = Object.entries(sourceState)
      .map(([k, v]) => `${k}=${v}`)
      .join(', ') || 'ни один источник не начинал грузиться';
    const verdict = `запросов тайлов: ${tileRows.length} (ок: ${tilesOk}) · кадров за тест: ${duringFrames}${duringFrames === 0 ? ' (RAF ЗАМОРОЖЕН)' : ''} · рендеров: ${renders} · источники: ${srcSummary}`;

    extra.push(`— вердикт: ${verdict}`);
    extra.push(
      `— запросы MapLibre (${requests.length}):`,
      ...requests.slice(0, 25).map((r) => `${r.t} ${r.type} [${r.status}] ${r.url.slice(0, 110)}`)
    );
    if (requests.length > 25) extra.push(`  …ещё ${requests.length - 25}`);
    extra.push(`— таймлайн:`, ...timeline);

    if (cancelledRef.current) map.remove();
    else setTimeout(() => map.remove(), 500);

    const vectorOk = !hasVector || tilesOk >= 1;
    if (outcome != null && allSourcesLoaded && vectorOk) {
      return { ok: true, detail: `отрисована за ${outcome} мс · ${verdict}`, extra };
    }
    if (outcome != null) {
      return { ok: false, detail: `idle без вектора: нарисован фон · ${verdict}`, extra };
    }
    return { ok: false, detail: `не дорисовалась за 15 с · ${verdict}`, extra };
  } catch (e) {
    return { ok: false, detail: `${e.name}: ${e.message}`, extra };
  }
}

export default function MapCheckScreen() {
  const navigate = useNavigate();
  usePageTitle('Диагностика карты');
  const [results, setResults] = useState({}); // id → {ok, detail}
  const [running, setRunning] = useState(true);
  const [toast, setToast] = useState(null);
  const miniRef = useRef(null);
  const miniRasterRef = useRef(null);
  const cancelledRef = useRef(false);
  const route = useLiveQuery(getMapRoute) ?? 'direct';

  useEffect(() => {
    cancelledRef.current = false;
    const set = (id, res) => {
      if (!cancelledRef.current) setResults((r) => ({ ...r, [id]: res }));
    };

    (async () => {
      // 1 · стиль текущей темы
      const styleUrl = effectiveStyleUrl();
      const styleRes = await probe(styleUrl);
      set('style', { ...styleRes, detail: `${styleRes.detail} · ${styleUrl}` });

      // 2 · реальные URL из полученного стиля
      let style = null;
      if (styleRes.ok) {
        try {
          style = await (await fetch(styleUrl)).json();
        } catch {
          style = null;
        }
      }
      let tileUrl = null;
      if (!style) {
        const skip = { ok: false, detail: 'пропущен: стиль не получен' };
        set('tile', skip);
        set('glyphs', skip);
        set('sprite', skip);
        set('tileNoSw', skip);
      } else {
        // источник с TileJSON (openmaptiles) или прямыми tiles
        const src = Object.values(style.sources).find((s) => s.url) ?? Object.values(style.sources)[0];
        let template = src?.tiles?.[0] ?? null;
        let tileJsonErr = null;
        if (!template && src?.url) {
          try {
            const tj = await (await fetch(src.url)).json();
            template = tj.tiles?.[0] ?? null;
          } catch (e) {
            tileJsonErr = `TileJSON (${src.url}) не получен: ${e.name}: ${e.message}`;
          }
        }
        if (template) {
          tileUrl = template
            .replace('{z}', PROBE_TILE.z)
            .replace('{x}', PROBE_TILE.x)
            .replace('{y}', PROBE_TILE.y);
          const r = await probe(tileUrl);
          set('tile', { ...r, detail: `${r.detail} · ${new URL(tileUrl).host}` });
        } else {
          set('tile', { ok: false, detail: tileJsonErr ?? 'в стиле не нашлось URL тайлов' });
        }

        if (style.glyphs) {
          const glyphUrl = style.glyphs
            .replace('{fontstack}', encodeURIComponent('Noto Sans Regular'))
            .replace('{range}', '0-255');
          set('glyphs', await probe(glyphUrl));
        } else {
          set('glyphs', { ok: false, detail: 'стиль без глифов' });
        }

        if (style.sprite) {
          set('sprite', await probe(`${style.sprite}.json`));
        } else {
          set('sprite', { ok: false, detail: 'стиль без спрайта' });
        }

        // 2d · тот же тайл через наш шлюз — прямое сравнение маршрутов
        if (tileUrl) {
          const r = await probe(toProxyUrl(tileUrl));
          set('tileProxy', { ...r, detail: `${r.detail} · ${new URL(toProxyUrl(tileUrl)).host}` });
        } else {
          set('tileProxy', { ok: false, detail: 'пропущен: URL тайла не получен (см. 2a)' });
        }

        // 3 · тот же тайл мимо SW и HTTP-кэша; расхождение с 2a = виноват SW
        if (tileUrl) {
          const r = await probe(`${tileUrl}?nocache=${Math.random().toString(36).slice(2)}`, {
            cache: 'no-store',
          });
          set('tileNoSw', {
            ...r,
            detail: r.detail + (r.ok ? '' : ' · если 2a зелёный, а этот нет — мешает кэш/SW'),
          });
        } else {
          set('tileNoSw', { ok: false, detail: 'пропущен: URL тайла не получен (см. 2a)' });
        }
      }

      // 4 · WebGL
      try {
        const c = document.createElement('canvas');
        const gl = c.getContext('webgl2') ?? c.getContext('webgl');
        if (!gl) {
          set('webgl', { ok: false, detail: 'контекст WebGL не создался' });
        } else {
          const dbg = gl.getExtension('WEBGL_debug_renderer_info');
          const renderer = dbg
            ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)
            : gl.getParameter(gl.RENDERER);
          set('webgl', { ok: true, detail: String(renderer) });
        }
      } catch (e) {
        set('webgl', { ok: false, detail: `${e.name}: ${e.message}` });
      }

      // 5 · интегральный: мини-карта со стилем темы (полная инструментация)
      set('minimap', await runMiniMapTest(miniRef.current, effectiveStyleUrl(), 10, cancelledRef));

      // 5b · изоляция: встроенный минимальный стиль (background + растр ne2sr
      // прямыми URL, без TileJSON и вектора) — отделяет «MapLibre не живёт»
      // от «спотыкается о TileJSON/вектор»
      set('minimapRaster', await runMiniMapTest(miniRasterRef.current, INLINE_RASTER_STYLE, 4, cancelledRef));

      // 6 · обычный тайл повторно ПОСЛЕ всех — эффект порядка/прогрева
      if (tileUrl) {
        const r = await probe(`${tileUrl}?again=${Math.random().toString(36).slice(2)}`, {
          cache: 'no-store',
        });
        set('tileAgain', r);
      } else {
        set('tileAgain', { ok: false, detail: 'пропущен: URL тайла не получен (см. 2a)' });
      }

      if (!cancelledRef.current) setRunning(false);
    })();

    return () => {
      cancelledRef.current = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const copyReport = async () => {
    const lines = [
      `Диагностика карты · ${new Date().toISOString()}`,
      `UA: ${navigator.userAgent}`,
      `Тема: ${document.documentElement.classList.contains('dark') ? 'тёмная' : 'светлая'} · онлайн: ${navigator.onLine} · маршрут: ${route}`,
      '',
      ...TESTS.flatMap((t) => {
        const r = results[t.id];
        return [
          `${r ? (r.ok ? 'OK ' : 'FAIL') : '...'} · ${t.name}: ${r?.detail ?? 'не выполнялся'}`,
          ...(r?.extra ?? []).map((x) => `    ${x}`),
        ];
      }),
    ];
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      setToast('Отчёт скопирован');
    } catch {
      setToast('Не удалось скопировать');
    }
  };

  return (
    <div className="px-4 py-5 pb-[calc(2rem+env(safe-area-inset-bottom))]">
      <button
        onClick={() => navigate(-1)}
        className="mb-4 flex items-center gap-1 text-sm font-medium text-wine-600 dark:text-wine-400"
      >
        <ArrowLeft className="size-4" /> Назад
      </button>
      <h1 className="text-xl font-semibold">Диагностика карты</h1>
      <p className="mt-1 text-[13px] text-stone-500 dark:text-stone-400">
        Проверяет каждое звено карты по отдельности. Скопируй отчёт и отправь — по нему видно,
        что именно не доезжает.
      </p>

      {/* P21.3: ручное управление маршрутом тайлов */}
      <div className="mt-3 flex items-center gap-2 rounded-xl bg-white p-3 dark:bg-stone-900">
        <span className="flex-1 text-sm">Маршрут тайлов</span>
        {[
          ['direct', 'Прямой'],
          ['proxy', 'Через шлюз'],
        ].map(([key, label]) => (
          <button
            key={key}
            onClick={() => setMapRoute(key)}
            className={`rounded-full border px-3 py-1 text-[13px] transition-colors ${
              route === key
                ? 'border-wine-600 bg-wine-600 text-white dark:border-wine-400 dark:bg-wine-400 dark:text-stone-950'
                : 'border-stone-300 text-stone-600 dark:border-stone-600 dark:text-stone-300'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="mt-4 space-y-1.5">
        {TESTS.map((t) => {
          const r = results[t.id];
          return (
            <div key={t.id} className="rounded-xl bg-white p-3 dark:bg-stone-900">
              <div className="flex items-center gap-2">
                {!r ? (
                  <span className="size-4 shrink-0 animate-pulse rounded-full bg-stone-300 dark:bg-stone-600" />
                ) : r.ok ? (
                  <Check className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                ) : (
                  <X className="size-4 shrink-0 text-red-600 dark:text-red-400" />
                )}
                <span className="text-sm font-medium">{t.name}</span>
              </div>
              {r && (
                <p className="mt-1 pl-6 text-[12px] break-all text-stone-500 dark:text-stone-400">
                  {r.detail}
                </p>
              )}
            </div>
          );
        })}
      </div>

      {/* контейнеры мини-карт — видны, это часть тестов 5 и 5b */}
      <div
        ref={miniRef}
        className="mt-3 h-[200px] w-full overflow-hidden rounded-xl bg-stone-200 dark:bg-stone-800"
      />
      <div
        ref={miniRasterRef}
        className="mt-2 h-[200px] w-full overflow-hidden rounded-xl bg-stone-200 dark:bg-stone-800"
      />

      <button
        onClick={copyReport}
        disabled={running}
        className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-wine-600 py-3 text-sm font-medium text-white disabled:opacity-50 dark:bg-wine-400 dark:text-stone-950"
      >
        <Copy className="size-4" /> Скопировать отчёт
      </button>

      <Toast message={toast} onDone={() => setToast(null)} />
    </div>
  );
}
