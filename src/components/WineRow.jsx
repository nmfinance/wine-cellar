import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { Wine } from 'lucide-react';
import { db } from '../db.js';
import { PLACEHOLDER_BY_COLOR, scoreBadgeClasses } from '../theme.js';

// Компактная строка вина для режима «По полкам»
export default function WineRow({ wine, subtitle }) {
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
  const lastTasting = useLiveQuery(
    () =>
      db.tastings
        .where('wineId')
        .equals(wine.id)
        .sortBy('date')
        .then((arr) => arr.at(-1) ?? null),
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
  const yearText = wine.nvFlag ? 'NV' : wine.year;
  const grape = wine.grapes?.[0]?.name;
  const line = subtitle ?? [yearText, grape].filter(Boolean).join(' · ');

  return (
    <Link
      to={`/wine/${wine.id}`}
      className="flex items-center gap-2.5 rounded-lg bg-white p-2 dark:bg-stone-900"
    >
      {photoUrl ? (
        <img src={photoUrl} alt="" className="size-8 shrink-0 rounded-md object-cover" />
      ) : (
        <span
          className="grid size-8 shrink-0 place-items-center rounded-md"
          style={{ background: placeholder.bg }}
        >
          <Wine className="size-4" style={{ color: placeholder.icon }} strokeWidth={1.5} />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium text-stone-900 dark:text-stone-100">
          {wine.name}
        </span>
        {line && (
          <span className="block truncate text-[11px] text-stone-400 dark:text-stone-500">
            {line}
          </span>
        )}
      </span>
      {lastTasting !== undefined &&
        (lastTasting ? (
          <span
            className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${scoreBadgeClasses(lastTasting.totalScore)}`}
          >
            {lastTasting.totalScore.toFixed(1)}
          </span>
        ) : (
          <span className="shrink-0 rounded-full border border-dashed border-stone-300 px-2 py-0.5 text-[10px] text-stone-400 dark:border-stone-600">
            не пробовал
          </span>
        ))}
    </Link>
  );
}
