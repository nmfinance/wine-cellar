import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowLeft, ChevronDown, RefreshCw } from 'lucide-react';
import { db } from '../db.js';
import { refreshWineryInfo } from '../data/wineries.js';
import { getScoreMode, wineScore } from '../data/settings.js';
import { POSITIONING_LABEL } from '../components/WineryBlock.jsx';
import { scoreBadgeClasses } from '../theme.js';
import { usePageTitle } from '../utils/title.js';

// P22: паспорт винодельни — плотный дата-лист без фото-героя.
// Честность > полнота: пустое поле не рендерится вообще (ни прочерков,
// ни подписей-сирот), пустая секция скрыта целиком.

// цвет-словарь почв
const SOIL_COLORS = {
  известняк: '#d9d2c0',
  глина: '#b0784f',
  сланец: '#5f6672',
  песок: '#e2cf9a',
  галечник: '#9aa3ab',
  вулканические: '#6d4c4c',
};
const soilColor = (name) => {
  const key = Object.keys(SOIL_COLORS).find((k) => name?.toLowerCase().includes(k));
  return key ? SOIL_COLORS[key] : '#8a8578';
};
// палитра стек-бара сортов
const GRAPE_COLORS = ['#722f37', '#a0522d', '#5c8a5c', '#4a6b8a', '#8a6d3b', '#7a5c8a'];

// счётчик полноты: фиксированный реестр листовых слотов v3
const LEAF_GETTERS = [
  (p) => p.identity?.founded,
  (p) => p.identity?.first_vintage,
  (p) => p.identity?.appellation_zone,
  (p) => p.identity?.one_liner,
  (p) => (p.terroir?.soils?.length ? p.terroir.soils : null),
  (p) => p.terroir?.altitude_m,
  (p) => p.terroir?.aspect,
  (p) => p.terroir?.slope_deg,
  (p) => p.terroir?.climate,
  (p) => p.vineyard?.area_ha,
  (p) => (p.vineyard?.grapes?.length ? p.vineyard.grapes : null),
  (p) => p.vineyard?.vine_age_avg,
  (p) => p.vineyard?.old_vines_note,
  (p) => p.vineyard?.density_per_ha,
  (p) => p.vineyard?.training,
  (p) => p.vineyard?.yield,
  (p) => p.vineyard?.farming,
  (p) => p.vineyard?.geek?.rootstocks,
  (p) => p.vineyard?.geek?.clones,
  (p) => p.cellar?.yeasts,
  (p) => p.cellar?.fermentation,
  (p) => p.cellar?.aging,
  (p) => p.cellar?.flags?.unfiltered,
  (p) => p.cellar?.flags?.unfined,
  (p) => p.cellar?.flags?.low_so2,
  (p, w) => w.opinion,
  (p, w) => w.positioning,
  (p, w) => w.history,
  (p, w) => w.locationHint,
  (p) => p.knownLevel,
  ...[0, 1, 2, 3, 4].map((i) => (p) => p.wines?.[i]?.name),
];
const completeness = (winery) => {
  const p = winery.passport ?? {};
  const filled = LEAF_GETTERS.filter((g) => {
    const v = g(p, winery);
    return v != null && v !== '' && !(Array.isArray(v) && !v.length);
  }).length;
  return { filled, total: LEAF_GETTERS.length };
};

// стек-бар долей (почвы/сорта); без долей → равные сегменты
function StackBar({ items, colorFor, noSharesNote }) {
  const known = items.every((i) => typeof i.share === 'number' && i.share > 0);
  const total = known ? items.reduce((a, i) => a + i.share, 0) : items.length;
  return (
    <div>
      <div className="flex h-3 overflow-hidden rounded-full">
        {items.map((it, i) => (
          <div
            key={it.name}
            style={{
              width: `${((known ? it.share : 1) / total) * 100}%`,
              background: colorFor(it.name, i),
            }}
          />
        ))}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5">
        {items.map((it, i) => (
          <span key={it.name} className="flex items-center gap-1 text-[12px] text-stone-600 dark:text-stone-300">
            <span className="size-2 rounded-full" style={{ background: colorFor(it.name, i) }} />
            {it.name}
            {known && <span className="tabular-nums text-stone-400">{it.share}%</span>}
          </span>
        ))}
      </div>
      {!known && noSharesNote && (
        <p className="mt-0.5 text-[11px] text-stone-400 dark:text-stone-500">{noSharesNote}</p>
      )}
    </div>
  );
}

