import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Minus, MoreHorizontal, Plus } from 'lucide-react';
import {
  addRack,
  bottlesOnRack,
  deleteRack,
  listRacks,
  renameRack,
  setRackCapacity,
  setShelfCount,
  shelfOccupancy,
} from '../data/cellar.js';
import { pluralize } from '../utils/plural.js';

function Stepper({ value, display, onMinus, onPlus, disabled = false }) {
  return (
    <span className={`flex items-center gap-2 ${disabled ? 'opacity-40' : ''}`}>
      <button
        type="button"
        onClick={onMinus}
        disabled={disabled}
        className="grid size-8 place-items-center rounded-lg border border-stone-300 dark:border-stone-600"
      >
        <Minus className="size-3.5" />
      </button>
      <span className="min-w-7 text-center text-sm font-medium">{display ?? value}</span>
      <button
        type="button"
        onClick={onPlus}
        disabled={disabled}
        className="grid size-8 place-items-center rounded-lg border border-stone-300 dark:border-stone-600"
      >
        <Plus className="size-3.5" />
      </button>
    </span>
  );
}

function RackCard({ rack }) {
  const occupancy = useLiveQuery(() => shelfOccupancy(rack.id), [rack.id]);
  const [menuOpen, setMenuOpen] = useState(false);
  const capacity = rack.shelves[0]?.capacity ?? null;
  const noLimit = capacity == null;

  const rename = () => {
    const name = window.prompt('Название стеллажа', rack.name);
    if (name?.trim()) renameRack(rack.id, name.trim());
  };

  const changeShelves = async (delta) => {
    const next = rack.shelves.length + delta;
    if (next < 1 || next > 20) return;
    if (delta < 0) {
      const onLast = occupancy?.[rack.shelves.length] ?? 0;
      if (
        onLast > 0 &&
        !window.confirm(
          `На полке ${onLast} ${pluralize(onLast, 'бутылка', 'бутылки', 'бутылок')}. Убрать полку? Вина останутся без места`
        )
      )
        return;
    }
    await setShelfCount(rack.id, next);
  };

  const remove = async () => {
    setMenuOpen(false);
    const bottles = await bottlesOnRack(rack.id);
    const msg =
      bottles > 0
        ? `На стеллаже ${bottles} ${pluralize(bottles, 'бутылка', 'бутылки', 'бутылок')}. Вина останутся без места`
        : `Удалить «${rack.name}»?`;
    if (window.confirm(msg)) await deleteRack(rack.id);
  };

  return (
    <div className="relative rounded-xl bg-white p-3 dark:bg-stone-900">
      <div className="flex items-center justify-between">
        <button type="button" onClick={rename} className="min-w-0 truncate text-left text-sm font-medium">
          {rack.name}
        </button>
        <button
          type="button"
          aria-label="Меню стеллажа"
          onClick={() => setMenuOpen((v) => !v)}
          className="grid size-8 shrink-0 place-items-center rounded-lg text-stone-400"
        >
          <MoreHorizontal className="size-4" />
        </button>
      </div>

      {menuOpen && (
        <div className="absolute top-10 right-3 z-20 overflow-hidden rounded-lg border border-stone-200 bg-white shadow-lg dark:border-stone-700 dark:bg-stone-800">
          <button
            type="button"
            onClick={() => {
              setMenuOpen(false);
              rename();
            }}
            className="block w-full px-4 py-2.5 text-left text-sm hover:bg-stone-100 dark:hover:bg-stone-700"
          >
            Переименовать
          </button>
          <button
            type="button"
            onClick={remove}
            className="block w-full px-4 py-2.5 text-left text-sm text-red-600 hover:bg-stone-100 dark:text-red-400 dark:hover:bg-stone-700"
          >
            Удалить
          </button>
        </div>
      )}

      <div className="mt-3 flex items-center justify-between text-sm text-stone-600 dark:text-stone-300">
        <span>Полок</span>
        <Stepper
          value={rack.shelves.length}
          onMinus={() => changeShelves(-1)}
          onPlus={() => changeShelves(1)}
        />
      </div>

      <div className="mt-2 flex items-center justify-between text-sm text-stone-600 dark:text-stone-300">
        <span>Вместимость</span>
        <span className="flex items-center gap-3">
          <Stepper
            display={noLimit ? '—' : `${capacity}`}
            disabled={noLimit}
            onMinus={() => setRackCapacity(rack.id, Math.max(1, capacity - 1))}
            onPlus={() => setRackCapacity(rack.id, capacity + 1)}
          />
          <label className="flex items-center gap-1.5 text-xs">
            <input
              type="checkbox"
              checked={noLimit}
              onChange={() => setRackCapacity(rack.id, noLimit ? 6 : null)}
              className="size-3.5 accent-wine-600"
            />
            без лимита
          </label>
        </span>
      </div>

      {/* мини-визуализация занятости полок */}
      <div className="mt-3 flex flex-wrap gap-1.5">
        {rack.shelves.map((s) => {
          const occ = occupancy?.[s.n] ?? 0;
          const full = s.capacity != null && occ >= s.capacity;
          const cls =
            occ === 0
              ? 'bg-stone-100 text-stone-500 dark:bg-stone-800 dark:text-stone-400'
              : full
                ? 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200'
                : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200';
          return (
            <span key={s.n} className={`rounded-md px-2 py-1 text-xs font-medium ${cls}`}>
              {s.n} · {occ}
              {s.capacity != null && `/${s.capacity}`}
            </span>
          );
        })}
      </div>
    </div>
  );
}

// Конструктор структуры погреба; используется маршрутом настроек
// и полноэкранным оверлеем из формы вина
export default function CellarStructureEditor() {
  const racks = useLiveQuery(listRacks);

  const onAdd = async () => {
    const rack = await addRack();
    const name = window.prompt('Название стеллажа', rack.name);
    if (name?.trim() && name.trim() !== rack.name) await renameRack(rack.id, name.trim());
  };

  if (!racks) return null;

  return (
    <div className="px-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">Структура погреба</h2>
        {racks.length > 0 && (
          <button
            type="button"
            onClick={onAdd}
            className="text-sm font-medium text-wine-600 dark:text-wine-400"
          >
            + Стеллаж
          </button>
        )}
      </div>

      {racks.length === 0 ? (
        <div className="mt-10 flex flex-col items-center gap-4 text-center">
          <p className="max-w-64 text-sm text-stone-500 dark:text-stone-400">
            Опиши свой погреб — стеллажи и полки. Потом место вина будет выбираться в два тапа
          </p>
          <button
            type="button"
            onClick={onAdd}
            className="rounded-lg bg-wine-600 px-4 py-2.5 text-sm font-medium text-white dark:bg-wine-400 dark:text-stone-950"
          >
            + Первый стеллаж
          </button>
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          {racks.map((rack) => (
            <RackCard key={rack.id} rack={rack} />
          ))}
        </div>
      )}
    </div>
  );
}
