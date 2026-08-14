import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowLeft, Wine } from 'lucide-react';
import { db } from '../db.js';
import { scoreBadgeClasses } from '../theme.js';

// P20: статистика по живой базе. Без графиков-библиотек —
// полосы и чипы на CSS (расширенная статистика — v2 по ТЗ).

const chipCls =
  'rounded-full bg-stone-100 px-2.5 py-1 text-[13px] text-stone-700 dark:bg-stone-800 dark:text-stone-300';

function Metric({ value, label, sub, valueCls = '' }) {
  return (
    <div className="rounded-xl bg-white p-3.5 dark:bg-stone-900">
      <p className={`text-2xl font-semibold tabular-nums ${valueCls}`}>{value}</p>
      <p className="mt-0.5 text-[12px] text-stone-500 dark:text-stone-400">
        {label}
        {sub && <span className="text-stone-400 dark:text-stone-500"> {sub}</span>}
      </p>
    </div>
  );
}

function Block({ title, children }) {
  return (
    <div className="mt-4">
      <h2 className="text-[13px] font-medium text-stone-500 dark:text-stone-400">{title}</h2>
      <div className="mt-2">{children}</div>
    </div>
  );
}

export default function StatsScreen() {
  const navigate = useNavigate();

  const stats = useLiveQuery(async () => {
    const wines = await db.wines.toArray();
    const tastings = await db.tastings.toArray();

    const bottles = wines
      .filter((w) => w.status === 'cellar')
      .reduce((a, w) => a + (w.quantity ?? 0), 0);
    const triedWines = new Set(tastings.map((t) => t.wineId)).size;
    const avgScore = tastings.length
      ? tastings.reduce((a, t) => a + (t.totalScore ?? 0), 0) / tastings.length
      : null;

    // топ стран — по всем винам, включая Историю
    const countryCounts = {};
    for (const w of wines) if (w.country) countryCounts[w.country] = (countryCounts[w.country] ?? 0) + 1;
    const countries = Object.entries(countryCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
    const countryMax = countries[0]?.[1] ?? 1;

    // топ сортов — по числу дегустаций сорта (первый сорт вина)
    const byId = new Map(wines.map((w) => [w.id, w]));
    const grapeCounts = {};
    const aromaCounts = {};
    for (const t of tastings) {
      const grape = byId.get(t.wineId)?.grapes?.[0]?.name;
      if (grape) grapeCounts[grape] = (grapeCounts[grape] ?? 0) + 1;
      for (const a of t.aromas ?? []) aromaCounts[a] = (aromaCounts[a] ?? 0) + 1;
    }
    const grapes = Object.entries(grapeCounts).sort((a, b) => b[1] - a[1]).slice(0, 6);
    const aromas = Object.entries(aromaCounts).sort((a, b) => b[1] - a[1]).slice(0, 8);

    // средняя цена бутылки — по винам с указанной ценой (≥3, иначе не показываем)
    const priced = wines.filter((w) => w.price > 0);
    const avgPrice =
      priced.length >= 3
        ? Math.round(priced.reduce((a, w) => a + w.price, 0) / priced.length)
        : null;

    return {
      bottles,
      triedWines,
      tastingsCount: tastings.length,
      avgScore,
      countries,
      countryMax,
      grapes,
      aromas,
      avgPrice,
      pricedCount: priced.length,
    };
  });

  if (!stats) return null;
  const empty = stats.tastingsCount === 0;

  return (
    <div className="px-4 py-5 pb-10">
      <button
        onClick={() => navigate(-1)}
        className="mb-4 flex items-center gap-1 text-sm font-medium text-wine-600 dark:text-wine-400"
      >
        <ArrowLeft className="size-4" /> Назад
      </button>
      <h1 className="text-xl font-semibold">Статистика</h1>

      {/* Метрики 2×2 */}
      <div className="mt-4 grid grid-cols-2 gap-2.5">
        <Metric value={stats.bottles} label="В погребе" sub="бут." />
        <Metric value={stats.triedWines} label="Попробовано вин" />
        <Metric value={stats.tastingsCount} label="Дегустаций" />
        <Metric
          value={stats.avgScore != null ? stats.avgScore.toFixed(1) : '—'}
          label="Средняя оценка"
          valueCls={
            stats.avgScore != null
              ? `inline-block rounded-lg px-2 ${scoreBadgeClasses(stats.avgScore)}`
              : ''
          }
        />
      </div>

      {empty && (
        <div className="mt-6 flex flex-col items-center gap-2 rounded-xl bg-white px-6 py-8 text-center dark:bg-stone-900">
          <Wine className="size-8 text-stone-300 dark:text-stone-600" strokeWidth={1.5} />
          <p className="text-sm text-stone-500 dark:text-stone-400">
            Продегустируй первое вино — здесь оживут сорта, ароматы и оценки
          </p>
        </div>
      )}

      {stats.countries.length > 0 && (
        <Block title="Топ стран">
          <div className="space-y-2 rounded-xl bg-white p-3.5 dark:bg-stone-900">
            {stats.countries.map(([country, n]) => (
              <div key={country} className="flex items-center gap-2.5">
                <span className="w-20 shrink-0 truncate text-[13px]">{country}</span>
                <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-stone-100 dark:bg-stone-800">
                  <div
                    className="h-full rounded-full bg-wine-600 dark:bg-wine-400"
                    style={{ width: `${(n / stats.countryMax) * 100}%` }}
                  />
                </div>
                <span className="w-5 shrink-0 text-right text-[13px] tabular-nums text-stone-500 dark:text-stone-400">
                  {n}
                </span>
              </div>
            ))}
          </div>
        </Block>
      )}

      {stats.grapes.length > 0 && (
        <Block title="Топ сортов">
          <div className="flex flex-wrap gap-1.5">
            {stats.grapes.map(([grape, n]) => (
              <span key={grape} className={chipCls}>
                {grape} · {n}
              </span>
            ))}
          </div>
        </Block>
      )}

      {stats.aromas.length > 0 && (
        <Block title="Топ ароматов">
          <div className="flex flex-wrap gap-1.5">
            {stats.aromas.map(([aroma, n]) => (
              <span key={aroma} className={chipCls}>
                {aroma} · {n}
              </span>
            ))}
          </div>
        </Block>
      )}

      {stats.avgPrice != null && (
        <Block title="Средняя цена бутылки">
          <div className="rounded-xl bg-white p-3.5 dark:bg-stone-900">
            <p className="text-lg font-semibold tabular-nums">
              {stats.avgPrice.toLocaleString('ru-RU')} ₽
            </p>
            <p className="mt-0.5 text-[12px] text-stone-400 dark:text-stone-500">
              по {stats.pricedCount} винам с указанной ценой
            </p>
          </div>
        </Block>
      )}
    </div>
  );
}