// строка дата-листа: label 11px muted + значение; пустое — не рендерится
function Row({ label, children }) {
  if (children == null || children === '') return null;
  return (
    <div className="flex items-baseline gap-2 py-0.5">
      <span className="w-24 shrink-0 text-[11px] text-stone-400 uppercase dark:text-stone-500">{label}</span>
      <span className="text-sm tabular-nums text-stone-800 dark:text-stone-200">{children}</span>
    </div>
  );
}

function Section({ title, show = true, children }) {
  if (!show) return null;
  return (
    <div className="mx-4 mt-3 rounded-xl bg-white p-3.5 dark:bg-stone-900">
      <h2 className="mb-1.5 text-[13px] font-semibold text-stone-500 dark:text-stone-400">{title}</h2>
      {children}
    </div>
  );
}

export default function WineryScreen() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [geekOpen, setGeekOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const winery = useLiveQuery(() => db.wineries.get(id).then((w) => w ?? null), [id]);
  usePageTitle(winery?.name ?? null);

  // вина пользователя от этой винодельни + оценки + vintage_note
  const myWines = useLiveQuery(
    async () => {
      if (!id) return [];
      const wines = await db.wines.filter((w) => w.wineryId === id).toArray();
      const mode = await getScoreMode();
      return Promise.all(
        wines.map(async (w) => ({ ...w, myScore: await wineScore(w, mode) }))
      );
    },
    [id]
  );

  if (winery === undefined) return null;
  if (winery === null)
    return <p className="mt-10 text-center text-sm text-stone-500">Винодельня не найдена</p>;

  const p = winery.passport;
  const loading = winery.infoStatus === 'loading' || refreshing;
  const minimal = p && (p.knownLevel === 'minimal' || winery.known === false);
  const { filled, total } = p ? completeness(winery) : { filled: 0, total: 0 };

  const refresh = async () => {
    setRefreshing(true);
    try {
      await refreshWineryInfo(winery.id);
    } finally {
      setRefreshing(false);
    }
  };

  // сопоставление вин хозяйства с винами пользователя (по нормализованному вхождению)
  const userMatch = (passportWine) => {
    const nm = String(passportWine.name ?? '').toLowerCase();
    return (myWines ?? []).find(
      (w) => nm && (w.name.toLowerCase().includes(nm) || nm.includes(w.name.toLowerCase()))
    );
  };

  // «Твои винтажи»: vintage_note из aiDeep вин пользователя
  const vintageNotes = (myWines ?? [])
    .filter((w) => w.aiDeep?.vintage_note)
    .sort((a, b) => (a.year ?? 0) - (b.year ?? 0));

  const idn = p?.identity ?? {};
  const foundedLine = [
    idn.founded ? `осн. ${idn.founded}` : null,
    idn.first_vintage ? `первый винтаж ${idn.first_vintage}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="min-h-dvh pb-[calc(2rem+env(safe-area-inset-bottom))]">
      <header className="flex items-center px-2 py-2">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-1 rounded-lg px-2 py-2 text-sm font-medium text-wine-600 dark:text-wine-400"
        >
          <ArrowLeft className="size-4" /> Назад
        </button>
      </header>

      {/* Уровень 0: шапка */}
      <div className="px-4">
        <h1 className="text-xl leading-snug font-semibold">{winery.name}</h1>
        {(idn.appellation_zone ?? winery.regionNote) && (
          <p className="mt-0.5 text-sm text-stone-500 dark:text-stone-400">
            {idn.appellation_zone ?? winery.regionNote}
          </p>
        )}
        {foundedLine && (
          <p className="mt-0.5 text-[13px] tabular-nums text-stone-500 dark:text-stone-400">{foundedLine}</p>
        )}
        {idn.one_liner && (
          <p className="mt-1.5 text-sm text-stone-600 italic dark:text-stone-300">{idn.one_liner}</p>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {winery.positioning && POSITIONING_LABEL[winery.positioning] && (
            <span className="rounded-full bg-stone-200 px-2 py-0.5 text-[11px] text-stone-700 dark:bg-stone-800 dark:text-stone-300">
              {POSITIONING_LABEL[winery.positioning]}
            </span>
          )}
          {p?.vineyard?.farming && (
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
              {p.vineyard.farming.split(/[,(]/)[0].trim()}
            </span>
          )}
        </div>

        {/* индикатор полноты / старый профиль */}
        {p ? (
          <div className="mt-3">
            <div className="flex items-center justify-between text-[11px] text-stone-400 dark:text-stone-500">
              <span>
                профиль: {filled} из {total}
              </span>
              <button
                onClick={refresh}
                disabled={loading}
                className="flex items-center gap-1 font-medium text-wine-600 disabled:opacity-50 dark:text-wine-400"
              >
                <RefreshCw className={`size-3 ${loading ? 'animate-spin' : ''}`} /> Обновить профиль
              </button>
            </div>
            <div className="mt-1 h-1 overflow-hidden rounded-full bg-stone-200 dark:bg-stone-800">
              <div
                className="h-full rounded-full bg-wine-600 dark:bg-wine-400"
                style={{ width: `${(filled / total) * 100}%` }}
              />
            </div>
          </div>
        ) : (
          <div className="mt-3 flex items-center justify-between text-[12px] text-stone-500 dark:text-stone-400">
            <span>краткий профиль</span>
            <button
              onClick={refresh}
              disabled={loading}
              className="flex items-center gap-1 font-medium text-wine-600 disabled:opacity-50 dark:text-wine-400"
            >
              <RefreshCw className={`size-3 ${loading ? 'animate-spin' : ''}`} /> Обновить профиль
            </button>
          </div>
        )}
      </div>

      {/* known_level=minimal → компактный вид */}
      {minimal && (
        <Section title="">
          <p className="text-sm text-stone-600 dark:text-stone-300">
            AI знает об этом хозяйстве мало — ниже только справка о зоне.
          </p>
          {(winery.opinion ?? winery.aiSummary) && (
            <p className="mt-2 text-sm text-stone-700 dark:text-stone-300">
              {winery.opinion ?? winery.aiSummary}
            </p>
          )}
        </Section>
      )}

      {/* Уровень 1 */}
      {p && !minimal && (
        <>
          <Section
            title="Терруар"
            show={!!(p.terroir?.soils?.length || p.terroir?.altitude_m || p.terroir?.aspect || p.terroir?.climate)}
          >
            {p.terroir?.soils?.length > 0 && (
              <div className="mb-2">
                <StackBar
                  items={p.terroir.soils}
                  colorFor={(name) => soilColor(name)}
                  noSharesNote="состав без долей"
                />
              </div>
            )}
            <Row label="Высота">{p.terroir?.altitude_m && `${p.terroir.altitude_m} м`}</Row>
            <Row label="Экспозиция">
              {[p.terroir?.aspect, p.terroir?.slope_deg ? `уклон ${p.terroir.slope_deg}°` : null]
                .filter(Boolean)
                .join(' · ') || null}
            </Row>
            <Row label="Климат">{p.terroir?.climate}</Row>
          </Section>

          <Section
            title="Виноградник"
            show={!!(p.vineyard?.area_ha || p.vineyard?.grapes?.length || p.vineyard?.farming)}
          >
            <Row label="Площадь">{p.vineyard?.area_ha && `${p.vineyard.area_ha} га`}</Row>
            {p.vineyard?.grapes?.length > 0 && (
              <div className="my-2">
                <StackBar
                  items={p.vineyard.grapes}
                  colorFor={(_, i) => GRAPE_COLORS[i % GRAPE_COLORS.length]}
                  noSharesNote="сортовой состав без долей"
                />
              </div>
            )}
            <Row label="Лозы">{p.vineyard?.vine_age_avg && `в среднем ${p.vineyard.vine_age_avg} лет`}</Row>
            {p.vineyard?.old_vines_note && (
              <p className="my-1 rounded-lg bg-amber-50 px-2.5 py-1.5 text-[13px] text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                🌳 {p.vineyard.old_vines_note}
              </p>
            )}
            <Row label="Посадка">
              {[
                p.vineyard?.density_per_ha ? `${p.vineyard.density_per_ha} лоз/га` : null,
                p.vineyard?.training,
              ]
                .filter(Boolean)
                .join(' · ') || null}
            </Row>
            <Row label="Урожайность">{p.vineyard?.yield}</Row>
            <Row label="Ведение">{p.vineyard?.farming}</Row>
          </Section>

          <Section
            title="Погреб"
            show={!!(p.cellar?.yeasts || p.cellar?.fermentation || p.cellar?.aging || p.cellar?.flags?.unfiltered || p.cellar?.flags?.unfined || p.cellar?.flags?.low_so2)}
          >
            <Row label="Дрожжи">{p.cellar?.yeasts}</Row>
            <Row label="Ферментация">{p.cellar?.fermentation}</Row>
            <Row label="Выдержка">{p.cellar?.aging}</Row>
            {(p.cellar?.flags?.unfiltered || p.cellar?.flags?.unfined || p.cellar?.flags?.low_so2) && (
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {p.cellar.flags.unfiltered && <FlagChip>без фильтрации</FlagChip>}
                {p.cellar.flags.unfined && <FlagChip>без оклейки</FlagChip>}
                {p.cellar.flags.low_so2 && <FlagChip>низкий SO₂</FlagChip>}
              </div>
            )}
          </Section>

          <Section title="Вина хозяйства" show={p.wines?.length > 0}>
            <div className="space-y-2">
              {(p.wines ?? []).map((w) => {
                const mine = userMatch(w);
                return (
                  <div key={w.name} className="border-b border-stone-100 pb-2 last:border-0 last:pb-0 dark:border-stone-800">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="min-w-0 text-sm font-medium">{w.name}</p>
                      {w.production_bottles && (
                        <span className="shrink-0 font-mono text-[12px] tabular-nums text-stone-500 dark:text-stone-400">
                          {w.production_bottles.toLocaleString('ru-RU')} бут.
                        </span>
                      )}
                    </div>
                    <p className="text-[12px] text-stone-500 dark:text-stone-400">
                      {[w.grapes, w.style, w.vintages].filter(Boolean).join(' · ')}
                    </p>
                    {mine && (
                      <Link to={`/wine/${mine.id}`} className="mt-0.5 inline-flex items-center gap-1.5">
                        <span className="rounded-full bg-wine-100 px-2 py-0.5 text-[11px] font-medium text-wine-700 dark:bg-wine-900 dark:text-wine-200">
                          у тебя{mine.quantity > 0 ? ` ×${mine.quantity}` : ''}
                        </span>
                        {mine.myScore != null && (
                          <span className={`rounded-full px-1.5 py-0.5 text-[11px] font-semibold ${scoreBadgeClasses(mine.myScore)}`}>
                            {mine.myScore.toFixed(1)}
                          </span>
                        )}
                      </Link>
                    )}
                  </div>
                );
              })}
            </div>
          </Section>
        </>
      )}

      {/* Твои винтажи — и для старых профилей тоже */}
      <Section title="Твои винтажи" show={vintageNotes.length > 0}>
        <div className="space-y-1.5">
          {vintageNotes.map((w) => (
            <p key={w.id} className="text-[13px] text-stone-700 dark:text-stone-300">
              <Link to={`/wine/${w.id}`} className="font-semibold tabular-nums text-wine-600 dark:text-wine-400">
                {w.nvFlag ? 'NV' : w.year}
              </Link>{' '}
              — {w.aiDeep.vintage_note.replace(/^\d{4}:\s*/, '')}
            </p>
          ))}
        </div>
      </Section>

      {/* Мнение и история */}
      <Section title="Мнение" show={!!(winery.opinion ?? winery.aiSummary) && !minimal}>
        <p className="text-sm text-stone-700 dark:text-stone-300">
          {winery.opinion ?? winery.aiSummary}
        </p>
      </Section>
      <Section title="История" show={!!winery.history && !minimal}>
        <p className="text-sm text-stone-700 dark:text-stone-300">{winery.history}</p>
      </Section>

      {/* старый профиль (без passport): прежние поля */}
      {!p && !loading && (
        <>
          <Section title="О винодельне" show={!!(winery.regionNote || winery.portfolio)}>
            {winery.regionNote && <p className="text-sm text-stone-700 dark:text-stone-300">{winery.regionNote}</p>}
            {winery.portfolio && (
              <p className="mt-1 text-[13px] text-stone-500 dark:text-stone-400">{winery.portfolio}</p>
            )}
            {winery.notableWines && (
              <p className="mt-1 text-[13px] text-stone-500 dark:text-stone-400">
                Знаковые вина: {winery.notableWines}
              </p>
            )}
          </Section>
        </>
      )}

      {/* Уровень 2: для гиков */}
      {p && !minimal && (p.vineyard?.geek?.rootstocks || p.vineyard?.geek?.clones) && (
        <div className="mx-4 mt-3 rounded-xl bg-white p-3.5 dark:bg-stone-900">
          <button
            onClick={() => setGeekOpen((v) => !v)}
            className="flex w-full items-center justify-between text-[13px] font-semibold text-stone-500 dark:text-stone-400"
          >
            Для гиков
            <ChevronDown className={`size-4 transition-transform ${geekOpen ? 'rotate-180' : ''}`} />
          </button>
          {geekOpen && (
            <div className="mt-1.5">
              <Row label="Подвои">{p.vineyard.geek.rootstocks}</Row>
              <Row label="Клоны">{p.vineyard.geek.clones}</Row>
            </div>
          )}
        </div>
      )}

      {loading && (
        <p className="mt-4 animate-pulse text-center text-sm text-stone-400">обновляю паспорт…</p>
      )}
    </div>
  );
}

function FlagChip({ children }) {
  return (
    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
      {children}
    </span>
  );
}
