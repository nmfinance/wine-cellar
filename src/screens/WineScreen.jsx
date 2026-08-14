import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronRight,
  Heart,
  MapPin,
  Pencil,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  Wine,
} from 'lucide-react';
import { db } from '../db.js';
import { deleteWineCascade, moveTo, updateWine } from '../data/wines.js';
import { lookupVivinoCached, refreshVivino } from '../api/vivino.js';
import { matchScore } from '../api/score.js';
import { ensureDeepInfo } from '../data/deep.js';
import { refreshWineryInfo } from '../data/wineries.js';
import { getScoreMode } from '../data/settings.js';
import { PLACEHOLDER_BY_COLOR, formatPrice, scoreBadgeClasses } from '../theme.js';
import PhotoLightbox from '../components/PhotoLightbox.jsx';
import Toast from '../components/Toast.jsx';
import WineryBlock from '../components/WineryBlock.jsx';

const COLOR_LABEL = { red: 'Красное', white: 'Белое', rose: 'Розовое', orange: 'Оранжевое' };
const SWEET_LABEL = { dry: 'сухое', semidry: 'полусухое', semisweet: 'полусладкое', sweet: 'сладкое' };
const PLACE_LABEL = { home: 'дома', restaurant: 'в ресторане', guests: 'в гостях' };

const fmtDate = (iso) =>
  iso
    ? new Date(iso)
        .toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
        .replace(' г.', '')
    : null;

const plural = (n, one, few, many) => {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
};

// --- Фото-галерея: свайп со scroll-snap и точками ---------------------------

function PhotoGallery({ wine }) {
  const photos = useLiveQuery(
    () => db.photos.where('wineId').equals(wine.id).sortBy('order'),
    [wine.id]
  );
  const [urls, setUrls] = useState([]);
  const [active, setActive] = useState(0);
  const [lightbox, setLightbox] = useState(null); // индекс открытого фото
  const scrollRef = useRef(null);

  useEffect(() => {
    if (!photos?.length) {
      setUrls([]);
      return;
    }
    const list = photos.map((p) => URL.createObjectURL(p.blob));
    setUrls(list);
    return () => list.forEach((u) => URL.revokeObjectURL(u));
  }, [photos]);

  const placeholder = PLACEHOLDER_BY_COLOR[wine.color] ?? PLACEHOLDER_BY_COLOR.red;

  if (urls.length === 0) {
    return (
      <div
        className="mx-4 grid h-[170px] place-items-center rounded-xl"
        style={{ background: placeholder.bg }}
      >
        <Wine className="size-14" style={{ color: placeholder.icon }} strokeWidth={1.25} />
      </div>
    );
  }

  return (
    <div className="relative mx-4">
      <div
        ref={scrollRef}
        onScroll={() => {
          const el = scrollRef.current;
          setActive(Math.round(el.scrollLeft / el.clientWidth));
        }}
        className="flex h-[170px] snap-x snap-mandatory overflow-x-auto rounded-xl [scrollbar-width:none]"
      >
        {urls.map((u, i) => (
          <img
            key={i}
            src={u}
            alt=""
            onClick={() => setLightbox(i)}
            className="h-full w-full flex-none cursor-zoom-in snap-center object-cover"
          />
        ))}
      </div>
      {urls.length > 1 && (
        <div className="absolute bottom-2 left-1/2 flex -translate-x-1/2 gap-1">
          {urls.map((_, i) => (
            <span
              key={i}
              className={`size-1.5 rounded-full ${i === active ? 'bg-white' : 'bg-white/50'}`}
            />
          ))}
        </div>
      )}
      {lightbox != null && (
        <PhotoLightbox urls={urls} start={lightbox} onClose={() => setLightbox(null)} />
      )}
    </div>
  );
}

// --- Тайл атрибута -----------------------------------------------------------

function Tile({ label, wide = false, muted = false, warn = false, children }) {
  return (
    <div
      className={`relative rounded-lg bg-white p-3 dark:bg-stone-900 ${wide ? 'col-span-2' : ''}`}
    >
      {warn && (
        <span
          title="AI не был уверен"
          className="absolute top-2 right-2 size-2 rounded-full bg-amber-400"
        />
      )}
      <p className="text-[11px] text-stone-400 dark:text-stone-500">{label}</p>
      <p
        className={`mt-0.5 text-sm whitespace-pre-line ${
          muted ? 'text-stone-400 dark:text-stone-500' : 'text-stone-900 dark:text-stone-100'
        }`}
      >
        {children}
      </p>
    </div>
  );
}

