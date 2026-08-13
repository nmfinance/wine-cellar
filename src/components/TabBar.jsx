import { NavLink } from 'react-router-dom';

const TABS = [
  { to: '/', key: 'cellar', label: 'Погреб', end: true },
  { to: '/wishlist', key: 'wishlist', label: 'Wishlist' },
  { to: '/history', key: 'history', label: 'История' },
];

// Сегмент-контрол вкладок; состояние вкладки живёт в URL-хэше
export default function TabBar({ counts }) {
  return (
    <div className="mx-4 flex rounded-lg bg-stone-200 p-1 dark:bg-stone-800">
      {TABS.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          end={tab.end}
          className={({ isActive }) =>
            `flex-1 rounded-lg px-2 py-1.5 text-center text-sm font-medium transition-colors ${
              isActive
                ? 'bg-wine-100 text-wine-700 shadow-sm dark:bg-wine-800 dark:text-wine-100'
                : 'text-stone-600 hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-200'
            }`
          }
        >
          {tab.label}
          {counts ? ` · ${counts[tab.key]}` : ''}
        </NavLink>
      ))}
    </div>
  );
}
