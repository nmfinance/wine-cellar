import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Map as MapLibreMap } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { ArrowLeft, Check, Copy, X } from 'lucide-react';
import { PROBE_TILE, effectiveStyleUrl } from '../map/styles.js';
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
  { id: 'tileNoSw', name: '3 · Тайл в обход Service Worker' },
  { id: 'webgl', name: '4 · WebGL' },
  { id: 'minimap', name: '5 · Мини-карта (полная отрисовка)' },
];

export default function MapCheckScreen() {
  const navigate = useNavigate();
  usePageTitle('Диагностика карты');
  const [results, setResults] = useState({}); // id → {ok, detail}
  const [running, setRunning] = useState(true);
  const [toast, setToast] = useState(null);
  const miniRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    const set = (id, res) => {
      if (!cancelled) setResults((r) => ({ ...r, [id]: res }));
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

      // 5 · интегральный: мини-карта дорисовалась до idle за 15 с?
      try {
        const t0 = performance.now();
        const map = new MapLibreMap({
          container: miniRef.current,
          style: effectiveStyleUrl(),
          center: [9.19, 45.46], // Милан — там же, где пробный тайл
          zoom: 10,
          attributionControl: false,
          interactive: false,
        });
        const errors = [];
        map.on('error', (e) => errors.push(String(e.error?.message ?? e.error)));
        const verdict = await new Promise((resolve) => {
          const timer = setTimeout(() => {
            // детали на момент таймаута — что успело, что нет
            let facts = [];
            try {
              facts.push(`стиль: ${map.style?._loaded ? 'загружен' : 'НЕ загружен'}`);
              facts.push(`тайлы: ${map.areTilesLoaded() ? 'загружены' : 'НЕ загружены'}`);
            } catch {}
            if (errors.length) facts.push(`ошибки: ${errors.slice(0, 2).join('; ')}`);
            else facts.push('ошибок нет (молча)');
            resolve({ ok: false, detail: `не дорисовалась за 15 с · ${facts.join(' · ')}` });
          }, 15_000);
          map.on('idle', () => {
            clearTimeout(timer);
            resolve({ ok: true, detail: `отрисована за ${Math.round(performance.now() - t0)} мс` });
          });
        });
        set('minimap', verdict);
        if (cancelled) map.remove();
        else setTimeout(() => map.remove(), 500);
      } catch (e) {
        set('minimap', { ok: false, detail: `${e.name}: ${e.message}` });
      }

      if (!cancelled) setRunning(false);
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const copyReport = async () => {
    const lines = [
      `Диагностика карты · ${new Date().toISOString()}`,
      `UA: ${navigator.userAgent}`,
      `Тема: ${document.documentElement.classList.contains('dark') ? 'тёмная' : 'светлая'} · онлайн: ${navigator.onLine}`,
      '',
      ...TESTS.map((t) => {
        const r = results[t.id];
        return `${r ? (r.ok ? 'OK ' : 'FAIL') : '...'} · ${t.name}: ${r?.detail ?? 'не выполнялся'}`;
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

      {/* контейнер мини-карты — виден, это часть теста */}
      <div
        ref={miniRef}
        className="mt-3 h-[200px] w-full overflow-hidden rounded-xl bg-stone-200 dark:bg-stone-800"
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
