import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { BarChart3, Clock, MapPin, Settings, Wine } from 'lucide-react';
import { db } from '../db.js';
import { matchesQuery, normalizeName } from '../data/normalize.js';
import BottomSheet from '../components/BottomSheet.jsx';
import EmptyState from '../components/EmptyState.jsx';
import Fab from '../components/Fab.jsx';
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
  const [sheetOpen, setSheetOpen] = useState(false);
  const [toast, setToast] = useState(null);

  const counts = useLiveQuery(async () => ({
    cellar: await db.wines.where('status').equals('cellar').count(),
    wishlist: await db.wines.where('status').equals('wishlist').count(),
    history: await db.wines.where('status').equals('history').count(),
  }));

  const wines = useLiveQuery(
    () => (tab === 'history' ? [] : db.wines.where('status').equals(tab).toArray()),
    [tab]
  );

  const q = normalizeName(query);
  const shown = (wines ?? [])
    .filter((w) => matchesQuery([w.name, w.wineryName], query))
    .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));

  const pickAddOption = () => {
    setSheetOpen(false);
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

      <div className="mt-3 mb-3">
        <SearchBar value={query} onChange={setQuery} onFilters={() => setToast('Скоро')} />
      </div>

      {content}

      <Fab onClick={() => setSheetOpen(true)} />

      <BottomSheet open={sheetOpen} onClose={() => setSheetOpen(false)} title="Добавить вино">
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

      <Toast message={toast} onDone={() => setToast(null)} />
    </div>
  );
}
