import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { BarChart3, Clock, MapPin, Settings, Wine } from 'lucide-react';
import { db } from '../db.js';
import { normalizeName } from '../data/normalize.js';
import { listFiltered, listHistory } from '../data/wines.js';
import { listRacks } from '../data/cellar.js';
import { emptyFilters, hasActive } from '../data/filters.js';
import BottomSheet from '../components/BottomSheet.jsx';
import EmptyState from '../components/EmptyState.jsx';
import Fab from '../components/Fab.jsx';
import FilterChips from '../components/FilterChips.jsx';
import FilterSheet from '../components/FilterSheet.jsx';
import OfflineBadge from '../components/OfflineBadge.jsx';
import SearchBar from '../components/SearchBar.jsx';
import TabBar from '../components/TabBar.jsx';
import Toast from '../components/Toast.jsx';
import WineCard from '../components/WineCard.jsx';
import WineRow from '../components/WineRow.jsx';
import HistoryRow from '../components/HistoryRow.jsx';

const HISTORY_CHIPS = [
  { key: 'all', label: 'Всё' },
  { key: 'drunk', label: 'Выпито' },
  { key: 'scanned', label: 'Сканы' },
  { key: 'winelist', label: 'Из карт' },
];

const HEADER_LINKS = [
  { to: '/stats', icon: BarChart3, label: 'Статистика' },
  { to: '/map', icon: MapPin, label: 'Карта' },
  { to: '/settings', icon: Settings, label: 'Настройки' },
];

const EMPTY_TEXT = {
  cellar: 'В погребе пусто. Добавь первое вино кнопкой +',
  wishlist: 'Сюда попадут вина, которые хочешь купить',
};

// Группировка вин погреба по стеллажам и полкам для режима «По полкам»
function groupByShelves(wines, racks) {
  const groups = [];
  for (const rack of racks) {
    for (const shelf of rack.shelves) {
      const ws = wines.filter(
        (w) => w.location?.rackId === rack.id && w.location.shelf === shelf.n
      );
      if (!ws.length) continue;
      const count = ws.reduce((a, w) => a + (w.quantity ?? 0), 0);
      groups.push({
        key: `${rack.id}:${shelf.n}`,
        title: `${rack.name} · полка ${shelf.n} · ${count}${shelf.capacity != null ? `/${shelf.capacity}` : ''}`,
        wines: ws,
        noPlace: false,
      });
    }
  }
  const noPlace = wines.filter((w) => !w.location);
  if (noPlace.length) {
    groups.push({
      key: 'no-place',
      title: `📦 Без места · ${noPlace.length}`,
      wines: noPlace,
      noPlace: true,
    });
  }
  return groups;
}

// Группировка Истории по месяцам historyAt: «Август 2026»
function groupByMonth(wines) {
  const groups = [];
  for (const wine of wines) {
    const d = wine.historyAt ? new Date(wine.historyAt) : null;
    const key = d ? `${d.getFullYear()}-${d.getMonth()}` : 'unknown';
    let group = groups.find((g) => g.key === key);
    if (!group) {
      const title = d
        ? d.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' }).replace(' г.', '')
        : 'Без даты';
      groups.push((group = { key, title: title[0].toUpperCase() + title.slice(1), wines: [] }));
    }
    group.wines.push(wine);
  }
  return groups;
}

