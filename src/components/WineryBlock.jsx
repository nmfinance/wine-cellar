import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { ChevronDown, RefreshCw } from 'lucide-react';
import { db } from '../db.js';
import { refreshWineryInfo } from '../data/wineries.js';

export const POSITIONING_LABEL = {
  massmarket: 'Массмаркет',
  premium: 'Премиум',
  boutique: 'Бутик',
  mixed: 'Смешанный портфель',
};

// Сворачиваемый блок «О винодельне»: справка S2 (история, портфель, мнение,
// знаковые вина) + «обновить справку». Используется карточкой вина и картой.
export default function WineryBlock({ wineryId, defaultOpen, plain = false }) {
  const winery = useLiveQuery(
    () => (wineryId ? db.wineries.get(wineryId) : null),
    [wineryId]
  );
  const [open, setOpen] = useState(defaultOpen);
  if (!winery) return null;

  const loading = winery.infoStatus === 'loading';
  const failed = winery.infoStatus === 'error';
  const opinion = winery.opinion ?? winery.aiSummary;
  const hasInfo = opinion || winery.regionNote || winery.founded;
  // после неудачной загрузки блок не прячем — даём «Повторить»
  if (!loading && !failed && !hasInfo) return null;

  return (
    <div className={plain ? '' : 'mx-4 mt-4 rounded-xl bg-white p-3 dark:bg-stone-900'}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 text-left"
      >
        <span className="min-w-0 truncate text-sm font-medium">О винодельне {winery.name}</span>
        <span className="flex shrink-0 items-center gap-1.5">
          {winery.positioning && POSITIONING_LABEL[winery.positioning] && (
            <span className="rounded-full bg-stone-200 px-2 py-0.5 text-[11px] text-stone-700 dark:bg-stone-800 dark:text-stone-300">
              {POSITIONING_LABEL[winery.positioning]}
            </span>
          )}
          <ChevronDown
            className={`size-4 text-stone-400 transition-transform ${open ? 'rotate-180' : ''}`}
          />
        </span>
      </button>

      {open && (
        <div className="mt-2 space-y-1.5 text-sm text-stone-700 dark:text-stone-300">
          {loading ? (
            <p className="animate-pulse text-stone-400 dark:text-stone-500">
              изучаю винодельню…
            </p>
          ) : failed && !hasInfo ? (
            <p className="text-stone-500 dark:text-stone-400">
              Справка не загрузилась — попробуй «обновить справку» при интернете
            </p>
          ) : winery.known === false && !opinion ? (
            <p>{winery.regionNote ?? 'Об этом хозяйстве пока ничего не известно.'}</p>
          ) : (
            <>
              {(winery.founded || winery.regionNote) && (
                <p className="text-xs text-stone-500 dark:text-stone-400">
                  {[winery.founded ? `основана ${winery.founded}` : null, winery.regionNote]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              )}
              {winery.history && <p>{winery.history}</p>}
              {winery.portfolio && (
                <p className="text-xs text-stone-500 dark:text-stone-400">{winery.portfolio}</p>
              )}
              {opinion && <p>{opinion}</p>}
              {winery.notableWines && (
                <p className="text-xs text-stone-500 dark:text-stone-400">
                  Знаковые вина: {winery.notableWines}
                </p>
              )}
            </>
          )}
          {!loading && (
            <button
              onClick={() => refreshWineryInfo(winery.id)}
              className="flex items-center gap-1 text-[11px] font-medium text-wine-600 dark:text-wine-400"
            >
              <RefreshCw className="size-3" /> обновить справку
            </button>
          )}
        </div>
      )}
    </div>
  );
}
