import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { facetOptions, listFiltered } from '../data/wines.js';
import { STATIC_OPTIONS, emptyFilters, pluralWines, toggleFilter } from '../data/filters.js';
import BottomSheet from './BottomSheet.jsx';

function Chip({ active, children, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`shrink-0 rounded-full border px-3 py-1.5 text-[13px] transition-colors ${
        active
          ? 'border-wine-600 bg-wine-600 text-white dark:border-wine-400 dark:bg-wine-400 dark:text-stone-950'
          : 'border-stone-300 text-stone-700 dark:border-stone-600 dark:text-stone-300'
      }`}
    >
      {children}
    </button>
  );
}

function Section({ title, children }) {
  return (
    <div className="px-4 pt-3">
      <h3 className="mb-2 text-xs font-medium text-stone-500 dark:text-stone-400">{title}</h3>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

// Шит фильтров: правки копятся в черновике, применяются кнопкой «Показать N»
export default function FilterSheet({ open, onClose, status, query, applied, onApply }) {
  const [draft, setDraft] = useState(applied);

  useEffect(() => {
    if (open) setDraft(applied);
  }, [open, applied]);

  const facets = useLiveQuery(() => facetOptions(status), [status]);
  const results = useLiveQuery(
    () => listFiltered(status, query, draft),
    [status, query, draft]
  );
  const count = results?.length ?? 0;

  const toggle = (section, value) => setDraft((d) => toggleFilter(d, section, value));

  const staticSection = (key, title) => (
    <Section title={title}>
      {STATIC_OPTIONS[key].map(([value, label]) => (
        <Chip key={value} active={draft[key].includes(value)} onClick={() => toggle(key, value)}>
          {label}
        </Chip>
      ))}
    </Section>
  );

  const dynamicSection = (key, title, options) =>
    options?.length > 0 && (
      <Section title={title}>
        {options.map((value) => (
          <Chip key={value} active={draft[key].includes(value)} onClick={() => toggle(key, value)}>
            {value}
          </Chip>
        ))}
      </Section>
    );

  return (
    <BottomSheet open={open} onClose={onClose} title="Фильтры">
      <div className="max-h-[65dvh] overflow-y-auto pb-2">
        {staticSection('colors', 'Цвет')}
        {staticSection('sweetness', 'Сахар')}
        {staticSection('special', 'Особое')}
        {dynamicSection('countries', 'Страна', facets?.countries)}
        {dynamicSection('grapes', 'Сорт', facets?.grapes)}
        {staticSection('tasted', 'Дегустации')}
      </div>

      <div className="flex gap-2 border-t border-stone-200 p-4 dark:border-stone-800">
        <button
          onClick={() => setDraft(emptyFilters())}
          className="rounded-lg px-4 py-2.5 text-sm font-medium text-stone-600 dark:text-stone-300"
        >
          Сбросить
        </button>
        <button
          disabled={count === 0}
          onClick={() => {
            onApply(draft);
            onClose();
          }}
          className="flex-1 rounded-lg bg-wine-600 py-2.5 text-sm font-medium text-white disabled:bg-stone-300 disabled:text-stone-500 dark:bg-wine-400 dark:text-stone-950 dark:disabled:bg-stone-700 dark:disabled:text-stone-400"
        >
          {count > 0 ? `Показать ${count} ${pluralWines(count)}` : 'Ничего не найдено'}
        </button>
      </div>
    </BottomSheet>
  );
}
