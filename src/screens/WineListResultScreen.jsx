import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowLeft, Plus, Sparkles, Star } from 'lucide-react';
import { db } from '../db.js';
import { addWine } from '../data/wines.js';
import { normalizeName } from '../data/normalize.js';
import { getPersonalThreshold } from '../ai/profile.js';
import { lookupVivinoCached } from '../api/vivino.js';
import { getCbrRates } from '../api/currency.js';
import { analyzeWineList } from '../api/ai.js';
import { compressImage } from '../utils/image.js';
import { formatPrice } from '../theme.js';
import { pluralize } from '../utils/plural.js';
import { usePageTitle } from '../utils/title.js';
import Toast from '../components/Toast.jsx';

const COLOR_MAP = { красное: 'red', белое: 'white', розовое: 'rose', оранжевое: 'orange' };
const BADGE_STYLE = {
  match: 'bg-sky-100 text-sky-800 dark:bg-sky-900 dark:text-sky-200',
  value: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200',
  discover: 'bg-violet-100 text-violet-800 dark:bg-violet-900 dark:text-violet-200',
};
const BADGE_LABEL = { match: 'Под твой вкус', value: 'Цена/качество', discover: 'Попробуй новое' };

const median = (nums) => {
  const s = [...nums].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : null;
};

const fmtDate = (iso) =>
  new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' }).replace(' г.', '');

