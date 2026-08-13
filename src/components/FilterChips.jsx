import { chipsOf, emptyFilters, toggleFilter } from '../data/filters.js';

// Ряд чипов активных фильтров под поиском; тап по чипу снимает фильтр
export default function FilterChips({ filters, onChange }) {
  const chips = chipsOf(filters);
  if (chips.length === 0) return null;

  return (
    <div className="mt-2 flex gap-1.5 overflow-x-auto px-4 [scrollbar-width:none]">
      {chips.map((chip) => (
        <button
          key={`${chip.section}:${chip.value}`}
          onClick={() => onChange(toggleFilter(filters, chip.section, chip.value))}
          className="shrink-0 rounded-full bg-wine-600 py-1 pr-2.5 pl-3 text-[13px] whitespace-nowrap text-white dark:bg-wine-400 dark:text-stone-950"
        >
          {chip.label} <span className="opacity-70">×</span>
        </button>
      ))}
      {chips.length >= 2 && (
        <button
          onClick={() => onChange(emptyFilters())}
          className="shrink-0 rounded-full border border-stone-300 px-3 py-1 text-[13px] whitespace-nowrap text-stone-600 dark:border-stone-600 dark:text-stone-300"
        >
          Сбросить всё
        </button>
      )}
    </div>
  );
}
