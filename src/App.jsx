import { HashRouter, NavLink, Route, Routes } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from './db.js';
import OfflineBadge from './components/OfflineBadge.jsx';
import pkg from '../package.json';

const TABS = [
  { to: '/', key: 'cellar', label: 'Погреб', end: true },
  { to: '/wishlist', key: 'wishlist', label: 'Wishlist' },
  { to: '/history', key: 'history', label: 'История' },
];

function Placeholder() {
  return (
    <main className="px-4 py-10 text-center">
      <p className="text-sm text-stone-500 dark:text-stone-400">
        Каркас готов. Версия {pkg.version}
      </p>
    </main>
  );
}

export default function App() {
  const counts = useLiveQuery(async () => ({
    cellar: await db.wines.where('status').equals('cellar').count(),
    wishlist: await db.wines.where('status').equals('wishlist').count(),
    history: await db.wines.where('status').equals('history').count(),
  }));

  return (
    <HashRouter>
      <div className="min-h-dvh bg-stone-50 text-stone-900 dark:bg-stone-950 dark:text-stone-100">
        <div className="mx-auto flex min-h-dvh max-w-[480px] flex-col">
          <header className="flex items-center justify-between px-4 pt-6 pb-4">
            <h1 className="text-2xl font-bold text-wine-600 dark:text-wine-200">
              Мой погреб
            </h1>
            <OfflineBadge />
          </header>

          <nav className="flex gap-1 border-b border-stone-200 px-4 dark:border-stone-800">
            {TABS.map((tab) => (
              <NavLink
                key={tab.to}
                to={tab.to}
                end={tab.end}
                className={({ isActive }) =>
                  `rounded-t-lg px-4 py-2 text-sm font-medium transition-colors ${
                    isActive
                      ? 'border-b-2 border-wine-600 text-wine-600 dark:border-wine-200 dark:text-wine-200'
                      : 'text-stone-500 hover:text-stone-800 dark:text-stone-400 dark:hover:text-stone-200'
                  }`
                }
              >
                {tab.label}
                {counts ? ` · ${counts[tab.key]}` : ''}
              </NavLink>
            ))}
          </nav>

          <Routes>
            <Route path="/" element={<Placeholder />} />
            <Route path="/wishlist" element={<Placeholder />} />
            <Route path="/history" element={<Placeholder />} />
          </Routes>
        </div>
      </div>
    </HashRouter>
  );
}