// /winelist/:id — результат анализа карты по макету
export default function WineListResultScreen() {
  const { id } = useParams();
  const navigate = useNavigate();
  usePageTitle('Винная карта');
  const [toast, setToast] = useState(null);
  const [colorFilter, setColorFilter] = useState(null);
  const [priceCap, setPriceCap] = useState(false);
  const [expanded, setExpanded] = useState(null); // индекс раскрытой позиции
  const [vivino, setVivino] = useState({}); // idx → {rating, price, markup, url}
  const [busyPage, setBusyPage] = useState(false);
  const addPageRef = useRef(null);
  const enrichedRef = useRef(false);

  const scan = useLiveQuery(() => db.restaurantScans.get(id).then((s) => s ?? null), [id]);

  // P19: статус персонализации для подписи в совете сомелье
  const sommelier = useLiveQuery(async () => ({
    threshold: await getPersonalThreshold(),
    tastings: await db.tastings.count(),
  }));

  const positions = scan?.result?.positions ?? [];
  // рекомендованные — первыми, сохраняя исходный индекс для стейтов
  const ordered = positions
    .map((p, idx) => ({ ...p, idx }))
    .sort((a, b) => (b.badges?.length ? 1 : 0) - (a.badges?.length ? 1 : 0));

  const priceMedian = median(positions.map((p) => p.price_menu).filter((p) => p > 0));
  const colors = [...new Set(positions.map((p) => p.color).filter(Boolean))];

  const visible = ordered.filter(
    (p) =>
      (!colorFilter || p.color === colorFilter) &&
      (!priceCap || (p.price_menu != null && p.price_menu <= priceMedian))
  );

  // Vivino-обогащение: до 5 позиций с бейджами, асинхронно после рендера
  useEffect(() => {
    if (!scan || enrichedRef.current) return;
    enrichedRef.current = true;
    (async () => {
      const rates = await getCbrRates();
      const targets = positions
        .map((p, idx) => ({ p, idx }))
        .filter(({ p }) => p.badges?.length)
        .slice(0, 5);
      for (const { p, idx } of targets) await enrichOne(p, idx, rates);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scan?.id]);

  const enrichOne = async (p, idx, rates = null) => {
    // только название: русские сорта в запросе ломают поиск Vivino
    const res = await lookupVivinoCached(p.name, p.year ?? null);
    if (!res.ok) {
      setVivino((v) => ({ ...v, [idx]: { miss: true, offline: navigator.onLine === false } }));
      return;
    }
    let markup = null;
    const r = rates ?? (await getCbrRates());
    const rate = r?.[res.data.priceCurrency];
    if (res.data.price != null && rate && p.price_menu > 0) {
      const retailRub = res.data.price * rate;
      markup = Math.round((p.price_menu / retailRub) * 10) / 10;
      console.debug(
        `[markup] ${p.name}: ${res.data.price} ${res.data.priceCurrency} × ${rate.toFixed(2)} = ${Math.round(retailRub)} ₽ → ×${markup}`
      );
    }
    setVivino((v) => ({
      ...v,
      [idx]: { rating: res.data.rating, price: res.data.price, currency: res.data.priceCurrency, markup, url: res.data.url },
    }));
  };

  // создание вина из позиции; повторный тап не дублирует (wineId в result)
  const saveFromPosition = async (pos, target) => {
    if (positions[pos.idx].wineId) return;
    const isTasting = target === 'tasting';
    const wine = await addWine({
      name: pos.name,
      wineryName: '',
      year: pos.year ?? null,
      color: COLOR_MAP[pos.color?.toLowerCase()] ?? 'red',
      grapes: pos.grapes ? [{ name: pos.grapes, percent: null }] : [],
      appellation: pos.appellation ?? null,
      country: pos.country ?? null,
      price: pos.price_menu ?? null,
      quantity: 0,
      source: 'winelist',
      status: isTasting ? 'history' : 'wishlist',
      historyReason: isTasting ? 'winelist' : null,
      historyAt: isTasting ? new Date().toISOString() : null,
    });
    const updatedPositions = positions.map((p, i) =>
      i === pos.idx ? { ...p, wineId: wine.id, savedAs: target } : p
    );
    await db.restaurantScans.update(id, { result: { ...scan.result, positions: updatedPositions } });
    if (isTasting) {
      navigate(`/wine/${wine.id}/taste`, {
        state: { place: scan.restaurantName || 'restaurant' },
      });
    } else {
      setToast('В Wishlist');
    }
  };

  // «+ страница»: дозапрос — все страницы (старые + новая) повторным S5
  const onAddPage = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusyPage(true);
    try {
      const newBlob = await compressImage(file);
      const oldPhotos = await Promise.all(scan.photoIds.map((pid) => db.photos.get(pid)));
      const blobs = [...oldPhotos.filter(Boolean).map((p) => p.blob), newBlob];
      const res = await analyzeWineList(blobs);
      if (!res.ok || !(res.data.positions?.length >= 3)) {
        setToast('Дозапрос не удался — карта не распозналась');
        return;
      }
      const pid = crypto.randomUUID();
      await db.photos.add({
        id: pid,
        wineId: null,
        tastingId: null,
        scanId: id,
        blob: newBlob,
        kind: 'winelist',
        order: scan.photoIds.length,
        createdAt: new Date().toISOString(),
      });
      // перенести метки сохранённых вин в новый результат (иначе ✓ потеряются)
      const savedByName = new Map(
        positions
          .filter((p) => p.wineId)
          .map((p) => [normalizeName(p.name), { wineId: p.wineId, savedAs: p.savedAs }])
      );
      const mergedPositions = (res.data.positions ?? []).map((p) => {
        const saved = savedByName.get(normalizeName(p.name));
        return saved ? { ...p, ...saved } : p;
      });
      await db.restaurantScans.update(id, {
        photoIds: [...scan.photoIds, pid],
        result: { ...res.data, positions: mergedPositions },
      });
      enrichedRef.current = false;
      setVivino({});
      setToast('Карта обновлена');
    } finally {
      setBusyPage(false);
    }
  };

  if (scan === undefined) return null;
  if (scan === null)
    return <p className="mt-10 text-center text-sm text-stone-500">Скан не найден</p>;

  return (
    <div className="flex min-h-dvh flex-col pb-[calc(2rem+env(safe-area-inset-bottom))]">
      <header className="sticky top-0 z-10 flex items-center justify-between bg-stone-50/95 px-2 py-2 backdrop-blur dark:bg-stone-950/95">
        <div className="flex min-w-0 items-center">
          <button
            onClick={() => navigate(-1)}
            className="flex shrink-0 items-center gap-1 rounded-lg px-2 py-2 text-sm font-medium text-wine-600 dark:text-wine-400"
          >
            <ArrowLeft className="size-4" />
          </button>
          <div className="min-w-0">
            <p className="text-sm font-semibold">Винная карта</p>
            <p className="truncate text-[11px] text-stone-500 dark:text-stone-400">
              {[scan.restaurantName, `${positions.length} ${pluralize(positions.length, 'позиция', 'позиции', 'позиций')}`, fmtDate(scan.date)]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </div>
        </div>
        <button
          onClick={() => addPageRef.current?.click()}
          disabled={busyPage}
          className="shrink-0 rounded-lg px-3 py-2 text-[13px] font-medium text-wine-600 disabled:opacity-50 dark:text-wine-400"
        >
          {busyPage ? 'анализ…' : '+ страница'}
        </button>
        <input ref={addPageRef} type="file" accept="image/*" className="hidden" onChange={onAddPage} />
      </header>

      {/* Совет сомелье */}
      {scan.result.sommelier_note && (
        <div className="mx-4 mt-2 rounded-xl bg-wine-100 p-3 dark:bg-wine-900">
          <p className="flex items-center gap-1.5 text-sm font-medium text-wine-700 dark:text-wine-200">
            <Sparkles className="size-4" /> Совет сомелье
          </p>
          <p className="mt-1 text-sm text-stone-700 dark:text-stone-300">
            {scan.result.sommelier_note}
          </p>
          {sommelier && (
            <p className="mt-1.5 text-[11px] text-stone-400 dark:text-stone-500">
              {(scan.result.profileMeta?.personal ?? sommelier.tastings >= sommelier.threshold)
                ? `на основе твоих ${scan.result.profileMeta?.tastings ?? sommelier.tastings} дегустаций`
                : `общие рекомендации · до персональных ${Math.max(1, sommelier.threshold - sommelier.tastings)} дегустаций`}
            </p>
          )}
        </div>
      )}

      {/* Фильтры */}
      <div className="mt-3 flex gap-1.5 overflow-x-auto px-4 [scrollbar-width:none]">
        <FilterChip active={!colorFilter && !priceCap} onClick={() => { setColorFilter(null); setPriceCap(false); }}>
          Все · {positions.length}
        </FilterChip>
        {colors.map((c) => (
          <FilterChip key={c} active={colorFilter === c} onClick={() => setColorFilter(colorFilter === c ? null : c)}>
            {c}
          </FilterChip>
        ))}
        {priceMedian != null && (
          <FilterChip active={priceCap} onClick={() => setPriceCap((v) => !v)}>
            До {priceMedian.toLocaleString('ru-RU')} ₽
          </FilterChip>
        )}
      </div>

      {/* Позиции */}
      <div className="mt-3 space-y-2 px-4">
        {visible.map((pos) => {
          const vi = vivino[pos.idx];
          const isRec = pos.badges?.length > 0;
          const isOpen = isRec || expanded === pos.idx;
          return (
            <div
              key={pos.idx}
              onClick={() => !isRec && setExpanded(expanded === pos.idx ? null : pos.idx)}
              className={`rounded-xl bg-white p-3 dark:bg-stone-900 ${
                isRec ? 'border-2 border-wine-200 dark:border-wine-700' : ''
              }`}
            >
              <div className="flex items-baseline justify-between gap-2">
                <p className="min-w-0 text-sm font-medium">
                  {pos.name}
                  {pos.year ? ` ${pos.year}` : ''}
                </p>
                {pos.price_menu != null && (
                  <p className="shrink-0 text-sm font-semibold tabular-nums">
                    {pos.price_menu.toLocaleString('ru-RU')} ₽
                  </p>
                )}
              </div>
              <p className="mt-0.5 text-[12px] text-stone-400 dark:text-stone-500">
                {[pos.color, pos.grapes, pos.appellation, pos.country].filter(Boolean).join(' · ')}
              </p>

              {vi?.miss && (
                <p className="mt-1 text-[12px] text-stone-400 dark:text-stone-500">
                  {vi.offline ? 'рейтинг подтянется при интернете' : 'на Vivino не нашлось'}
                </p>
              )}
              {(vi?.rating != null || vi?.markup != null) && (
                <p className="mt-1 text-[12px] text-stone-500 dark:text-stone-400">
                  {vi.rating != null && <>★ {vi.rating.toFixed(1)}</>}
                  {vi.price != null && (
                    <span className="ml-1.5">
                      Vivino ~{vi.price}{vi.currency === 'EUR' ? '€' : vi.currency === 'USD' ? '$' : ` ${vi.currency ?? ''}`}
                    </span>
                  )}
                  {vi.markup != null && (
                    <span className={`ml-1.5 ${vi.markup >= 3 ? 'font-medium text-amber-600 dark:text-amber-400' : ''}`}>
                      наценка ×{vi.markup}
                    </span>
                  )}
                </p>
              )}

              {isRec && (
                <>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {pos.badges.map((b) => (
                      <span key={b} className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${BADGE_STYLE[b] ?? ''}`}>
                        {BADGE_LABEL[b] ?? b}
                      </span>
                    ))}
                  </div>
                  {pos.reason && (
                    <p className="mt-1 text-[13px] text-stone-600 dark:text-stone-300">{pos.reason}</p>
                  )}
                </>
              )}

              {isOpen && (
                <div className="mt-2 flex gap-2" onClick={(e) => e.stopPropagation()}>
                  {pos.wineId ? (
                    <span className="flex-1 py-2 text-center text-[13px] text-emerald-600 dark:text-emerald-400">
                      ✓ {pos.savedAs === 'tasting' ? 'В Истории' : 'В Wishlist'}
                    </span>
                  ) : (
                    <>
                      <button
                        onClick={() => saveFromPosition(pos, 'wishlist')}
                        className="flex-1 rounded-lg border border-stone-300 py-2 text-[13px] font-medium text-stone-700 dark:border-stone-600 dark:text-stone-300"
                      >
                        В Wishlist
                      </button>
                      <button
                        onClick={() => saveFromPosition(pos, 'tasting')}
                        className="flex-1 rounded-lg bg-wine-600 py-2 text-[13px] font-medium text-white dark:bg-wine-400 dark:text-stone-950"
                      >
                        Дегустирую
                      </button>
                    </>
                  )}
                  {!isRec && !vi && (
                    <button
                      onClick={() => enrichOne(pos, pos.idx)}
                      aria-label="Узнать рейтинг"
                      className="grid size-9 shrink-0 place-items-center rounded-lg border border-stone-300 text-stone-500 dark:border-stone-600 dark:text-stone-300"
                    >
                      <Star className="size-4" />
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <Toast message={toast} onDone={() => setToast(null)} />
    </div>
  );
}

function FilterChip({ active, children, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`shrink-0 rounded-full border px-3 py-1 text-[13px] whitespace-nowrap transition-colors ${
        active
          ? 'border-wine-600 bg-wine-600 text-white dark:border-wine-400 dark:bg-wine-400 dark:text-stone-950'
          : 'border-stone-300 text-stone-600 dark:border-stone-600 dark:text-stone-300'
      }`}
    >
      {children}
    </button>
  );
}
