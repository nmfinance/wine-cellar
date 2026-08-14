import { useEffect, useState } from 'react';
import { db } from '../db.js';
import { buildTasteProfileData, getPersonalThreshold } from '../ai/profile.js';
import { formatTasteProfile } from '../ai/profileCore.js';
import { pluralize } from '../utils/plural.js';
import BottomSheet from './BottomSheet.jsx';

// P19: «что сомелье знает обо мне» — прозрачность профиля вкуса.
// Пересчитывается на каждое открытие (живой).

const fmtScore = (n) => n.toFixed(1).replace('.', ',');

function GrapeChips({ items, tone }) {
  const tones = {
    love: 'bg-wine-100 text-wine-700 dark:bg-wine-900 dark:text-wine-200',
    neutral: 'bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300',
    dislike: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  };
  return (
    <div className="mt-1.5 flex flex-wrap gap-1.5">
      {items.map((g) => (
        <span key={g.grape} className={`rounded-full px-2.5 py-1 text-[13px] ${tones[tone]}`}>
          {g.grape} · {fmtScore(g.avg)}
          {g.once ? ' · единожды' : ''}
        </span>
      ))}
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div className="mt-4">
      <h3 className="text-[13px] font-medium text-stone-500 dark:text-stone-400">{title}</h3>
      {children}
    </div>
  );
}

export default function TasteProfileSheet({ open, onClose }) {
  const [state, setState] = useState(null);
  const [showRaw, setShowRaw] = useState(false);

  useEffect(() => {
    if (!open) return;
    setState(null);
    setShowRaw(false);
    (async () => {
      const threshold = await getPersonalThreshold();
      const tastingsCount = await db.tastings.count();
      const personal = tastingsCount >= threshold;
      const data = personal
        ? await buildTasteProfileData(threshold)
        : tastingsCount >= 3
          ? await buildTasteProfileData(3)
          : null;
      setState({ threshold, tastingsCount, personal, data });
    })();
  }, [open]);

  const d = state?.data;

  return (
    <BottomSheet open={open} onClose={onClose} title="Твой профиль вкуса">
      <div className="max-h-[70dvh] overflow-y-auto px-4 pt-1 pb-6">
        {!state ? null : state.personal ? (
          <>
            <p className="text-[13px] text-stone-500 dark:text-stone-400">
              ✨ Персональный режим: {state.tastingsCount}{' '}
              {pluralize(state.tastingsCount, 'дегустация', 'дегустации', 'дегустаций')}, средняя{' '}
              {fmtScore(d.avgAll)}
            </p>
            {d.loves.length > 0 && (
              <Section title="Любишь">
                <GrapeChips items={d.loves} tone="love" />
                {d.loveRegions.length > 0 && (
                  <p className="mt-1.5 text-[13px] text-stone-600 dark:text-stone-300">
                    {d.loveRegions.join(' · ')}
                  </p>
                )}
              </Section>
            )}
            {d.neutral.length > 0 && (
              <Section title="Нейтрально">
                <GrapeChips items={d.neutral} tone="neutral" />
              </Section>
            )}
            {d.dislikes.length > 0 && (
              <Section title="Не зашло">
                <GrapeChips items={d.dislikes} tone="dislike" />
                {d.dislikes
                  .filter((g) => g.note)
                  .map((g) => (
                    <p key={g.grape} className="mt-1.5 text-[13px] text-stone-500 italic dark:text-stone-400">
                      {g.grape}: «{g.note}»
                    </p>
                  ))}
              </Section>
            )}
            {d.topAromas.length > 0 && (
              <Section title="Ароматы твоих фаворитов">
                <p className="mt-1 text-sm text-stone-700 dark:text-stone-300">
                  {d.topAromas.join(' · ')}
                </p>
                {/* ароматы попадают в подстановку только внутри строки «Любит» */}
                {d.loves.length === 0 && (
                  <p className="mt-1 text-[11px] text-stone-400 dark:text-stone-500">
                    наблюдение · пока не участвует в рекомендациях
                  </p>
                )}
              </Section>
            )}
            {d.budget && (
              <Section title="Обычный бюджет">
                <p className="mt-1 text-sm text-stone-700 dark:text-stone-300">{d.budget}</p>
              </Section>
            )}

            <p className="mt-5 text-[11px] text-stone-400 dark:text-stone-500">
              Этот текст уходит AI при анализе винной карты
            </p>
            <button
              onClick={() => setShowRaw((v) => !v)}
              className="mt-1 text-[13px] font-medium text-wine-600 dark:text-wine-400"
            >
              {showRaw ? 'Скрыть' : 'Показать как есть'}
            </button>
            {showRaw && (
              <pre className="mt-2 rounded-lg bg-stone-100 p-3 text-[11px] leading-relaxed whitespace-pre-wrap text-stone-600 dark:bg-stone-800 dark:text-stone-300">
                {formatTasteProfile(d)}
              </pre>
            )}
          </>
        ) : (
          <>
            <p className="text-sm text-stone-700 dark:text-stone-300">
              Сомелье учится на твоих дегустациях: сорта, ароматы и бюджет складываются в профиль
              вкуса. После {state.threshold}{' '}
              {pluralize(state.threshold, 'дегустации', 'дегустаций', 'дегустаций')} рекомендации в
              винной карте станут персональными — пока {state.tastingsCount} из {state.threshold}.
            </p>
            {d && (
              <Section title="Что уже видно">
                <div className="mt-1 space-y-1">
                  {[...d.loves, ...d.neutral]
                    .sort((a, b) => b.n - a.n || b.avg - a.avg)
                    .slice(0, 4)
                    .map((g) => (
                      <p key={g.grape} className="text-sm text-stone-700 dark:text-stone-300">
                        {g.grape} — средняя {fmtScore(g.avg)} по {g.n}{' '}
                        {pluralize(g.n, 'дегустации', 'дегустациям', 'дегустациям')}
                      </p>
                    ))}
                  {d.dislikes.map((g) => (
                    <p key={g.grape} className="text-sm text-stone-700 dark:text-stone-300">
                      {g.grape} — не зашло ({fmtScore(g.avg)}
                      {g.once ? ', единожды' : ''})
                    </p>
                  ))}
                  {d.budget && (
                    <p className="text-sm text-stone-700 dark:text-stone-300">
                      обычный бюджет {d.budget}
                    </p>
                  )}
                </div>
              </Section>
            )}
          </>
        )}
      </div>
    </BottomSheet>
  );
}
