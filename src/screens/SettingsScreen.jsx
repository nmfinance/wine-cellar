import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  ArrowLeft,
  Banknote,
  ChevronRight,
  DatabaseBackup,
  Eraser,
  Info,
  Palette,
  Star,
  Warehouse,
} from 'lucide-react';
import { db } from '../db.js';
import { getToken } from '../api/yadisk.js';
import {
  SCORE_MODE_LABELS,
  THEME_LABELS,
  getScoreMode,
  getThemeSetting,
  setScoreMode,
  setThemeSetting,
} from '../data/settings.js';
import BottomSheet from '../components/BottomSheet.jsx';
import Toast from '../components/Toast.jsx';
import { usePageTitle } from '../utils/title.js';
import { version } from '../../package.json';

const fmtShort = (iso) => {
  const d = new Date(iso);
  return new Date().toDateString() === d.toDateString()
    ? `сегодня ${d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`
    : d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }).replace('.', '');
};

// < 1 МБ показываем в КБ, чтобы маленький кэш не выглядел пустым
const fmtMb = (bytes) =>
  bytes < 1024 * 1024
    ? `${Math.round(bytes / 1024)} КБ`
    : `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} МБ`;

// Шит выбора из вариантов (тема, режим оценки)
function OptionSheet({ open, onClose, title, options, current, onPick }) {
  return (
    <BottomSheet open={open} onClose={onClose} title={title}>
      <div className="flex flex-col gap-1 p-3 pb-5">
        {Object.entries(options).map(([key, label]) => (
          <button
            key={key}
            onClick={() => {
              onPick(key);
              onClose();
            }}
            className={`rounded-lg px-3 py-3 text-left text-[15px] hover:bg-stone-100 dark:hover:bg-stone-800 ${
              current === key ? 'font-medium text-wine-600 dark:text-wine-400' : ''
            }`}
          >
            {label}
            {current === key && ' ✓'}
          </button>
        ))}
      </div>
    </BottomSheet>
  );
}

export default function SettingsScreen() {
  const navigate = useNavigate();
  usePageTitle('Настройки');
  const [toast, setToast] = useState(null);
  const [sheet, setSheet] = useState(null); // 'theme' | 'score' | 'about'

  const backupStatus = useLiveQuery(async () => (await db.meta.get('backupStatus'))?.value ?? null);
  const theme = useLiveQuery(getThemeSetting) ?? 'system';
  const scoreMode = useLiveQuery(getScoreMode) ?? 'last';

  // фактический размер AI-кэша (длины JSON записей)
  const cacheSize = useLiveQuery(async () => {
    let bytes = 0;
    await db.aiCache.each((c) => {
      bytes += JSON.stringify(c).length;
    });
    return bytes;
  });

  const backupSub = !getToken()
    ? { text: 'не настроен', cls: 'text-stone-400 dark:text-stone-500' }
    : backupStatus?.status === 'error'
      ? { text: 'ошибка', cls: 'text-amber-600 dark:text-amber-400' }
      : backupStatus?.at
        ? { text: fmtShort(backupStatus.at), cls: 'text-emerald-600 dark:text-emerald-400' }
        : { text: 'подключён', cls: 'text-emerald-600 dark:text-emerald-400' };

  const subCls = 'text-stone-400 dark:text-stone-500';

  const clearCache = async () => {
    if (
      !window.confirm(
        'Очистить AI-кэш? Кэши Vivino и анализов винных карт будут удалены; справки вин и виноделен останутся.'
      )
    )
      return;
    await db.aiCache.clear();
    setToast('AI-кэш очищен');
  };

  const rows = [
    { icon: Warehouse, label: 'Мой погреб', onTap: () => navigate('/settings/cellar') },
    {
      icon: Palette,
      label: 'Тема',
      sub: { text: THEME_LABELS[theme], cls: subCls },
      onTap: () => setSheet('theme'),
    },
    {
      icon: Star,
      label: 'Оценка вина',
      sub: { text: SCORE_MODE_LABELS[scoreMode], cls: subCls },
      onTap: () => setSheet('score'),
    },
    { icon: DatabaseBackup, label: 'Бэкап', sub: backupSub, onTap: () => navigate('/settings/backup') },
    {
      icon: Banknote,
      label: 'Валюта',
      sub: { text: '₽ · фиксирована в этой версии', cls: subCls },
      onTap: null,
    },
    {
      icon: Eraser,
      label: 'Очистить AI-кэш',
      sub: { text: cacheSize != null ? fmtMb(cacheSize) : '…', cls: subCls },
      onTap: clearCache,
    },
    {
      icon: Info,
      label: 'О приложении',
      sub: { text: `v${version}`, cls: subCls },
      onTap: () => setSheet('about'),
    },
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
        {rows.map(({ icon: Icon, label, sub, onTap }, i) => (
          <button
            key={label}
            onClick={onTap ?? undefined}
            disabled={!onTap}
            className={`flex w-full items-center gap-3 px-4 py-3.5 text-left text-sm ${
              onTap ? 'hover:bg-stone-50 dark:hover:bg-stone-800' : 'cursor-default'
            } ${i > 0 ? 'border-t border-stone-100 dark:border-stone-800' : ''}`}
          >
            <Icon className="size-4.5 shrink-0 text-wine-600 dark:text-wine-400" />
            <span className="flex-1">{label}</span>
            {sub && <span className={`text-[12px] ${sub.cls}`}>{sub.text}</span>}
            {onTap && <ChevronRight className="size-4 shrink-0 text-stone-400" />}
          </button>
        ))}
      </div>

      <OptionSheet
        open={sheet === 'theme'}
        onClose={() => setSheet(null)}
        title="Тема"
        options={THEME_LABELS}
        current={theme}
        onPick={setThemeSetting}
      />
      <OptionSheet
        open={sheet === 'score'}
        onClose={() => setSheet(null)}
        title="Оценка вина"
        options={SCORE_MODE_LABELS}
        current={scoreMode}
        onPick={setScoreMode}
      />

      <BottomSheet open={sheet === 'about'} onClose={() => setSheet(null)} title="О приложении">
        <div className="px-4 pt-1 pb-6 text-center">
          <p className="text-3xl">🍷</p>
          <p className="mt-1 text-base font-medium">Мой погреб</p>
          <p className="mt-0.5 text-[13px] text-stone-500 dark:text-stone-400">версия {version}</p>
          <p className="mt-3 text-[13px] text-stone-500 dark:text-stone-400">Сделано с Claude</p>
          <a
            href="https://github.com/nmfinance/wine-cellar"
            target="_blank"
            rel="noreferrer"
            className="mt-1 inline-block text-[13px] font-medium text-wine-600 dark:text-wine-400"
          >
            github.com/nmfinance/wine-cellar
          </a>
        </div>
      </BottomSheet>

      <Toast message={toast} onDone={() => setToast(null)} />
    </div>
  );
}
