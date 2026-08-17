import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import maplibregl from 'maplibre-gl';

const { Map: MapLibreMap } = maplibregl;
import 'maplibre-gl/dist/maplibre-gl.css';
import { ArrowLeft, Check, Copy } from 'lucide-react';
import { LIGHT_STYLE, PROBE_TILE, darkStyle, simpleNe2Style, simpleStyle } from '../map/styles.js';
import { setMapMode, setMapRoute, setTileLoader, toProxyUrl } from '../api/mapRoute.js';
import { ensureMainThreadProtocol, getMtStats, resetMtStats } from '../map/mtProtocol.js';
import { usePageTitle } from '../utils/title.js';
import Toast from '../components/Toast.jsx';

// P21.8: матричный автотест — все комбинации режим×маршрут×загрузчик
// одним запуском, вместо ручных прогонов по одной. Порядок ячеек = приоритет
// рекомендации (full>simple, direct>proxy, worker>main).

const CELLS = [];
for (const mode of ['full', 'simple']) {
  for (const route of ['direct', 'proxy']) {
    for (const loader of ['worker', 'main']) {
      CELLS.push({ mode, route, loader, key: `${mode}/${route}/${loader}` });
    }
  }
}

const MODE_RU = { full: 'Векторная', simple: 'Классическая' };
const ROUTE_RU = { direct: 'прямой', proxy: 'шлюз' };
const LOADER_RU = { worker: 'воркеры', main: 'главный поток' };

const CELL_TIMEOUT_MS = 12_000;

const fmtSize = (b) => (b >= 1024 ? `${Math.round(b / 1024)} КБ` : `${b} б`);

async function probe(url, opts = {}) {
  const t0 = performance.now();
  try {
    const r = await fetch(url, opts);
    const b = await r.blob();
    return `HTTP ${r.status} · ${Math.round(performance.now() - t0)} мс · ${fmtSize(b.size)}`;
  } catch (e) {
    return `${e.name}: ${e.message}`;
  }
}

// одна ячейка матрицы: мини-карта в явной конфигурации, вердикт строкой
async function runCell(container, { mode, route, loader, key }, dark, opts = {}) {
  // DEV-хук «здоровой конфигурации» — проверка рекомендации и «Применить»
  if (import.meta.env.DEV && window.__matrixForceGreen === key) {
    return { verdict: 'ok', line: 'синтетический ✅ (dev-хук __matrixForceGreen)' };
  }
  ensureMainThreadProtocol();
  resetMtStats();
  const MapCtor = opts.MapCtor ?? MapLibreMap;
  const style =
    opts.styleOverride ?? (mode === 'simple' ? simpleStyle(dark) : dark ? darkStyle() : LIGHT_STYLE);
  let tilesReq = 0;
  let tilesOk = 0;
  const transformRequest = (url, type) => {
    let out = url;
    if (route === 'proxy' && out.startsWith('https://tiles.openfreemap.org/')) out = toProxyUrl(out);
    if (loader === 'main' && (type === 'Tile' || type === 'Glyphs') && !out.startsWith('mt://')) {
      out = `mt://${out}`;
    }
    if (type === 'Tile') tilesReq += 1;
    return out !== url ? { url: out } : undefined;
  };

  const t0 = performance.now();
  let map;
  try {
    map = new MapCtor({
      container,
      style,
      center: [9.19, 45.46],
      zoom: mode === 'simple' ? 4 : 10,
      interactive: false,
      attributionControl: false,
      transformRequest,
    });
  } catch (e) {
    return { verdict: 'hang', line: `карта не создалась: ${e.message}` };
  }
  const errors = [];
  map.on('error', (e) => errors.push(String(e.error?.message ?? e.error)));
  map.on('sourcedata', (e) => {
    if (e.tile?.state === 'loaded') tilesOk += 1;
  });

  const idleMs = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), CELL_TIMEOUT_MS);
    map.on('idle', () => {
      clearTimeout(timer);
      resolve(Math.round(performance.now() - t0));
    });
  });

  let allLoaded = true;
  let hasVector = false;
  try {
    const sources = map.getStyle()?.sources ?? {};
    hasVector = Object.values(sources).some((s) => s.type === 'vector');
    for (const id of Object.keys(sources)) if (!map.isSourceLoaded(id)) allLoaded = false;
  } catch {
    allLoaded = false;
  }
  const mt = getMtStats();
  try {
    map.remove();
  } catch {}

  const secs = Math.round((idleMs ?? CELL_TIMEOUT_MS) / 100) / 10;
  const line = `тайлы ${tilesOk}/${tilesReq} ок · mt: вектор ${mt.vector}, растр ${mt.raster} · ${secs} с${errors.length ? ` · ошибок: ${errors.length} (${errors[0]?.slice(0, 60)})` : ''}`;
  const ok = idleMs != null && allLoaded && (tilesOk >= 1 || (!hasVector && !tilesReq));
  const verdict = ok ? 'ok' : idleMs != null ? 'bg' : 'hang';
  return { verdict, line };
}

