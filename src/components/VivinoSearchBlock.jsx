import { useEffect, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { lookupVivinoCached } from '../api/vivino.js';
import { matchScore } from '../api/score.js';
import { pluralize } from '../utils/plural.js';

const sourceLabel = (data) => {
  if (data.source === 'vintage') return 'этот винтаж';
  if (data.source === 'nearby_vintage')
    return data.matchedYear ? `винтаж ${data.matchedYear}` : 'соседний винтаж';
  return 'все годы';
};

// Блок «Рейтинг Vivino» в форме scan-review: авто-поиск при монтировании,
// скоринг матча на клиенте, ручной поиск при промахе.
export default function VivinoSearchBlock({ initialQuery, year, onResult }) {
  const [query, setQuery] = useState(initialQuery);
  const [editOpen, setEditOpen] = useState(false);
  const [state, setState] = useState({ phase: 'loading' });
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true; // StrictMode: cleanup первого монтирования не должен «убивать» второе
    return () => {
      alive.current = false;
    };
  }, []);

  const search = async (q) => {
    setState({ phase: 'loading' });
    const res = await lookupVivinoCached(q.trim(), year);
    if (!alive.current) return;
    if (res.ok) {
      const score = matchScore(q, res.data.matchedName);
      if (score === 'low') {
        // низкий матч: рейтинг не подставляем, сразу ручной поиск
        setState({ phase: 'not_found', lowMatch: res.data.matchedName });
        setEditOpen(true);
        onResult(null);
      } else {
        setState({ phase: 'found', data: res.data, score });
        setEditOpen(false);
        onResult({
          ...res.data,
          matchScore: score,
          checkedAt: new Date().toISOString(),
          manual: false,
        });
      }
    } else if (res.error === 'not_found') {
      setState({ phase: 'not_found' });
      setEditOpen(true);
      onResult(null);
    } else {
      setState({ phase: 'unavailable' });
      onResult(null);
    }
  };

  useEffect(() => {
    search(initialQuery);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const check = state.phase === 'found' && state.score === 'medium';

  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-stone-500 dark:text-stone-400">
        Рейтинг Vivino
      </label>
      <div
        className={`rounded-xl bg-white p-3 dark:bg-stone-900 ${
          check ? 'border border-amber-400 dark:border-amber-500' : ''
        }`}
      >
        {state.phase === 'loading' && (
          <p className="animate-pulse text-sm text-stone-400 dark:text-stone-500">
            ищу на Vivino…
          </p>
        )}

        {state.phase === 'found' && (
          <>
            <p className="text-sm">
              ★ {state.data.rating?.toFixed(1)}
              {state.data.ratingsCount != null && (
                <>
                  {' · '}
                  {state.data.ratingsCount.toLocaleString('ru-RU')}{' '}
                  {pluralize(state.data.ratingsCount, 'оценка', 'оценки', 'оценок')}
                </>
              )}
              <span className="ml-1.5 text-xs text-stone-400">{sourceLabel(state.data)}</span>
            </p>
            <div className="mt-1 flex items-baseline justify-between gap-2">
              <p className="min-w-0 truncate text-[11px] text-stone-400 dark:text-stone-500">
                {check ? 'Проверь: ' : 'Нашёл: '}
                {state.data.matchedName}
              </p>
              <button
                type="button"
                onClick={() => setEditOpen(true)}
                className="shrink-0 text-[11px] font-medium text-wine-600 dark:text-wine-400"
              >
                Не то вино?
              </button>
            </div>
          </>
        )}

        {state.phase === 'not_found' && (
          <p className="text-sm text-stone-500 dark:text-stone-400">
            {state.lowMatch
              ? `Похожего не нашлось (ближайшее: ${state.lowMatch})`
              : 'На Vivino не нашлось'}{' '}
            — поправь запрос или введи рейтинг вручную ниже.
          </p>
        )}

        {state.phase === 'unavailable' && (
          <p className="text-sm text-stone-500 dark:text-stone-400">
            Рейтинг временно недоступен — можно ввести вручную ниже.
          </p>
        )}

        {editOpen && state.phase !== 'loading' && (
          <div className="mt-2 flex gap-1.5">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="h-9 w-full rounded-lg border border-stone-200 bg-white px-3 text-sm outline-none focus:border-wine-400 dark:border-stone-700 dark:bg-stone-800"
              placeholder="winery название сорт"
            />
            <button
              type="button"
              onClick={() => search(query)}
              className="grid size-9 shrink-0 place-items-center rounded-lg bg-wine-600 text-white dark:bg-wine-400 dark:text-stone-950"
              aria-label="Найти"
            >
              <Search className="size-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
