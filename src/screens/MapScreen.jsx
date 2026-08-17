import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
// v5 — UMD с единственным default-экспортом (у v6 было наоборот: только named)
import maplibregl from 'maplibre-gl';

const { Map: MapLibreMap, Marker: MapLibreMarker } = maplibregl;
import 'maplibre-gl/dist/maplibre-gl.css';
import { ArrowLeft, MapPinned, Navigation } from 'lucide-react';
import { db } from '../db.js';
import { getScoreMode, wineScore } from '../data/settings.js';
import { usePageTitle } from '../utils/title.js';
import { scoreBadgeClasses } from '../theme.js';
import { pluralize } from '../utils/plural.js';
import WineryBlock from '../components/WineryBlock.jsx';
import WineRow from '../components/WineRow.jsx';

import { FALLBACK_STYLE, LIGHT_STYLE, STYLE_TIMEOUT_MS, darkStyle, simpleStyle } from '../map/styles.js';
import {
  getMapMode,
  getMapRoute,
  getTileLoader,
  makeTransformRequest,
  setMapMode,
  setMapRoute,
  setTileLoader,
} from '../api/mapRoute.js';
import { ensureMainThreadProtocol } from '../map/mtProtocol.js';
import Toast from '../components/Toast.jsx';

const scoreColor = (avg) => (avg >= 8 ? '#059669' : avg >= 5 ? '#d97706' : '#dc2626');

// пунктирное кольцо для approximate-точек (circle-слои не умеют dasharray)
function dashedRingImage(size = 48) {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d');
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 4;
  ctx.setLineDash([5, 4]);
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2 - 4, 0, Math.PI * 2);
  ctx.stroke();
  return ctx.getImageData(0, 0, size, size);
}

const STATUS_LABEL = (w) =>
  w.status === 'cellar'
    ? `в погребе ×${w.quantity}`
    : w.status === 'wishlist'
      ? 'wishlist'
      : 'выпито';

