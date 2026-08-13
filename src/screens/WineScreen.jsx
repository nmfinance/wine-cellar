import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  ArrowLeft,
  ChevronRight,
  Heart,
  MapPin,
  Pencil,
  Sparkles,
  Trash2,
  Wine,
} from 'lucide-react';
import { db } from '../db.js';
import { deleteWineCascade, moveTo, updateWine } from '../data/wines.js';
import { PLACEHOLDER_BY_COLOR, formatPrice, scoreBadgeClasses } from '../theme.js';
import Toast from '../components/Toast.jsx';

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
          <img key={i} src={u} alt="" className="h-full w-full flex-none snap-center object-cover" />
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
    </div>
  );
}

// --- Тайл атрибута -----------------------------------------------------------

function Tile({ label, wide = false, muted = false, children }) {
  return (
    <div className={`rounded-lg bg-white p-3 dark:bg-stone-900 ${wide ? 'col-span-2' : ''}`}>
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

// --- Экран -------------------------------------------------------------------

export default function WineScreen() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [toast, setToast] = useState(null);

  // тост «Сохранено» после возврата из формы
  useEffect(() => {
    if (location.state?.toast) {
      setToast(location.state.toast);
      navigate(location.pathname + location.search, { replace: true, state: null });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const wine = useLiveQuery(() => db.wines.get(id).then((w) => w ?? null), [id]);
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

      <PhotoGallery wine={wine} />

      {/* Заголовочный блок */}
      <div className="px-4 pt-4">
        <h1 className="line-clamp-2 text-lg leading-snug font-medium">{wine.name}</h1>
        {originLine && (
          <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">{originLine}</p>
        )}
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          {tastings !== undefined &&
            (lastTasting ? (
              <span
                className={`rounded-full px-2.5 py-1 text-xs font-semibold ${scoreBadgeClasses(lastTasting.totalScore)}`}
              >
                Моя {lastTasting.totalScore.toFixed(1)}
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
              onClick={() => setToast('Ручной поиск появится вместе со сканом')}
              className="shrink-0 text-[11px] font-medium text-wine-600 dark:text-wine-400"
            >
              Не то вино?
            </button>
          </div>
        </div>
      )}

      {/* Атрибуты */}
      <div className="mx-4 mt-4 grid grid-cols-2 gap-2">
        <Tile label="Год">{wine.nvFlag ? 'NV' : (wine.year ?? '—')}</Tile>
        {grapesValue && <Tile label="Сорт">{grapesValue}</Tile>}
        <Tile label={isWishlist ? 'Статус' : wine.status === 'history' ? 'Статус' : 'В погребе'}>
          {stockValue}
        </Tile>
        <Tile label="Цена" muted={!price}>
          {price ?? 'не указана'}
        </Tile>
        {wine.alcohol != null && <Tile label="Алкоголь">{wine.alcohol}%</Tile>}
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
          <div className="mt-2 space-y-0.5 text-xs text-stone-600 dark:text-stone-400">
            {wine.aiReference.peak && <p>Пик формы: {wine.aiReference.peak}</p>}
            {wine.aiReference.decant && <p>Декантация: {wine.aiReference.decant}</p>}
            {wine.aiReference.pairing && <p>Пара: {wine.aiReference.pairing}</p>}
          </div>
        </div>
      )}

      {/* Винодельня */}
      {wine.wineryId && (
        <button
          onClick={() => setToast('Карта в разработке')}
          className="mx-4 mt-4 flex items-center gap-2 rounded-xl bg-white p-3 text-left dark:bg-stone-900"
        >
          <MapPin className="size-4 shrink-0 text-wine-600 dark:text-wine-400" />
          <span className="min-w-0 flex-1 truncate text-sm">
            {wine.wineryName} на карте виноделен
          </span>
          <ChevronRight className="size-4 shrink-0 text-stone-400" />
        </button>
      )}

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
              onClick={() => setToast('Скоро')}
              className="flex-1 rounded-lg border border-stone-300 py-3 text-sm font-medium text-stone-700 dark:border-stone-600 dark:text-stone-300"
            >
              Новая дегустация
            </button>
          </div>
        ) : (
          <button
            onClick={() => setToast('Скоро')}
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
