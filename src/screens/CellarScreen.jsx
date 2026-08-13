import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { BarChart3, Clock, MapPin, Settings, Wine } from 'lucide-react';
import { db } from '../db.js';
import { normalizeName } from '../data/normalize.js';
import { listFiltered } from '../data/wines.js';
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

const HEADER_LINKS = [
  { to: '/stats', icon: BarChart3, label: 'Статистика' },
  { to: '/map', icon: MapPin, label: 'Карта' },
  { to: '/settings', icon: Settings, label: 'Настройки' },
];

const EMPTY_TEXT = {
  cellar: 'В погребе пусто. Добавь первое вино кнопкой +',
  wishlist: 'Сюда попадут вина, которые хочешь купить',
};

export default function CellarScreen({ tab }) {
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState(emptyFilters);
  const [addSheetOpen, setAddSheetOpen] = useState(false);
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);
  const [toast, setToast] = useState(null);

  // фильтры живут в памяти и сбрасываются при переключении вкладки
  useEffect(() => {
    setFilters(emptyFilters());
    setFilterSheetOpen(false);
  }, [tab]);

  const counts = useLiveQuery(async () => ({
    cellar: await db.wines.where('status').equals('cellar').count(),
    wishlist: await db.wines.where('status').equals('wishlist').count(),
    history: await db.wines.where('status').equals('history').count(),
  }));

  const wines = useLiveQuery(
    () => (tab === 'history' ? [] : listFiltered(tab, query, filters)),
    [tab, query, filters]
  );

  const q = normalizeName(query);
  const filtersActive = hasActive(filters);
  const shown = wines ?? [];

  const pickAddOption = () => {
    setAddSheetOpen(false);
    setToast('Скоро');
  };

  let content;
  if (tab === 'history') {
    content = <EmptyState icon={Clock}>История появится чуть позже</EmptyState>;
  } else if (wines === undefined) {
    content = null;
  } else if (shown.length > 0) {
    content = (
      <div className="grid grid-cols-2 gap-2.5 px-4">
        {shown.map((wine) => (
          <WineCard key={wine.id} wine={wine} />
        ))}
      </div>
    );
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
          onFilters={() => setFilterSheetOpen(true)}
          filtersActive={filtersActive}
        />
        <FilterChips filters={filters} onChange={setFilters} />
      </div>

      <div className="mt-3">{content}</div>

      <Fab onClick={() => setAddSheetOpen(true)} />

      <BottomSheet open={addSheetOpen} onClose={() => setAddSheetOpen(false)} title="Добавить вино">
        <div className="flex flex-col gap-1 p-3 pb-5">
          <button
            onClick={pickAddOption}
            className="rounded-lg px-3 py-3 text-left text-[15px] hover:bg-stone-100 dark:hover:bg-stone-800"
          >
            📷 Скан этикетки
          </button>
          <button
            onClick={pickAddOption}
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
