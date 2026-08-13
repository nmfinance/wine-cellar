import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Banknote, ChevronRight, DatabaseBackup, Palette, Warehouse } from 'lucide-react';
import Toast from '../components/Toast.jsx';

export default function SettingsScreen() {
  const navigate = useNavigate();
  const [toast, setToast] = useState(null);

  const rows = [
    { icon: Warehouse, label: 'Мой погреб', onTap: () => navigate('/settings/cellar') },
    { icon: Palette, label: 'Тема', onTap: () => setToast('Скоро') },
    { icon: DatabaseBackup, label: 'Бэкап', onTap: () => setToast('Скоро') },
    { icon: Banknote, label: 'Валюта', onTap: () => setToast('Скоро') },
  ];

  return (
    <div className="px-4 py-5">
      <button
        onClick={() => navigate(-1)}
        className="mb-4 flex items-center gap-1 text-sm font-medium text-wine-600 dark:text-wine-400"
      >
        <ArrowLeft className="size-4" /> Назад
      </button>
      <h1 className="text-xl font-semibold">Настройки</h1>

      <div className="mt-4 overflow-hidden rounded-xl bg-white dark:bg-stone-900">
        {rows.map(({ icon: Icon, label, onTap }, i) => (
          <button
            key={label}
            onClick={onTap}
            className={`flex w-full items-center gap-3 px-4 py-3.5 text-left text-sm hover:bg-stone-50 dark:hover:bg-stone-800 ${
              i > 0 ? 'border-t border-stone-100 dark:border-stone-800' : ''
            }`}
          >
            <Icon className="size-4.5 shrink-0 text-wine-600 dark:text-wine-400" />
            <span className="flex-1">{label}</span>
            <ChevronRight className="size-4 shrink-0 text-stone-400" />
          </button>
        ))}
      </div>

      <Toast message={toast} onDone={() => setToast(null)} />
    </div>
  );
}
