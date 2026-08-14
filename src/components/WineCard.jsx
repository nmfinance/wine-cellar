import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { Wine } from 'lucide-react';
import { db } from '../db.js';
import { getScoreMode, wineScore } from '../data/settings.js';
import { PLACEHOLDER_BY_COLOR, formatPrice, scoreBadgeClasses } from '../theme.js';

const darkBadge =
  'rounded-full bg-black/45 px-2 py-0.5 text-xs font-medium text-white';

export default function WineCard({ wine }) {
  // фото и последняя дегустация — отдельными live-запросами,
  // null = точно нет, undefined = ещё грузится
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
  // «моя оценка» по выбранному в настройках режиму (последняя/лучшая/средняя)
  const score = useLiveQuery(
    async () => wineScore(wine, await getScoreMode()),
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
  const grapeText = wine.grapes?.length
    ? `${wine.grapes[0].name}${wine.grapes.length > 1 ? ` +${wine.grapes.length - 1}` : ''}`
    : null;
  const line2 = [yearText, grapeText].filter(Boolean).join(' · ');
  const line3 = [wine.appellation, wine.country].filter(Boolean).join(' · ');

  const price = formatPrice(wine.price, wine.currency);

  return (
    <Link
      to={`/wine/${wine.id}`}
      className="block overflow-hidden rounded-xl bg-white shadow-sm transition-transform active:scale-[0.98] dark:bg-stone-900"
    >
      <div className="relative h-[110px]" style={photoUrl ? undefined : { background: placeholder.bg }}>
        {photoUrl ? (
          <img src={photoUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <Wine
            className="absolute top-1/2 left-1/2 size-9 -translate-x-1/2 -translate-y-1/2"
            style={{ color: placeholder.icon }}
            strokeWidth={1.5}
          />
        )}

        {wine.status === 'cellar' && wine.quantity > 0 && (
          <span className={`absolute top-1.5 right-1.5 ${darkBadge}`}>×{wine.quantity}</span>
        )}
        {wine.status === 'wishlist' && price && (
          <span className={`absolute top-1.5 right-1.5 ${darkBadge}`}>{price}</span>
        )}

        {score !== undefined &&
          (score != null ? (
            <span
              className={`absolute bottom-1.5 left-1.5 rounded-full px-2 py-0.5 text-xs font-semibold ${scoreBadgeClasses(score)}`}
            >
              {score.toFixed(1)}
            </span>
          ) : (
            <span className="absolute bottom-1.5 left-1.5 rounded-full border border-dashed border-white/80 bg-black/30 px-2 py-0.5 text-[10px] text-white">
              не пробовал
            </span>
          ))}

        {wine.vivino?.rating != null && (
          <span className={`absolute right-1.5 bottom-1.5 ${darkBadge}`}>
            ★ {wine.vivino.rating.toFixed(1)}
          </span>
        )}
      </div>

      <div className="p-2.5">
        <p className="line-clamp-2 text-[13px] leading-snug font-medium text-stone-900 dark:text-stone-100">
          {wine.name}
        </p>
        {line2 && <p className="mt-0.5 text-xs text-stone-500 dark:text-stone-400">{line2}</p>}
        {line3 && <p className="mt-0.5 text-[11px] text-stone-400 dark:text-stone-500">{line3}</p>}
      </div>
    </Link>
  );
}
