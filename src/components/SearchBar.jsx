import { LayoutGrid, Rows3, Search, SlidersHorizontal } from 'lucide-react';

export default function SearchBar({
  value,
  onChange,
  onFilters,
  filtersActive = false,
  viewMode = null, // 'grid' | 'shelves' | null (без тумблера)
  onToggleView = null,
}) {
  return (
    <div className="mx-4 flex gap-2">
      <div className="relative flex-1">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-stone-400" />
        <input
          type="search"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Поиск по названию"
          className="h-10 w-full rounded-lg border border-stone-200 bg-white pr-3 pl-9 text-sm outline-none focus:border-wine-400 dark:border-stone-700 dark:bg-stone-900"
        />
      </div>
      {onToggleView && (
        <button
          onClick={onToggleView}
          aria-label={viewMode === 'shelves' ? 'Вид: сетка' : 'Вид: по полкам'}
          className="grid size-10 shrink-0 place-items-center rounded-lg border border-stone-200 bg-white text-stone-600 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300"
        >
          {viewMode === 'shelves' ? <LayoutGrid className="size-4" /> : <Rows3 className="size-4" />}
        </button>
      )}
      {onFilters && (
        <button
          onClick={onFilters}
          aria-label="Фильтры"
          className="relative grid size-10 shrink-0 place-items-center rounded-lg border border-stone-200 bg-white text-stone-600 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300"
        >
          <SlidersHorizontal className="size-4" />
          {filtersActive && (
            <span className="absolute -top-1 -right-1 size-2.5 rounded-full bg-wine-600 dark:bg-wine-400" />
          )}
        </button>
      )}
    </div>
  );
}
