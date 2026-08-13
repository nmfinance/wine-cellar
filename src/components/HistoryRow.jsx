import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { Wine } from 'lucide-react';
import { db } from '../db.js';
import { moveTo, updateWine } from '../data/wines.js';
import { PLACEHOLDER_BY_COLOR, scoreBadgeClasses } from '../theme.js';
import { pluralize } from '../utils/plural.js';

const fmtDay = (iso) =>
  iso
    ? new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }).replace('.', '')
    : null;

// Строка ленты Истории: миниатюра, название, подстрока по historyReason,
// справа — оценка последней дегустации или кнопка «Купил»
export default function HistoryRow({ wine, onBought }) {
  const photo = useLiveQuery(
    () =>
      db.photos
        .where('wineId')
        .equals(wine.id)
        .filter((p) => p.kind === 'label')
        .first()
        .then((p) => p ?? null),
    [wine.id]
  );
  const tastings = useLiveQuery(
    () => db.tastings.where('wineId').equals(wine.id).sortBy('date'),
    [wine.id]
  );

  const [photoUrl, setPhotoUrl] = useState(null);
  useEffect(() => {
    if (!photo?.blob) {
      setPhotoUrl(null);
      return;
    }
    const url = URL.createObjectURL(photo.blob);
    setPhotoUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  const placeholder = PLACEHOLDER_BY_COLOR[wine.color] ?? PLACEHOLDER_BY_COLOR.red;
  const last = tastings?.at(-1) ?? null;
  const day = fmtDay(wine.historyAt);

  let subtitle = null;
  if (wine.historyReason === 'drunk') {
    const n = tastings?.length ?? 0;
    subtitle = (
      <>
        <span className="text-stone-500 dark:text-stone-400">выпито</span>
        {` · ${n} ${pluralize(n, 'дегустация', 'дегустации', 'дегустаций')}`}
        {day && ` · ${day}`}
      </>
    );
  } else if (wine.historyReason === 'scanned') {
    subtitle = `📷 скан в магазине${day ? ` · ${day}` : ''}`;
  } else if (wine.historyReason === 'winelist') {
    // название ресторана появится, когда сканы карт начнут ссылаться на вина
    subtitle = `📷 из винной карты${day ? ` · ${day}` : ''}`;
  }

  const buy = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    await moveTo(wine.id, 'cellar');
    await updateWine(wine.id, { quantity: 1 });
    onBought?.();
  };

  return (
    <Link
      to={`/wine/${wine.id}`}
      className="flex items-center gap-2.5 rounded-lg bg-white p-2 dark:bg-stone-900"
    >
      {photoUrl ? (
        <img src={photoUrl} alt="" className="h-10 w-8 shrink-0 rounded-md object-cover" />
      ) : (
        <span
          className="grid h-10 w-8 shrink-0 place-items-center rounded-md"
          style={{ background: placeholder.bg }}
        >
          <Wine className="size-4" style={{ color: placeholder.icon }} strokeWidth={1.5} />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium text-stone-900 dark:text-stone-100">
          {wine.name}
        </span>
        {subtitle && (
          <span className="block truncate text-[11px] text-stone-400 dark:text-stone-500">
            {subtitle}
          </span>
        )}
      </span>
      {tastings !== undefined &&
        (last ? (
          <span
            className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${scoreBadgeClasses(last.totalScore)}`}
          >
            {last.totalScore.toFixed(1)}
          </span>
        ) : (
          <button
            onClick={buy}
            className="shrink-0 text-[13px] font-medium text-wine-600 dark:text-wine-400"
          >
            Купил
          </button>
        ))}
    </Link>
  );
}
