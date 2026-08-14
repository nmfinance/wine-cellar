import { useState } from 'react';

// Единый ползунок опросника. kind='score' — оценочный (заливка по шкале
// оценок: доля от максимума ≥80% зелёная, ≥50% янтарная, ниже красная),
// kind='taste' — вкусовой (акцентная заливка). Крупная зона касания.
export default function Slider({
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  kind = 'taste',
  label = null,
  leftLabel = null,
  rightLabel = null,
  valueText = null, // строка справа, например «1.2/1.5»
}) {
  const [dragging, setDragging] = useState(false);
  const pct = ((value - min) / (max - min)) * 100;
  const fill =
    kind === 'score'
      ? pct >= 80
        ? '#059669'
        : pct >= 50
          ? '#d97706'
          : '#dc2626'
      : '#a05560';
  const track = 'rgba(120, 113, 108, 0.25)';

  return (
    <div className="py-1">
      {(label || valueText) && (
        <div className="flex items-baseline justify-between">
          {label && (
            <span className="text-[13px] text-stone-600 dark:text-stone-300">{label}</span>
          )}
          {valueText && (
            <span
              className={`text-[13px] font-semibold tabular-nums ${dragging ? 'text-stone-900 dark:text-stone-100' : 'text-stone-500 dark:text-stone-400'}`}
            >
              {valueText}
            </span>
          )}
        </div>
      )}
      <div className="relative flex h-11 items-center">
        {dragging && (
          <span
            className="pointer-events-none absolute -top-1 z-10 -translate-x-1/2 rounded-md bg-stone-900 px-1.5 py-0.5 text-[11px] font-medium text-white dark:bg-stone-100 dark:text-stone-900"
            style={{ left: `calc(${pct}% + ${(50 - pct) * 0.2}px)` }}
          >
            {valueText ?? value}
          </span>
        )}
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          onPointerDown={() => setDragging(true)}
          onPointerUp={() => setDragging(false)}
          onPointerCancel={() => setDragging(false)}
          className="tasting-slider w-full"
          style={{
            background: `linear-gradient(to right, ${fill} ${pct}%, ${track} ${pct}%)`,
            color: fill,
          }}
        />
      </div>
      {(leftLabel || rightLabel) && (
        <div className="-mt-1.5 flex justify-between text-[11px] text-stone-400 dark:text-stone-500">
          <span>{leftLabel}</span>
          <span>{rightLabel}</span>
        </div>
      )}
    </div>
  );
}