// --- Вкусовой профиль: 4 шкалы с точкой -------------------------------------

const TASTE_SCALES = [
  ['body', 'Лёгкое', 'Полнотелое'],
  ['tannin', 'Мягкие танины', 'Крепкие'],
  ['acidity', 'Низкая кислотность', 'Высокая'],
  ['sweetness', 'Сухое', 'Сладкое'],
];

function TasteProfile({ taste, source }) {
  const rows = TASTE_SCALES.filter(([key]) => taste?.[key] != null);
  if (!rows.length) return null;
  return (
    <div className="mx-4 mt-4 rounded-xl bg-white p-3 dark:bg-stone-900">
      <div className="flex items-baseline justify-between">
        <p className="text-sm font-medium">Вкусовой профиль</p>
        <p className="text-[11px] text-stone-400 dark:text-stone-500">{source}</p>
      </div>
      <div className="mt-2.5 space-y-3">
        {rows.map(([key, left, right]) => (
          <div key={key}>
            <div className="flex justify-between text-[11px] text-stone-400 dark:text-stone-500">
              <span>{left}</span>
              <span>{right}</span>
            </div>
            <div className="relative mt-1 h-1 rounded-full bg-stone-200 dark:bg-stone-700">
              <span
                className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-wine-600 dark:bg-wine-400"
                style={{ left: `${taste[key]}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// --- Блок «Глубже о вине» (S6) ------------------------------------------------

function DeepBlock({ wine, defaultOpen }) {
  const [open, setOpen] = useState(defaultOpen);
  const deep = wine.aiDeep;
  // блок показываем, если данные есть или их имеет смысл ждать
  const expectable = wine.grapes?.length || wine.region || wine.appellation;
  if (!deep && !expectable) return null;

  return (
    <div className="mx-4 mt-4 rounded-xl bg-wine-100 p-3 dark:bg-wine-900">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 text-left"
      >
        <span className="flex items-center gap-1.5 text-sm font-medium text-wine-700 dark:text-wine-200">
          <Sparkles className="size-4" /> Глубже о вине
        </span>
        <ChevronDown
          className={`size-4 shrink-0 text-wine-400 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div className="mt-2 space-y-2.5">
          {!deep ? (
            <p className="animate-pulse text-sm text-stone-500 dark:text-stone-400">
              изучаю вино…
            </p>
          ) : (
            <>
              {deep.story && (
                <p className="text-sm text-stone-700 dark:text-stone-300">{deep.story}</p>
              )}
              {deep.fun_fact && (
                <p className="rounded-lg bg-white/60 px-3 py-2 text-sm text-stone-700 dark:bg-stone-950/30 dark:text-stone-300">
                  💡 {deep.fun_fact}
                </p>
              )}
              {deep.sommelier_tips?.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-wine-700 dark:text-wine-200">
                    На что обратить внимание
                  </p>
                  <ul className="mt-1 list-disc space-y-0.5 pl-4 text-sm text-stone-700 dark:text-stone-300">
                    {deep.sommelier_tips.map((tip, i) => (
                      <li key={i}>{tip}</li>
                    ))}
                  </ul>
                </div>
              )}
              {deep.image_association && (
                <p className="text-sm text-stone-500 italic dark:text-stone-400">
                  {deep.image_association}
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// --- Ручной поиск Vivino в карточке -------------------------------------------

function VivinoInlineSearch({ wine, onDone }) {
  const [query, setQuery] = useState(
    [wine.wineryName, wine.name].filter(Boolean).join(' ').trim()
  );
  const [busy, setBusy] = useState(false);
  const [miss, setMiss] = useState(null);

  const search = async () => {
    setBusy(true);
    setMiss(null);
    const res = await lookupVivinoCached(query.trim(), wine.nvFlag ? null : wine.year);
    setBusy(false);
    if (res.ok) {
      const score = matchScore(query, res.data.matchedName);
      await updateWine(wine.id, {
        vivino: {
          ...res.data,
          matchScore: score,
          checkedAt: new Date().toISOString(),
          manual: false,
        },
      });
      onDone?.();
    } else {
      setMiss(res.error === 'not_found' ? 'На Vivino не нашлось' : 'Vivino временно недоступен');
    }
  };

  return (
    <div className="mt-2">
      <div className="flex gap-1.5">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="h-9 w-full rounded-lg border border-stone-200 bg-white px-3 text-sm outline-none focus:border-wine-400 dark:border-stone-700 dark:bg-stone-800"
          placeholder="winery название сорт"
        />
        <button
          onClick={search}
          disabled={busy}
          aria-label="Найти"
          className="grid size-9 shrink-0 place-items-center rounded-lg bg-wine-600 text-white disabled:opacity-50 dark:bg-wine-400 dark:text-stone-950"
        >
          <Search className="size-4" />
        </button>
      </div>
      {busy && <p className="mt-1 animate-pulse text-[11px] text-stone-400">ищу на Vivino…</p>}
      {miss && <p className="mt-1 text-[11px] text-stone-400">{miss}</p>}
    </div>
  );
}

// --- Экран -------------------------------------------------------------------

export default function WineScreen() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [toast, setToast] = useState(null);
  // баннер свежего скана: 'history' | 'cellar' | 'wishlist' | null; гаснет при уходе
  const [scanBanner, setScanBanner] = useState(null);
  const [vivinoSearchOpen, setVivinoSearchOpen] = useState(false);

  // тост «Сохранено» после возврата из формы / флаг свежего скана
  useEffect(() => {
    if (location.state?.toast) setToast(location.state.toast);
    if (location.state?.scanned) setScanBanner('history');
    if (location.state) {
      navigate(location.pathname + location.search, { replace: true, state: null });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // «📍 {Винодельня} появилась на карте» — после фонового геокодинга
  useEffect(() => {
    const onGeo = (e) => setToast(`📍 ${e.detail.name} появилась на карте`);
    window.addEventListener('winery-geocoded', onGeo);
    return () => window.removeEventListener('winery-geocoded', onGeo);
  }, []);

  const wine = useLiveQuery(() => db.wines.get(id).then((w) => w ?? null), [id]);
  const scoreMode = useLiveQuery(getScoreMode) ?? 'last';
  const tastings = useLiveQuery(
    () =>
      db.tastings
        .where('wineId')
        .equals(id)
        .sortBy('date')
        .then((arr) => arr.reverse()),
    [id]
  );
  const rack = useLiveQuery(
    () => (wine?.location?.rackId ? db.racks.get(wine.location.rackId) : null),
    [wine?.location?.rackId]
  );

  // S6 для вин без aiDeep (ручные с сортом/регионом) — при первом открытии
  useEffect(() => {
    if (wine && !wine.aiDeep) ensureDeepInfo(wine);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wine?.id, wine?.aiDeep]);

  // состояние винодельни для строки карты:
  // point — есть точка; manual — дегустации есть, координат нет; none — иначе
  const mapState = useLiveQuery(async () => {
    if (!wine?.wineryId) return { mode: 'none' };
    const w = await db.wineries.get(wine.wineryId);
    if (!w) return { mode: 'none' };
    const wineIds = (await db.wines.filter((x) => x.wineryId === w.id).toArray()).map((x) => x.id);
    const tasted = await db.tastings.filter((t) => wineIds.includes(t.wineId)).count();
    if (!tasted) return { mode: 'none' };
    return w.lat != null && w.lng != null
      ? { mode: 'point', wineryId: w.id }
      : { mode: 'manual', wineryId: w.id };
  }, [wine?.wineryId]);
  const mapPointId = mapState?.mode === 'point' ? mapState.wineryId : null;

  const [vivinoRefreshing, setVivinoRefreshing] = useState(false);

  if (wine === undefined) return null;
  if (wine === null) {
    return (
      <div className="px-4 py-5">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-1 text-sm font-medium text-wine-600 dark:text-wine-400"
        >
          <ArrowLeft className="size-4" /> Назад
        </button>
        <p className="mt-10 text-center text-sm text-stone-500">Вино не найдено</p>
      </div>
    );
  }

  const lastTasting = tastings?.[0] ?? null;
  // «моя оценка» по режиму из настроек; tastings отсортированы date desc,
  // поэтому «последняя» — tastings[0]
  const scores = (tastings ?? []).map((t) => t.totalScore ?? 0);
  const myScore = !scores.length
    ? null
    : scoreMode === 'best'
      ? Math.max(...scores)
      : scoreMode === 'avg'
        ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10
        : (lastTasting?.totalScore ?? 0);
  const isWishlist = wine.status === 'wishlist';

  const onHeart = () => moveTo(wine.id, isWishlist ? 'cellar' : 'wishlist');

  const onDelete = async () => {
    const n = tastings?.length ?? 0;
    const q = `Удалить вино и ${n} ${plural(n, 'дегустацию', 'дегустации', 'дегустаций')}? Это необратимо`;
    if (!window.confirm(q)) return;
    await deleteWineCascade(wine.id);
    navigate('/');
  };

  const onBuy = async () => {
    await moveTo(wine.id, 'cellar');
    await updateWine(wine.id, { quantity: 1 });
    setToast('В погребе! Количество и место поправь в редактировании');
  };

  const isHistory = wine.status === 'history';

  // заголовочная строка: «Винодельня · Аппелласьон, Регион · Страна»
  const originLine = [
    wine.wineryName,
    [wine.appellation, wine.region].filter(Boolean).join(', '),
    wine.country,
  ]
    .filter(Boolean)
    .join(' · ');

  // Vivino
  const vivino = wine.vivino;
  const vivinoSource = (() => {
    if (!vivino) return null;
    if (vivino.source === 'vintage') return 'этот винтаж';
    if (vivino.source === 'nearby_vintage') {
      if (vivino.matchedYear) return `винтаж ${vivino.matchedYear}`;
      const y = vivino.matchedName?.match(/\b(19|20)\d{2}\b/);
      return y ? `винтаж ${y[0]}` : 'соседний винтаж';
    }
    return 'все годы';
  })();
  const vivinoCheck = vivino?.matchScore === 'medium';

  // атрибуты
  const grapesValue = wine.grapes?.length
    ? wine.grapes
        .map((g) => (g.percent != null ? `${g.name} ${g.percent}%` : g.name))
        .join('\n')
    : null;

  const stockValue = (() => {
    if (isWishlist) return 'Хочу купить';
    if (wine.status === 'history')
      return `Выпито${wine.historyAt ? ` · ${fmtDate(wine.historyAt)}` : ''}`;
    const parts = [`${wine.quantity} бут.`];
    if (wine.location && rack) parts.push(`${rack.name}, полка ${wine.location.shelf}`);
    else if (wine.locationFreeText) parts.push(wine.locationFreeText);
    return parts.join(' · ');
  })();

  const price = formatPrice(wine.price, wine.currency);

  const lowConf = (key) => wine.confidence?.[key] === 'low';
  const taste = vivino?.taste ?? wine.aiReference?.taste_profile ?? null;
  const tasteSource = vivino?.taste ? 'по данным Vivino' : 'оценка AI';
  const priceRf = wine.aiReference?.price_rf_estimate;
  const buyQuery = [wine.wineryName, wine.name, wine.nvFlag ? null : wine.year, 'купить']
    .filter(Boolean)
    .join(' ');

  const moveFromBanner = async (target) => {
    await moveTo(wine.id, target);
    if (target === 'cellar') await updateWine(wine.id, { quantity: 1 });
    setScanBanner(target);
  };

  // «обновить данные Vivino» — повторный lookup мимо кэша
  const onRefreshVivino = async () => {
    setVivinoRefreshing(true);
    const query = [wine.wineryName, wine.name].filter(Boolean).join(' ').trim();
    const res = await refreshVivino(query, wine.nvFlag ? null : wine.year);
    if (res.ok) {
      const score = matchScore(query, res.data.matchedName);
      await updateWine(wine.id, {
        vivino: { ...res.data, matchScore: score, checkedAt: new Date().toISOString(), manual: false },
      });
      setToast('Данные Vivino обновлены');
    } else {
      setToast(res.error === 'not_found' ? 'На Vivino не нашлось' : 'Vivino недоступен');
    }
    setVivinoRefreshing(false);
  };

  return (
    <div className="flex min-h-dvh flex-col">
      {/* Шапка */}
      <header className="sticky top-0 z-10 flex items-center justify-between bg-stone-50/95 px-2 py-2 backdrop-blur dark:bg-stone-950/95">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-1 rounded-lg px-2 py-2 text-sm font-medium text-wine-600 dark:text-wine-400"
        >
          <ArrowLeft className="size-4" /> Назад
        </button>
        <div className="flex items-center">
          <button
            onClick={() => navigate(`/wine/${wine.id}/edit`)}
            aria-label="Редактировать"
            className="grid size-10 place-items-center rounded-lg text-stone-500 dark:text-stone-400"
          >
            <Pencil className="size-5" />
          </button>
          <button
            onClick={onHeart}
            aria-label={isWishlist ? 'Убрать из wishlist' : 'В wishlist'}
            className={`grid size-10 place-items-center rounded-lg ${
              isWishlist ? 'text-wine-600 dark:text-wine-400' : 'text-stone-500 dark:text-stone-400'
            }`}
          >
            <Heart className="size-5" fill={isWishlist ? 'currentColor' : 'none'} />
          </button>
          <button
            onClick={onDelete}
            aria-label="Удалить"
            className="grid size-10 place-items-center rounded-lg text-stone-500 dark:text-stone-400"
          >
            <Trash2 className="size-5" />
          </button>
        </div>
      </header>

      {/* Баннер свежего скана */}
      {scanBanner && (
        <div className="mx-4 mb-2 rounded-xl bg-emerald-50 p-3 dark:bg-emerald-950">
          <p className="flex items-center gap-1.5 text-sm font-medium text-emerald-800 dark:text-emerald-200">
            <Check className="size-4" />
            {scanBanner === 'history' && 'Распознано и сохранено в Историю'}
            {scanBanner === 'cellar' && 'В погребе'}
            {scanBanner === 'wishlist' && 'В Wishlist'}
          </p>
          {scanBanner === 'history' && (
            <div className="mt-2 flex gap-1.5">
              <button
                onClick={() => moveFromBanner('cellar')}
                className="flex-1 rounded-lg bg-wine-600 py-2 text-[13px] font-medium text-white dark:bg-wine-400 dark:text-stone-950"
              >
                В погреб
              </button>
              <button
                onClick={() => moveFromBanner('wishlist')}
                className="flex-1 rounded-lg border border-stone-300 py-2 text-[13px] font-medium text-stone-700 dark:border-stone-600 dark:text-stone-300"
              >
                В Wishlist
              </button>
              <button
                onClick={() => navigate(`/wine/${wine.id}/edit`)}
                className="flex-1 rounded-lg border border-stone-300 py-2 text-[13px] font-medium text-stone-700 dark:border-stone-600 dark:text-stone-300"
              >
                Изменить
              </button>
            </div>
          )}
        </div>
      )}

      <PhotoGallery wine={wine} />

      {/* Заголовочный блок */}
      <div className="px-4 pt-4">
        <h1 className="line-clamp-2 text-lg leading-snug font-medium">{wine.name}</h1>
        {originLine && (
          <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">{originLine}</p>
        )}
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          {tastings !== undefined &&
            (myScore != null ? (
              <span
                className={`rounded-full px-2.5 py-1 text-xs font-semibold ${scoreBadgeClasses(myScore)}`}
              >
                Моя {myScore.toFixed(1)}
              </span>
            ) : (
              <span className="rounded-full border border-dashed border-stone-400 px-2.5 py-1 text-xs text-stone-500 dark:border-stone-500 dark:text-stone-400">
                не пробовал
              </span>
            ))}
          <span className="rounded-full bg-stone-200 px-2.5 py-1 text-xs text-stone-700 dark:bg-stone-800 dark:text-stone-300">
            {[COLOR_LABEL[wine.color], SWEET_LABEL[wine.sweetness]].filter(Boolean).join(' ')}
          </span>
          {wine.sparkling && (
            <span className="rounded-full bg-stone-200 px-2.5 py-1 text-xs text-stone-700 dark:bg-stone-800 dark:text-stone-300">
              игристое
            </span>
          )}
          {wine.fortified && (
            <span className="rounded-full bg-stone-200 px-2.5 py-1 text-xs text-stone-700 dark:bg-stone-800 dark:text-stone-300">
              креплёное
            </span>
          )}
        </div>
      </div>

      {/* Vivino */}
      {vivino && (
        <div
          className={`mx-4 mt-4 rounded-xl bg-white p-3 dark:bg-stone-900 ${
            vivinoCheck ? 'border border-amber-400 dark:border-amber-500' : ''
          }`}
        >
          <p className="text-sm text-stone-900 dark:text-stone-100">
            ★ {vivino.rating?.toFixed(1)}
            {vivino.ratingsCount != null && (
              <> · {vivino.ratingsCount.toLocaleString('ru-RU')} {plural(vivino.ratingsCount, 'оценка', 'оценки', 'оценок')}</>
            )}
            <span className="ml-1.5 text-xs text-stone-400 dark:text-stone-500">
              {vivinoSource}
              {vivino.manual && ' · вручную'}
            </span>
          </p>
          <div className="mt-1 flex items-baseline justify-between gap-2">
            <p className="min-w-0 truncate text-[11px] text-stone-400 dark:text-stone-500">
              {vivinoCheck ? 'Проверь матч: ' : 'Нашёл: '}
              {vivino.matchedName}
            </p>
            <button
              onClick={() => setVivinoSearchOpen((v) => !v)}
              className="shrink-0 text-[11px] font-medium text-wine-600 dark:text-wine-400"
            >
              Не то вино?
            </button>
          </div>
          {vivinoSearchOpen && (
            <VivinoInlineSearch wine={wine} onDone={() => setVivinoSearchOpen(false)} />
          )}

          {/* Ноты по отзывам */}
          {vivino.flavors?.length > 0 && (
            <div className="mt-2.5">
              <p className="text-[11px] text-stone-400 dark:text-stone-500">
                Ноты по отзывам Vivino
              </p>
              <div className="mt-1 flex flex-wrap gap-1">
                {vivino.flavors.map((f) => (
                  <span
                    key={f.name_ru}
                    className="rounded-full bg-stone-100 px-2 py-0.5 text-[11px] text-stone-600 dark:bg-stone-800 dark:text-stone-300"
                  >
                    {f.name_ru} · {f.mentions}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Гастропары */}
          {vivino.foods?.length > 0 && (
            <p className="mt-2 text-[13px] text-stone-600 dark:text-stone-300">
              🍽 {vivino.foods.join(' · ')}
            </p>
          )}

          <div className="mt-2 flex items-center justify-between">
            {vivino.url ? (
              <a
                href={vivino.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[13px] font-medium text-wine-600 dark:text-wine-400"
              >
                Открыть на Vivino ↗
              </a>
            ) : (
              <span />
            )}
            <button
              onClick={onRefreshVivino}
              disabled={vivinoRefreshing}
              aria-label="Обновить данные Vivino"
              className="flex items-center gap-1 text-[11px] font-medium text-stone-400 disabled:opacity-50 dark:text-stone-500"
            >
              <RefreshCw className={`size-3 ${vivinoRefreshing ? 'animate-spin' : ''}`} /> обновить
            </button>
          </div>
        </div>
      )}

      {/* Vivino ещё не найден у свежесканированного — ручной поиск */}
      {!vivino && scanBanner && (
        <div className="mx-4 mt-4 rounded-xl bg-white p-3 dark:bg-stone-900">
          <p className="text-sm text-stone-500 dark:text-stone-400">Рейтинг Vivino</p>
          <VivinoInlineSearch wine={wine} />
        </div>
      )}

      {/* Вкусовой профиль */}
      <TasteProfile taste={taste} source={tasteSource} />

      {/* Атрибуты */}
      <div className="mx-4 mt-4 grid grid-cols-2 gap-2">
        <Tile label="Год" warn={lowConf('year')}>{wine.nvFlag ? 'NV' : (wine.year ?? '—')}</Tile>
        {grapesValue && <Tile label="Сорт" warn={lowConf('grapes')}>{grapesValue}</Tile>}
        <Tile label={isWishlist ? 'Статус' : wine.status === 'history' ? 'Статус' : 'В погребе'}>
          {stockValue}
        </Tile>
        <Tile label="Цена" muted={!price}>
          {price ?? 'не указана'}
        </Tile>
        {wine.alcohol != null && (
          <Tile label="Алкоголь" warn={lowConf('alcohol')}>{wine.alcohol}%</Tile>
        )}
        {wine.notes && (
          <Tile label="Заметки" wide>
            {wine.notes}
          </Tile>
        )}
      </div>

      {/* AI-справка */}
      {wine.aiReference && (
        <div className="mx-4 mt-4 rounded-xl bg-wine-100 p-3 dark:bg-wine-900">
          <p className="flex items-center gap-1.5 text-sm font-medium text-wine-700 dark:text-wine-200">
            <Sparkles className="size-4" /> AI-справка
          </p>
          {wine.aiReference.style && (
            <p className="mt-1.5 text-sm text-stone-700 dark:text-stone-300">
              {wine.aiReference.style}
            </p>
          )}
          {wine.aiReference.verdict && (
            <div className="mt-2">
              <p className="text-xs font-medium text-wine-700 dark:text-wine-200">Вердикт</p>
              <p className="mt-0.5 text-sm text-stone-700 dark:text-stone-300">
                {wine.aiReference.verdict}
              </p>
            </div>
          )}
          <div className="mt-2 space-y-0.5 text-xs text-stone-600 dark:text-stone-400">
            {wine.aiReference.peak && <p>Пик формы: {wine.aiReference.peak}</p>}
            {wine.aiReference.decant && <p>Декантация: {wine.aiReference.decant}</p>}
            {wine.aiReference.pairing && <p>Пара: {wine.aiReference.pairing}</p>}
            {priceRf?.from != null && priceRf?.to != null && (
              <p>
                Ориентир цены в РФ: {priceRf.from.toLocaleString('ru-RU')}–
                {priceRf.to.toLocaleString('ru-RU')} ₽ · оценка AI
                {vivino?.price != null && (
                  <> · средняя на Vivino ~{vivino.price}{vivino.priceCurrency === 'EUR' ? '€' : ` ${vivino.priceCurrency ?? ''}`}</>
                )}
              </p>
            )}
          </div>
          <div className="mt-2.5 flex gap-2">
            <a
              href={`https://www.google.com/search?q=${encodeURIComponent(buyQuery)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 rounded-lg border border-wine-200 py-2 text-center text-[13px] font-medium text-wine-700 dark:border-wine-700 dark:text-wine-200"
            >
              🛒 Найти, где купить
            </a>
            {wine.wineryName && (
              <a
                href={`https://www.google.com/search?tbm=isch&q=${encodeURIComponent(`${wine.wineryName} winery vineyard`)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 rounded-lg border border-wine-200 py-2 text-center text-[13px] font-medium text-wine-700 dark:border-wine-700 dark:text-wine-200"
              >
                🏞 Виноградники
              </a>
            )}
          </div>
        </div>
      )}

      {/* Глубже о вине (S6) */}
      <DeepBlock wine={wine} defaultOpen={!!scanBanner} />

      {/* О винодельне (полная справка) */}
      {wine.wineryId && <WineryBlock wineryId={wine.wineryId} defaultOpen={!!scanBanner} />}

      {/* Винодельня на карте */}
      {wine.wineryName &&
        (mapPointId ? (
          <button
            onClick={() => navigate('/map', { state: { wineryId: mapPointId } })}
            className="mx-4 mt-4 flex items-center gap-2 rounded-xl bg-white p-3 text-left dark:bg-stone-900"
          >
            <MapPin className="size-4 shrink-0 text-wine-600 dark:text-wine-400" />
            <span className="min-w-0 flex-1 truncate text-sm">
              {wine.wineryName} на карте виноделен
            </span>
            <ChevronRight className="size-4 shrink-0 text-stone-400" />
          </button>
        ) : mapState?.mode === 'manual' ? (
          <button
            onClick={() => navigate('/map', { state: { placeWineryId: mapState.wineryId } })}
            className="mx-4 mt-4 flex items-center gap-2 rounded-xl bg-white p-3 text-left dark:bg-stone-900"
          >
            <MapPin className="size-4 shrink-0 text-amber-500" />
            <span className="min-w-0 flex-1 truncate text-sm">
              📍 Не нашёл на карте ·{' '}
              <span className="font-medium text-wine-600 dark:text-wine-400">Указать вручную</span>
            </span>
          </button>
        ) : (
          <div className="mx-4 mt-4 flex items-center gap-2 rounded-xl bg-white p-3 dark:bg-stone-900">
            <MapPin className="size-4 shrink-0 text-stone-300 dark:text-stone-600" />
            <span className="min-w-0 flex-1 truncate text-sm text-stone-400 dark:text-stone-500">
              появится на карте после первой дегустации
            </span>
          </div>
        ))}

      {/* Дегустации */}
      <div className="mx-4 mt-5 mb-2">
        <h2 className="text-sm font-medium text-stone-500 dark:text-stone-400">
          Дегустации · {tastings?.length ?? 0}
        </h2>
        {tastings?.length ? (
          <div className="mt-2 space-y-2">
            {tastings.map((t) => {
              const details = [
                t.decantMinutes != null ? `декантация ${t.decantMinutes} мин` : 'без декантации',
                t.aromas?.length
                  ? `${t.aromas.length} ${plural(t.aromas.length, 'аромат', 'аромата', 'ароматов')}`
                  : null,
              ]
                .filter(Boolean)
                .join(' · ');
              return (
                <Link
                  key={t.id}
                  to={`/tasting/${t.id}`}
                  className="flex items-center gap-3 rounded-xl bg-white p-3 dark:bg-stone-900"
                >
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-semibold ${scoreBadgeClasses(t.totalScore)}`}
                  >
                    {t.totalScore.toFixed(1)}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm">
                      {fmtDate(t.date)} · {PLACE_LABEL[t.place] ?? t.place}
                    </span>
                    <span className="block text-xs text-stone-400 dark:text-stone-500">
                      {details}
                      {t.aerationPending && (
                        <span className="ml-1.5 inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
                          <span className="inline-block size-1.5 rounded-full bg-amber-400" />
                          дозаполнить
                        </span>
                      )}
                      {t.aiOpinion?.verdict === 'differs' && (
                        <span className="ml-1.5" title="AI видит оценку иначе">✨</span>
                      )}
                    </span>
                  </span>
                </Link>
              );
            })}
          </div>
        ) : (
          tastings !== undefined && (
            <p className="mt-2 text-sm text-stone-400 dark:text-stone-500">Ещё не пробовал</p>
          )
        )}
      </div>

      {/* Нижняя кнопка */}
      <div className="sticky bottom-0 mt-auto bg-gradient-to-t from-stone-50 via-stone-50/90 px-4 pt-6 pb-[calc(1rem+env(safe-area-inset-bottom))] dark:from-stone-950 dark:via-stone-950/90">
        {isWishlist ? (
          <div className="flex gap-2">
            <button
              onClick={onBuy}
              className="flex-1 rounded-lg bg-wine-600 py-3 text-sm font-medium text-white dark:bg-wine-400 dark:text-stone-950"
            >
              Купил
            </button>
            <button
              onClick={() => navigate(`/wine/${wine.id}/taste`)}
              className="flex-1 rounded-lg border border-stone-300 py-3 text-sm font-medium text-stone-700 dark:border-stone-600 dark:text-stone-300"
            >
              Новая дегустация
            </button>
          </div>
        ) : isHistory ? (
          <div className="flex gap-2">
            <button
              onClick={onBuy}
              className="flex-1 rounded-lg border border-stone-300 py-3 text-sm font-medium text-stone-700 dark:border-stone-600 dark:text-stone-300"
            >
              Купил снова
            </button>
            <button
              onClick={() => navigate(`/wine/${wine.id}/taste`)}
              className="flex-1 rounded-lg bg-wine-600 py-3 text-sm font-medium text-white dark:bg-wine-400 dark:text-stone-950"
            >
              🍷 Новая дегустация
            </button>
          </div>
        ) : (
          <button
            onClick={() => navigate(`/wine/${wine.id}/taste`)}
            className="w-full rounded-lg bg-wine-600 py-3 text-sm font-medium text-white dark:bg-wine-400 dark:text-stone-950"
          >
            🍷 Новая дегустация
          </button>
        )}
      </div>

      <Toast message={toast} onDone={() => setToast(null)} />
    </div>
  );
}