export default function CellarScreen({ tab }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState(emptyFilters);
  const [addSheetOpen, setAddSheetOpen] = useState(false);
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);
  const [historyReason, setHistoryReason] = useState('all');
  const [toast, setToast] = useState(null);

  // фильтры живут в памяти и сбрасываются при переключении вкладки
  useEffect(() => {
    setFilters(emptyFilters());
    setFilterSheetOpen(false);
    setHistoryReason('all');
  }, [tab]);

  const counts = useLiveQuery(async () => ({
    cellar: await db.wines.where('status').equals('cellar').count(),
    wishlist: await db.wines.where('status').equals('wishlist').count(),
    history: await db.wines.where('status').equals('history').count(),
  }));

  const wines = useLiveQuery(
    () =>
      tab === 'history'
        ? listHistory(query, historyReason)
        : listFiltered(tab, query, filters),
    [tab, query, filters, historyReason]
  );

  // режим отображения погреба: 'grid' | 'shelves', живёт в meta
  const viewMeta = useLiveQuery(() => db.meta.get('cellarViewMode'));
  const viewMode = tab === 'cellar' ? (viewMeta?.value ?? 'grid') : 'grid';
  const toggleView = () =>
    db.meta.put({ key: 'cellarViewMode', value: viewMode === 'grid' ? 'shelves' : 'grid' });
  const racks = useLiveQuery(listRacks);

  // «вино дышит»: pending-дегустация с СЕГОДНЯШНЕЙ датой (старше — поезд ушёл)
  const breathing = useLiveQuery(async () => {
    const today = new Date().toISOString().slice(0, 10);
    const t = await db.tastings
      .filter((x) => x.aerationPending === true && (x.date ?? '').slice(0, 10) === today)
      .first();
    if (!t) return null;
    const w = await db.wines.get(t.wineId);
    return { tastingId: t.id, wineName: w?.name ?? 'Вино' };
  });

  const q = normalizeName(query);
  const filtersActive = hasActive(filters);
  const shown = wines ?? [];

  let content;
  if (wines === undefined) {
    content = null;
  } else if (tab === 'history') {
    const groups = groupByMonth(shown);
    content = (
      <>
        <div className="mb-3 flex gap-1.5 overflow-x-auto px-4 [scrollbar-width:none]">
          {HISTORY_CHIPS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setHistoryReason(key)}
              className={`shrink-0 rounded-full border px-3 py-1 text-[13px] whitespace-nowrap transition-colors ${
                historyReason === key
                  ? 'border-wine-600 bg-wine-600 text-white dark:border-wine-400 dark:bg-wine-400 dark:text-stone-950'
                  : 'border-stone-300 text-stone-600 dark:border-stone-600 dark:text-stone-300'
              }`}
            >
              {label}
              {key === 'all' && counts ? ` · ${counts.history}` : ''}
            </button>
          ))}
        </div>
        {groups.length > 0 ? (
          <div className="space-y-4 px-4">
            {groups.map((g) => (
              <div key={g.key}>
                <h3 className="mb-1.5 text-xs font-medium text-stone-500 dark:text-stone-400">
                  {g.title}
                </h3>
                <div className="space-y-1.5">
                  {g.wines.map((wine) => (
                    <HistoryRow
                      key={wine.id}
                      wine={wine}
                      onBought={() => setToast('В погребе!')}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : q ? (
          <EmptyState icon={Wine}>Ничего не нашлось по «{query.trim()}»</EmptyState>
        ) : historyReason !== 'all' ? (
          <EmptyState icon={Clock}>Здесь пока пусто</EmptyState>
        ) : (
          <EmptyState icon={Clock}>Здесь появится всё, что ты пробовал и сканировал</EmptyState>
        )}
      </>
    );
  } else if (shown.length > 0) {
    if (viewMode === 'shelves') {
      const groups = groupByShelves(shown, racks ?? []);
      content = (
        <div className="space-y-4 px-4">
          {groups.map((g) => (
            <div key={g.key}>
              <h3 className="mb-1.5 text-xs font-medium text-stone-500 dark:text-stone-400">
                {g.title}
              </h3>
              <div className="space-y-1.5">
                {g.wines.map((wine) => (
                  <WineRow
                    key={wine.id}
                    wine={wine}
                    subtitle={g.noPlace ? wine.locationFreeText ?? undefined : undefined}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      );
    } else {
      content = (
        <div className="grid grid-cols-2 gap-2.5 px-4">
          {shown.map((wine) => (
            <WineCard key={wine.id} wine={wine} />
          ))}
        </div>
      );
    }
  } else if (q) {
    content = <EmptyState icon={Wine}>Ничего не нашлось по «{query.trim()}»</EmptyState>;
  } else if (filtersActive) {
    content = <EmptyState icon={Wine}>Ничего не найдено по выбранным фильтрам</EmptyState>;
  } else {
    content = <EmptyState icon={Wine}>{EMPTY_TEXT[tab]}</EmptyState>;
  }

  return (
    <div className="flex min-h-dvh flex-col pb-28">
      <header className="flex items-center justify-between px-4 pt-5 pb-3">
        <h1 className="text-xl font-medium text-wine-600 dark:text-wine-400">Мой погреб</h1>
        <div className="flex items-center gap-0.5">
          <OfflineBadge />
          {HEADER_LINKS.map(({ to, icon: Icon, label }) => (
            <Link
              key={to}
              to={to}
              aria-label={label}
              className="grid size-9 place-items-center rounded-lg text-stone-500 hover:bg-stone-100 dark:text-stone-400 dark:hover:bg-stone-800"
            >
              <Icon className="size-5" />
            </Link>
          ))}
        </div>
      </header>

      <TabBar counts={counts} />

      <div className="mt-3">
        <SearchBar
          value={query}
          onChange={setQuery}
          onFilters={tab === 'history' ? null : () => setFilterSheetOpen(true)}
          filtersActive={filtersActive}
          viewMode={tab === 'cellar' ? viewMode : null}
          onToggleView={tab === 'cellar' ? toggleView : null}
        />
        <FilterChips filters={filters} onChange={setFilters} />
      </div>

      {breathing && (
        <Link
          to={`/tasting/${breathing.tastingId}`}
          className="mx-4 mt-3 block rounded-lg bg-amber-100 px-3 py-2 text-[13px] text-amber-800 dark:bg-amber-950 dark:text-amber-200"
        >
          💨 {breathing.wineName} дышит — дозаполнить дегустацию →
        </Link>
      )}

      <div className="mt-3">{content}</div>

      <Fab onClick={() => setAddSheetOpen(true)} />

      <BottomSheet open={addSheetOpen} onClose={() => setAddSheetOpen(false)} title="Добавить вино">
        <div className="flex flex-col gap-1 p-3 pb-5">
          <button
            onClick={() => {
              setAddSheetOpen(false);
              navigate('/scan');
            }}
            className="rounded-lg px-3 py-3 text-left text-[15px] hover:bg-stone-100 dark:hover:bg-stone-800"
          >
            📷 Скан этикетки
          </button>
          <button
            onClick={() => {
              setAddSheetOpen(false);
              navigate('/add');
            }}
            className="rounded-lg px-3 py-3 text-left text-[15px] hover:bg-stone-100 dark:hover:bg-stone-800"
          >
            ✍️ Вручную
          </button>
        </div>
      </BottomSheet>

      {tab !== 'history' && (
        <FilterSheet
          open={filterSheetOpen}
          onClose={() => setFilterSheetOpen(false)}
          status={tab}
          query={query}
          applied={filters}
          onApply={setFilters}
        />
      )}

      <Toast message={toast} onDone={() => setToast(null)} />
    </div>
  );
}