const VERDICT_UI = {
  ok: { icon: '✅', label: 'отрисована' },
  bg: { icon: '🟡', label: 'фон без тайлов' },
  hang: { icon: '❌', label: 'повисла' },
};

export default function MapMatrixScreen() {
  const navigate = useNavigate();
  usePageTitle('Полная диагностика');
  const [progress, setProgress] = useState(null); // {i, cell}
  const [preflight, setPreflight] = useState([]); // строки одноразовых проб
  const [rows, setRows] = useState({}); // key → {verdict, line}
  const [done, setDone] = useState(false);
  const [applied, setApplied] = useState(null);
  const [toast, setToast] = useState(null);
  const cellRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const dark = document.documentElement.classList.contains('dark');
      const pf = [];
      const say = (l) => {
        pf.push(l);
        if (!cancelled) setPreflight([...pf]);
      };

      // одноразовые сетевые пробы: прямые и через шлюз
      const tileDirect = `https://tiles.openfreemap.org/planet/20260802_080001_pt/${PROBE_TILE.z}/${PROBE_TILE.x}/${PROBE_TILE.y}.pbf`;
      const glyphsDirect = 'https://tiles.openfreemap.org/fonts/Noto%20Sans%20Regular/0-255.pbf';
      say(`стиль прямой: ${await probe(dark ? darkStyle() : LIGHT_STYLE)}`);
      say(`стиль шлюз: ${await probe(toProxyUrl(dark ? darkStyle() : LIGHT_STYLE))}`);
      say(`тайл прямой: ${await probe(tileDirect, { cache: 'no-store' })}`);
      say(`тайл шлюз: ${await probe(toProxyUrl(tileDirect))}`);
      say(`глифы прямые: ${await probe(glyphsDirect)}`);
      say(`глифы шлюз: ${await probe(toProxyUrl(glyphsDirect))}`);

      // WebGL
      try {
        const c = document.createElement('canvas');
        const gl = c.getContext('webgl2') ?? c.getContext('webgl');
        const dbg = gl?.getExtension('WEBGL_debug_renderer_info');
        say(`WebGL: ${gl ? (dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'есть') : 'НЕТ'}`);
      } catch (e) {
        say(`WebGL: ${e.message}`);
      }

      // 5c/5d компактно: голый воркер + опции MapLibre + Cache API
      const workerLine = await new Promise((resolve) => {
        let finished = false;
        const finish = (v) => { if (!finished) { finished = true; resolve(v); } };
        try {
          const code = `self.onmessage = async (e) => {
            const out = [];
            try {
              const t0 = Date.now();
              const r = await fetch(e.data.plain, { cache: 'no-store' });
              const b = await r.arrayBuffer();
              out.push('fetch: ' + r.status + '/' + (Date.now() - t0) + 'ms/' + b.byteLength);
            } catch (err) { out.push('fetch: ' + String(err)); }
            try {
              const t0 = Date.now();
              const ctrl = new AbortController();
              const req = new Request(e.data.ml, { method: 'GET', referrer: e.data.referrer, signal: ctrl.signal });
              const r = await fetch(req);
              const b = await r.arrayBuffer();
              out.push('как-MapLibre: ' + r.status + '/' + (Date.now() - t0) + 'ms/' + b.byteLength);
            } catch (err) { out.push('как-MapLibre: ' + String(err)); }
            try {
              const c = await caches.open('matrix-5d');
              await c.put(e.data.ml + '&ct=1', new Response(new ArrayBuffer(64)));
              const hit = await c.match(e.data.ml + '&ct=1');
              await caches.delete('matrix-5d');
              out.push('CacheAPI: hit=' + !!hit);
            } catch (err) { out.push('CacheAPI: ' + String(err)); }
            self.postMessage(out.join(' · '));
          };`;
          const w = new Worker(URL.createObjectURL(new Blob([code], { type: 'application/javascript' })));
          const timer = setTimeout(() => { w.terminate(); finish('ПОВИС за 10 с'); }, 10_000);
          w.onmessage = (e) => { clearTimeout(timer); w.terminate(); finish(e.data); };
          w.onerror = (e) => { clearTimeout(timer); w.terminate(); finish(`упал: ${e.message}`); };
          w.postMessage({
            plain: `${tileDirect}?mx1=${Math.random().toString(36).slice(2)}`,
            ml: `${tileDirect}?mx2=${Math.random().toString(36).slice(2)}`,
            referrer: location.href,
          });
        } catch (e) {
          finish(`не создался: ${e.message}`);
        }
      });
      say(`воркер (5c/5d): ${workerLine}`);

      // матрица: строго последовательно
      const results = {};
      for (let i = 0; i < CELLS.length; i++) {
        if (cancelled) return;
        const cell = CELLS[i];
        setProgress({ i: i + 1, cell });
        const res = await runCell(cellRef.current, cell, dark);
        if (cancelled) return;
        results[cell.key] = res;
        setRows({ ...results });
      }

      // 9 · контрольная ячейка вектора на ТЕКУЩЕЙ версии бандла
      // (P21.9 гоняла здесь v5 с CDN и подтвердила даунгрейд; P21.10 — v5 в бандле)
      setProgress({ i: 9, cell: { mode: 'v5', route: 'direct', loader: 'worker' } });
      const v5res = await runCell(
        cellRef.current,
        { mode: 'full', route: 'direct', loader: 'worker', key: 'v5' },
        dark,
        { styleOverride: dark ? darkStyle() : LIGHT_STYLE }
      );
      if (cancelled) return;
      results.v5 = v5res;
      setRows({ ...results });

      // фолбэк-ячейка: все классические ❌ → пробуем старую подложку ne2
      const anySimpleOk = CELLS.filter((c) => c.mode === 'simple').some(
        (c) => results[c.key]?.verdict === 'ok'
      );
      if (!anySimpleOk) {
        setProgress({ i: 10, cell: { mode: 'ne2', route: 'direct', loader: 'worker' } });
        const ne2res = await runCell(
          cellRef.current,
          { mode: 'simple', route: 'direct', loader: 'worker', key: 'ne2' },
          dark,
          { styleOverride: simpleNe2Style(dark) }
        );
        if (cancelled) return;
        results.ne2 = ne2res;
        setRows({ ...results });
      }

      setProgress(null);
      setDone(true);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const greens = CELLS.filter((c) => rows[c.key]?.verdict === 'ok');
  const recommended = greens[0]?.key ?? null;

  const apply = async (cell) => {
    await setMapMode(cell.mode);
    await setMapRoute(cell.route);
    await setTileLoader(cell.loader);
    setApplied(cell.key);
    setToast('Конфигурация применена');
  };

  const copyReport = async () => {
    const lines = [
      `Полная диагностика карты · ${new Date().toISOString()}`,
      `UA: ${navigator.userAgent}`,
      '',
      '— Пробы:',
      ...preflight.map((l) => `  ${l}`),
      '',
      '— Матрица:',
      ...CELLS.map((c) => {
        const r = rows[c.key];
        const v = r ? VERDICT_UI[r.verdict] : null;
        return `  ${v ? v.icon : '…'} ${c.key}: ${r ? `${v.label} · ${r.line}` : 'не прогонялась'}${c.key === recommended ? ' ← РЕКОМЕНДАЦИЯ' : ''}`;
      }),
      ...['v5', 'ne2']
        .filter((k) => rows[k])
        .map((k) => `  ${VERDICT_UI[rows[k].verdict].icon} ${k === 'v5' ? 'вектор (текущая версия)' : 'simple-ne2 (фолбэк)'}: ${VERDICT_UI[rows[k].verdict].label} · ${rows[k].line}`),
      '',
      `Применённая конфигурация: ${applied ?? 'не применялась'}`,
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
      <h1 className="text-xl font-semibold">Полная диагностика</h1>
      <p className="mt-1 text-[13px] text-stone-500 dark:text-stone-400">
        Прогоняет все 8 комбинаций карты подряд (~2.5 мин). Зелёная строка — рабочая
        конфигурация, её можно применить одной кнопкой.
      </p>

      {progress && (
        <p className="mt-3 rounded-xl bg-wine-100 px-3 py-2 text-sm text-wine-700 dark:bg-wine-900 dark:text-wine-200">
          {progress.cell.mode === 'v5'
            ? 'ячейка 9 · вектор (текущая версия)'
            : progress.cell.mode === 'ne2'
              ? 'ячейка 10 · фолбэк-подложка ne2'
              : `ячейка ${progress.i}/8 · ${MODE_RU[progress.cell.mode]} · ${ROUTE_RU[progress.cell.route]} · ${LOADER_RU[progress.cell.loader]}`}
        </p>
      )}

      {/* видимый контейнер ячейки: фоновые канвасы Chrome душит */}
      <div
        ref={cellRef}
        className="mt-3 h-[200px] w-full overflow-hidden rounded-xl bg-stone-200 dark:bg-stone-800"
      />

      {preflight.length > 0 && (
        <div className="mt-3 rounded-xl bg-white p-3 dark:bg-stone-900">
          <p className="text-[13px] font-medium text-stone-500 dark:text-stone-400">Пробы</p>
          {preflight.map((l, i) => (
            <p key={i} className="mt-1 text-[12px] break-all text-stone-600 dark:text-stone-300">
              {l}
            </p>
          ))}
        </div>
      )}

      <div className="mt-3 space-y-1.5">
        {CELLS.map((c) => {
          const r = rows[c.key];
          const v = r ? VERDICT_UI[r.verdict] : null;
          const isRec = c.key === recommended;
          return (
            <div
              key={c.key}
              className={`rounded-xl bg-white p-3 dark:bg-stone-900 ${
                isRec ? 'border-2 border-emerald-500' : ''
              }`}
            >
              <div className="flex items-center gap-2">
                <span>{v ? v.icon : '·'}</span>
                <span className="flex-1 text-sm font-medium">
                  {MODE_RU[c.mode]} · {ROUTE_RU[c.route]} · {LOADER_RU[c.loader]}
                  {isRec && (
                    <span className="ml-1.5 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                      рекомендуется
                    </span>
                  )}
                </span>
                {r?.verdict === 'ok' && (
                  <button
                    onClick={() => apply(c)}
                    className={`rounded-full px-2.5 py-1 text-[12px] font-medium ${
                      applied === c.key
                        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300'
                        : 'bg-wine-600 text-white dark:bg-wine-400 dark:text-stone-950'
                    }`}
                  >
                    {applied === c.key ? <Check className="size-3.5" /> : 'Применить'}
                  </button>
                )}
              </div>
              {r && (
                <p className="mt-1 pl-6 text-[12px] break-all text-stone-500 dark:text-stone-400">
                  {v.label} · {r.line}
                </p>
              )}
            </div>
          );
        })}
      </div>

      {/* спец-ячейки: гипотеза v5 и фолбэк ne2 */}
      {['v5', 'ne2'].map((k) => {
        const r = rows[k];
        if (!r) return null;
        const v = VERDICT_UI[r.verdict];
        return (
          <div key={k} className="mt-1.5 rounded-xl bg-white p-3 dark:bg-stone-900">
            <div className="flex items-center gap-2">
              <span>{v.icon}</span>
              <span className="flex-1 text-sm font-medium">
                {k === 'v5' ? 'Вектор (текущая версия)' : 'Классическая на подложке ne2 (фолбэк)'}
              </span>
            </div>
            <p className="mt-1 pl-6 text-[12px] break-all text-stone-500 dark:text-stone-400">
              {v.label} · {r.line}
            </p>
          </div>
        );
      })}

      <button
        onClick={copyReport}
        disabled={!done}
        className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-wine-600 py-3 text-sm font-medium text-white disabled:opacity-50 dark:bg-wine-400 dark:text-stone-950"
      >
        <Copy className="size-4" /> Скопировать полный отчёт
      </button>

      <Toast message={toast} onDone={() => setToast(null)} />
    </div>
  );
}