export default function MapScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  usePageTitle('Карта');
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const geojsonRef = useRef({ type: 'FeatureCollection', features: [] });
  const markerRef = useRef(null);
  const flownRef = useRef(false);
  const [mapReady, setMapReady] = useState(false);
  const [mapFailed, setMapFailed] = useState(false); // стиль не загрузился → серый fallback
  const [debugError, setDebugError] = useState(null); // текст ошибки при ?debug=1
  const [toast, setToast] = useState(null);
  const [escStatus, setEscStatus] = useState(null); // «Пробую резервный маршрут… 2/4»
  const retryRef = useRef(null);
  const routeRef = useRef('direct'); // 'direct' | 'proxy' — маршрут тайлов (P21.3)
  const loaderRef = useRef('worker'); // 'worker' | 'main' — загрузчик тайлов (P21.6)
  const modeRef = useRef('full'); // 'full' | 'simple' — режим карты (P21.7)
  const [sheetId, setSheetId] = useState(null);
  const [sheetFull, setSheetFull] = useState(false);
  const [refining, setRefining] = useState(null); // {id, mode:'refine'|'place'}
  const swipeRef = useRef(null);

  // винодельни с координатами и хотя бы одной дегустацией их вин;
  // оценка точки — из wineScore по режиму настроек: «Лучшая» — максимум
  // по винам, иначе — среднее по винам
  const points = useLiveQuery(async () => {
    const mode = await getScoreMode();
    const wineries = await db.wineries
      .filter((w) => w.lat != null && w.lng != null)
      .toArray();
    const result = [];
    for (const winery of wineries) {
      const wines = await db.wines.filter((x) => x.wineryId === winery.id).toArray();
      const wineScores = (
        await Promise.all(wines.map((w) => wineScore(w, mode)))
      ).filter((s) => s != null);
      if (!wineScores.length) continue;
      const avg =
        mode === 'best'
          ? Math.max(...wineScores)
          : wineScores.reduce((a, b) => a + b, 0) / wineScores.length;
      result.push({
        winery,
        wines,
        avg: Math.round(avg * 10) / 10,
        tastedCount: wineScores.length,
      });
    }
    return result;
  });

  const geojson = useMemo(() => {
    const features = (points ?? []).map(({ winery, avg }) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [winery.lng, winery.lat] },
      properties: {
        id: winery.id,
        color: scoreColor(avg),
        approximate: winery.geoStatus === 'approximate',
      },
    }));
    return { type: 'FeatureCollection', features };
  }, [points]);
  geojsonRef.current = geojson;

  // --- карта: слои перевешиваются на каждый style.load; при провале стиля
  // инстанс ПЕРЕСОЗДАЁТСЯ (setStyle поверх упавшего начального стиля MapLibre
  // молча игнорирует — проверено в P21.1) ---
  useEffect(() => {
    let disposed = false;
    let fellBack = false;
    let styleArrived = false; // style.load текущей попытки дошёл
    let styleTimer = null;

    const effectiveStyle = () => {
      const dark = document.documentElement.classList.contains('dark');
      if (modeRef.current === 'simple') return simpleStyle(dark);
      return dark ? darkStyle() : LIGHT_STYLE;
    };

    const addLayers = (map) => {
      if (map.getSource('wineries')) return;
      map.addSource('wineries', {
        type: 'geojson',
        data: geojsonRef.current,
        cluster: true,
        clusterRadius: 50,
      });
      map.addLayer({
        id: 'clusters',
        type: 'circle',
        source: 'wineries',
        filter: ['has', 'point_count'],
        paint: {
          'circle-color': '#5c262d',
          'circle-radius': 16,
          'circle-stroke-width': 2,
          'circle-stroke-color': '#ffffff',
        },
      });
      // число в кластере: только если у стиля есть глифы (fallback их не имеет)
      if (map.getStyle().glyphs) {
        map.addLayer({
          id: 'cluster-count',
          type: 'symbol',
          source: 'wineries',
          filter: ['has', 'point_count'],
          layout: {
            'text-field': ['get', 'point_count_abbreviated'],
            'text-font': ['Noto Sans Regular'],
            'text-size': 13,
          },
          paint: { 'text-color': '#ffffff' },
        });
      }
      map.addLayer({
        id: 'points',
        type: 'circle',
        source: 'wineries',
        filter: ['!', ['has', 'point_count']],
        paint: {
          'circle-color': ['get', 'color'],
          'circle-radius': 8,
          'circle-stroke-width': 2,
          'circle-stroke-color': '#ffffff',
        },
      });
      if (!map.hasImage('dashed-ring')) {
        map.addImage('dashed-ring', dashedRingImage(), { pixelRatio: 2 });
      }
      map.addLayer({
        id: 'points-approximate',
        type: 'symbol',
        source: 'wineries',
        filter: ['all', ['!', ['has', 'point_count']], ['==', ['get', 'approximate'], true]],
        layout: { 'icon-image': 'dashed-ring', 'icon-allow-overlap': true, 'icon-size': 1 },
      });
      setMapReady(true);
    };

    // P21.1: единый путь деградации — сетевой отказ, битый стиль и таймаут.
    // P21.3: первая ступень — переключиться на резервный маршрут через шлюз;
    // если упал уже и он — серый fallback с живыми точками и «Повторить».
    const failToFallback = () => {
      if (fellBack || disposed) return;
      clearTimeout(styleTimer);
      if (routeRef.current === 'direct') {
        routeRef.current = 'proxy';
        setMapRoute('proxy'); // meta запоминает — следующие сессии сразу через шлюз
        setToast('Карта переключена на резервный маршрут');
        armStyleTimeout();
        spawn(effectiveStyle());
        return;
      }
      fellBack = true;
      setMapFailed(true);
      spawn(FALLBACK_STYLE);
    };
    const armStyleTimeout = () => {
      styleArrived = false;
      clearTimeout(styleTimer);
      styleTimer = setTimeout(() => {
        if (!styleArrived && !disposed) failToFallback();
      }, STYLE_TIMEOUT_MS);
    };

    // P21.5–P21.7: вотчдог уровня тайлов — стиль загрузился, но источники
    // не доехали до idle за 12 с. Эскалация: шаг 1 — резервный маршрут
    // (proxy), шаг 2 — загрузка главным потоком (mt://), шаг 3 — упрощённый
    // растровый режим, дальше — баннер «Повторить» без циклов.
    let tileWatchdogTimer = null;
    const escalationStep = () =>
      modeRef.current === 'simple'
        ? 3
        : routeRef.current === 'direct'
          ? 0
          : loaderRef.current === 'worker'
            ? 1
            : 2;
    const armTileWatchdog = (map, styleArg) => {
      if (styleArg === FALLBACK_STYLE) return;
      clearTimeout(tileWatchdogTimer);
      tileWatchdogTimer = setTimeout(() => {
        if (disposed || fellBack || mapRef.current !== map) return;
        // P21.10: критерий залипания — тайлы не доставлены (areTilesLoaded).
        // isSourceLoaded в v5 отстаёт от фактической доставки и эскалировал
        // работающую карту; локальный geojson точек сюда не влияет.
        let stuck = false;
        try {
          stuck = !map.areTilesLoaded();
        } catch {
          stuck = false;
        }
        if (!stuck) return;
        const step = escalationStep();
        if (step === 0) {
          routeRef.current = 'proxy';
          setMapRoute('proxy');
          setToast('Карта переключена на резервный маршрут');
          setEscStatus('Пробую резервный маршрут… 2/4');
        } else if (step === 1) {
          loaderRef.current = 'main';
          setTileLoader('main');
          setToast('Карта переключена в совместимый режим');
          setEscStatus('Пробую совместимый режим… 3/4');
        } else if (step === 2) {
          modeRef.current = 'simple';
          setMapMode('simple');
          setToast('Карта в классическом режиме');
          setEscStatus('Классический режим… 4/4');
        } else {
          // все ступени исчерпаны — честный баннер, карта остаётся как есть
          setEscStatus(null);
          setMapFailed(true);
          return;
        }
        armStyleTimeout();
        spawn(effectiveStyle());
      }, 12_000);
      map.on('idle', () => {
        clearTimeout(tileWatchdogTimer);
        setEscStatus(null); // дорисовалась — статус эскалации больше не нужен
      });
    };

    // создать (или пересоздать) инстанс карты с данным стилем
    const spawn = (styleArg) => {
      const prev = mapRef.current;
      const view = prev ? { center: prev.getCenter(), zoom: prev.getZoom() } : null;
      markerRef.current?.remove();
      markerRef.current = null;
      prev?.remove();
      setMapReady(false);

      const map = new MapLibreMap({
        container: containerRef.current,
        style: styleArg,
        center: view?.center ?? [15, 46],
        zoom: view?.zoom ?? 3.2,
        attributionControl: { compact: true }, // атрибуция OSM/OpenFreeMap обязательна
        // proxy: запросы через шлюз; main: Tile/Glyphs через mt:// (P21.6)
        transformRequest: makeTransformRequest(routeRef, loaderRef),
      });
      mapRef.current = map;
      if (import.meta.env.DEV) window.__map = map; // для консольной отладки

      map.on('style.load', () => {
        styleArrived = true;
        clearTimeout(styleTimer);
        addLayers(map);
        armTileWatchdog(map, styleArg);
      });
      map.on('error', (e) => {
        const msg = String(e.error?.message ?? e.error ?? 'map error');
        console.error('[map]', msg);
        if (new URLSearchParams(window.location.search).has('debug')) setDebugError(msg);
        // ошибка уровня стиля до его загрузки → сразу fallback, не ждём таймаут
        if (!fellBack && !styleArrived && /style|Failed to fetch|NetworkError|AJAXError/i.test(msg)) {
          failToFallback();
        }
      });

      map.on('click', 'clusters', async (e) => {
        const feature = e.features[0];
        const zoom = await map.getSource('wineries').getClusterExpansionZoom(feature.properties.cluster_id);
        map.easeTo({ center: feature.geometry.coordinates, zoom: zoom + 0.5 });
      });
      map.on('click', 'points', (e) => {
        const id = e.features[0].properties.id;
        setSheetFull(false);
        setSheetId(id);
        map.easeTo({ center: e.features[0].geometry.coordinates, padding: { bottom: 260 } });
      });
      map.on('mouseenter', 'points', () => (map.getCanvas().style.cursor = 'pointer'));
      map.on('mouseleave', 'points', () => (map.getCanvas().style.cursor = ''));

      armStyleTimeout(); // fallback-JSON загрузится мгновенно и снимет таймер
      return map;
    };

    // «Повторить»: свежий инстанс с настоящим стилем текущей темы
    retryRef.current = () => {
      if (disposed) return;
      fellBack = false;
      setMapFailed(false);
      spawn(effectiveStyle());
    };

    // маршрут, загрузчик и режим карты читаются из meta ДО первого spawn
    ensureMainThreadProtocol();
    (async () => {
      // P21.10: одноразовая миграция после возврата вектора (maplibre v5) —
      // выставленные эскалацией P21.5–P21.8 обходы сбрасываются в дефолты;
      // если вектор всё ещё мёртв, лесенка вотчдога вернёт всё сама
      const migrated = await db.meta.get('v5MigrationDone');
      if (!migrated) {
        await db.meta.put({ key: 'v5MigrationDone', value: true });
        if ((await getMapMode()) !== 'full' || (await getMapRoute()) !== 'direct') {
          await Promise.all([setMapMode('full'), setMapRoute('direct'), setTileLoader('worker')]);
          setToast('Карта обновлена — пробую полный режим');
        }
      }
      const [route, loader, mode] = await Promise.all([getMapRoute(), getTileLoader(), getMapMode()]);
      routeRef.current = route;
      loaderRef.current = loader;
      modeRef.current = mode;
      if (!disposed) spawn(effectiveStyle());
    })();

    // переключение темы вживую: событие от applyTheme (настройка или ОС)
    const onTheme = () => {
      if (fellBack || disposed) return;
      armStyleTimeout();
      mapRef.current?.setStyle(effectiveStyle());
    };
    window.addEventListener('themechange', onTheme);

    return () => {
      disposed = true;
      clearTimeout(styleTimer);
      clearTimeout(tileWatchdogTimer);
      window.removeEventListener('themechange', onTheme);
      markerRef.current?.remove();
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  // реактивные данные: setData без пересоздания карты
  useEffect(() => {
    const map = mapRef.current;
    if (map && mapReady && map.getSource('wineries')) {
      map.getSource('wineries').setData(geojson);
    }
  }, [geojson, mapReady]);

  // flyTo из карточки вина
  useEffect(() => {
    const target = location.state?.wineryId;
    if (!target || !mapReady || flownRef.current || !points) return;
    const entry = points.find((p) => p.winery.id === target);
    if (!entry) return;
    flownRef.current = true;
    mapRef.current.flyTo({
      center: [entry.winery.lng, entry.winery.lat],
      zoom: 9,
      padding: { bottom: 260 },
    });
    setSheetId(target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, points, location.state?.wineryId]);

  // установка маркера для manual_needed (из карточки вина)
  useEffect(() => {
    const target = location.state?.placeWineryId;
    if (!target || !mapReady || flownRef.current) return;
    flownRef.current = true;
    startPlacing(target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, location.state?.placeWineryId]);

  const entry = sheetId ? points?.find((p) => p.winery.id === sheetId) : null;

  // --- уточнение/установка положения -------------------------------------------
  const startRefine = () => {
    const map = mapRef.current;
    const { winery } = entry;
    setSheetId(null);
    setRefining({ id: winery.id, mode: 'refine' });
    const marker = new MapLibreMarker({ draggable: true, color: '#722F37' })
      .setLngLat([winery.lng, winery.lat])
      .addTo(map);
    markerRef.current = marker;
    map.easeTo({ center: [winery.lng, winery.lat], zoom: Math.max(map.getZoom(), 10) });
  };

  // manual_needed из карточки вина: маркер в центре видимой области
  const startPlacing = (wineryId) => {
    const map = mapRef.current;
    setRefining({ id: wineryId, mode: 'place' });
    const marker = new MapLibreMarker({ draggable: true, color: '#722F37' })
      .setLngLat(map.getCenter())
      .addTo(map);
    markerRef.current = marker;
  };

  const finishRefine = async (save) => {
    const marker = markerRef.current;
    const { id } = refining;
    if (save && marker) {
      const { lng, lat } = marker.getLngLat();
      await db.wineries.update(id, {
        lat,
        lng,
        geoStatus: 'manual',
        needsGeocode: false,
        updatedAt: new Date().toISOString(),
      });
    }
    marker?.remove();
    markerRef.current = null;
    setRefining(null);
    if (save) setSheetId(id);
    else if (refining.mode === 'refine') setSheetId(id);
  };

  // свайпы шита: вверх — на весь экран, вниз — свернуть/закрыть
  const onSheetTouchStart = (e) => {
    swipeRef.current = e.touches[0].clientY;
  };
  const onSheetTouchEnd = (e) => {
    if (swipeRef.current == null) return;
    const dy = e.changedTouches[0].clientY - swipeRef.current;
    swipeRef.current = null;
    if (dy < -50) setSheetFull(true);
    else if (dy > 50) {
      if (sheetFull) setSheetFull(false);
      else setSheetId(null);
    }
  };

  return (
    <div className="fixed inset-0">
      <div ref={containerRef} className="h-full w-full" />

      {/* Шапка поверх карты */}
      <header className="absolute top-0 right-0 left-0 flex items-center justify-between bg-gradient-to-b from-stone-50/95 to-transparent px-2 pt-2 pb-6 dark:from-stone-950/95">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-1 rounded-lg bg-white/80 px-3 py-2 text-sm font-medium text-wine-600 backdrop-blur dark:bg-stone-900/80 dark:text-wine-400"
        >
          <ArrowLeft className="size-4" /> Карта виноделен
        </button>
        {points && (
          <span className="rounded-full bg-white/80 px-2.5 py-1 text-xs text-stone-600 backdrop-blur dark:bg-stone-900/80 dark:text-stone-300">
            {points.length} {pluralize(points.length, 'винодельня', 'винодельни', 'виноделен')} ·{' '}
            {points.reduce((a, p) => a + p.tastedCount, 0)}{' '}
            {pluralize(points.reduce((a, p) => a + p.tastedCount, 0), 'вино', 'вина', 'вин')}{' '}
            продегустировано
          </span>
        )}
      </header>

      {mapFailed && (
        <div className="absolute top-14 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full bg-amber-100 py-1 pr-1 pl-3 text-[12px] whitespace-nowrap text-amber-800 dark:bg-amber-950 dark:text-amber-200">
          Не удалось загрузить карту
          <button
            onClick={() => navigate('/map-check')}
            className="rounded-full px-1.5 py-1 font-medium underline"
          >
            Проверить
          </button>
          <button
            onClick={() => retryRef.current?.()}
            className="rounded-full bg-amber-600 px-2.5 py-1 font-medium text-white"
          >
            Повторить
          </button>
        </div>
      )}
      {debugError && (
        <p className="absolute top-24 left-1/2 max-w-[90%] -translate-x-1/2 truncate rounded-lg bg-red-600/90 px-3 py-1.5 text-[11px] text-white">
          {debugError}
        </p>
      )}

      {/* P21.8: статус эскалации — владелец видит, что процесс идёт */}
      {escStatus && !mapFailed && (
        <p className="absolute top-14 left-1/2 -translate-x-1/2 animate-pulse rounded-full bg-stone-900/80 px-3 py-1.5 text-[12px] whitespace-nowrap text-white">
          {escStatus}
        </p>
      )}

      <Toast message={toast} onDone={() => setToast(null)} />

      {/* Пустое состояние */}
      {points?.length === 0 && (
        <div className="absolute inset-0 grid place-items-center px-10">
          <div className="rounded-2xl bg-white/90 p-4 text-center text-sm text-stone-600 backdrop-blur dark:bg-stone-900/90 dark:text-stone-300">
            <MapPinned className="mx-auto mb-2 size-8 text-wine-600 dark:text-wine-400" />
            Карта наполняется сама: продегустируй вино — его винодельня появится точкой
          </div>
        </div>
      )}

      {/* Режим уточнения/установки */}
      {refining && (
        <div className="absolute right-4 bottom-6 left-4 rounded-xl bg-white p-3 shadow-lg dark:bg-stone-900">
          <p className="text-sm">
            {refining.mode === 'place'
              ? 'Поставь маркер на винодельню и подтверди'
              : 'Перетащи маркер на точное место и подтверди'}
          </p>
          <div className="mt-2 flex gap-2">
            <button
              onClick={() => finishRefine(true)}
              className="flex-1 rounded-lg bg-wine-600 py-2 text-sm font-medium text-white dark:bg-wine-400 dark:text-stone-950"
            >
              Готово
            </button>
            <button
              onClick={() => finishRefine(false)}
              className="flex-1 rounded-lg border border-stone-300 py-2 text-sm dark:border-stone-600"
            >
              Отмена
            </button>
          </div>
        </div>
      )}

      {/* Шит винодельни поверх живой карты */}
      {entry && !refining && (
        <div
          className={`absolute right-0 bottom-0 left-0 mx-auto max-w-[480px] rounded-t-2xl bg-white shadow-[0_-4px_20px_rgba(0,0,0,0.15)] transition-[height] duration-200 dark:bg-stone-900 ${
            sheetFull ? 'h-[92dvh]' : 'h-[45dvh]'
          }`}
          onTouchStart={onSheetTouchStart}
          onTouchEnd={onSheetTouchEnd}
        >
          <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-stone-300 dark:bg-stone-700" />
          <div className="h-[calc(100%-1rem)] overflow-y-auto px-4 pt-2 pb-6">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h2 className="truncate text-base font-semibold">{entry.winery.name}</h2>
                <p className="text-[13px] text-stone-500 dark:text-stone-400">
                  {[entry.winery.region, entry.winery.country].filter(Boolean).join(' · ')}
                </p>
              </div>
              <span
                className={`shrink-0 rounded-full px-2.5 py-1 text-sm font-bold ${scoreBadgeClasses(entry.avg)}`}
              >
                {entry.avg.toFixed(1)}
              </span>
            </div>

            {entry.winery.geoStatus === 'approximate' && (
              <button
                onClick={startRefine}
                className="mt-2 w-full rounded-lg bg-amber-100 px-3 py-2 text-left text-[13px] text-amber-800 dark:bg-amber-950 dark:text-amber-200"
              >
                📍 Положение приблизительное (центр региона) ·{' '}
                <span className="font-medium underline">Уточнить</span>
              </button>
            )}

            <a
              href={`geo:${entry.winery.lat},${entry.winery.lng}?q=${encodeURIComponent(entry.winery.name)}`}
              className="mt-2.5 flex items-center gap-2 rounded-lg border border-stone-200 px-3 py-2.5 text-sm font-medium text-wine-700 dark:border-stone-700 dark:text-wine-200"
            >
              <Navigation className="size-4" /> Маршрут
            </a>

            <div className="mt-3">
              <WineryBlock wineryId={entry.winery.id} defaultOpen={false} plain />
            </div>

            <h3 className="mt-4 mb-1.5 text-sm font-medium text-stone-500 dark:text-stone-400">
              Твои вина отсюда · {entry.wines.length}
            </h3>
            <div className="space-y-1.5">
              {entry.wines.map((w) => (
                <WineRow key={w.id} wine={w} subtitle={STATUS_LABEL(w)} />
              ))}
            </div>
            {entry.wines.length > entry.tastedCount && (
              <p className="mt-2 text-[12px] text-stone-400 dark:text-stone-500">
                ещё {entry.wines.length - entry.tastedCount}{' '}
                {pluralize(entry.wines.length - entry.tastedCount, 'вино', 'вина', 'вин')} не
                пробовано
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
