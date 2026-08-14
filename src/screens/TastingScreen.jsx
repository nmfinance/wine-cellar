import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowLeft, ChevronDown, Trash2 } from 'lucide-react';
import { db } from '../db.js';
import { scoreBadgeClasses } from '../theme.js';
import Slider from '../components/Slider.jsx';
import VoiceInput from '../components/VoiceInput.jsx';

const round1 = (n) => Math.round(n * 10) / 10;

// Секция дозаполнения после аэрации: заметка + опциональная корректировка оценок
function AerationFill({ tasting, onDone }) {
  const [text, setText] = useState(tasting.aerationNotes ?? '');
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [scores, setScores] = useState({ ...tasting.scores });
  const total = round1(
    (scores.appearance ?? 0) + (scores.nose ?? 0) + (scores.taste ?? 0) +
    (scores.finish ?? 0) + (scores.overall ?? 0)
  );
  const set = (key, v) => setScores((s) => ({ ...s, [key]: v }));

  const finish = async () => {
    await db.tastings.update(tasting.id, {
      aerationNotes: text.trim() || null,
      aerationPending: false,
      ...(adjustOpen
        ? {
            scores: Object.fromEntries(Object.entries(scores).map(([k, v]) => [k, round1(v)])),
            totalScore: total,
          }
        : {}),
      updatedAt: new Date().toISOString(),
    });
    onDone?.();
  };

  const rows = [
    ['appearance', 'Внешний вид', 1.5],
    ['nose', 'Нос', 3.0],
    ['taste', 'Вкус', 3.0],
    ['finish', 'Послевкусие', 1.5],
    ['overall', 'Впечатление', 1.0],
  ];

  return (
    <div className="mx-4 rounded-xl bg-white p-3.5 dark:bg-stone-900">
      <h2 className="mb-2 text-sm font-semibold">После аэрации</h2>
      <VoiceInput
        value={text}
        onChange={setText}
        placeholder="Что изменилось? Мягче? Открылись новые ноты?"
      />
      <button
        type="button"
        onClick={() => setAdjustOpen((v) => !v)}
        className="mt-2 flex items-center gap-1 text-[13px] font-medium text-wine-600 dark:text-wine-400"
      >
        Скорректировать итоговую оценку
        <ChevronDown className={`size-3.5 transition-transform ${adjustOpen ? 'rotate-180' : ''}`} />
      </button>
      {adjustOpen && (
        <div className="mt-1">
          {rows.map(([key, label, max]) => (
            <Slider
              key={key}
              kind="score"
              label={label}
              value={scores[key] ?? 0}
              onChange={(v) => set(key, v)}
              min={0}
              max={max}
              step={0.05}
              valueText={`${round1(scores[key] ?? 0).toFixed(1)}/${max.toFixed(1)}`}
            />
          ))}
          <p className="mt-1 text-right text-sm font-semibold">
            Итог: <span className={`rounded-full px-2 py-0.5 ${scoreBadgeClasses(total)}`}>{total.toFixed(1)}</span>
          </p>
        </div>
      )}
      <button
        onClick={finish}
        className="mt-3 w-full rounded-lg bg-wine-600 py-2.5 text-sm font-medium text-white dark:bg-wine-400 dark:text-stone-950"
      >
        Готово
      </button>
    </div>
  );
}

const PLACE_LABEL = { home: 'дома', restaurant: 'в ресторане', guests: 'в гостях' };
const CLARITY_LABEL = { clear: 'прозрачное', semi: 'полупрозрачное', hazy: 'мутное' };
const TASTE_ROWS = [
  ['sweetness', 'Сладость'],
  ['acidity', 'Кислотность'],
  ['tannins', 'Танины'],
  ['body', 'Тело'],
  ['balance', 'Баланс'],
];

const fmtDate = (iso) =>
  iso
    ? new Date(iso)
        .toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
        .replace(' г.', '')
    : null;

function Card({ title, children }) {
  return (
    <div className="mx-4 rounded-xl bg-white p-3.5 dark:bg-stone-900">
      {title && <h2 className="mb-2 text-sm font-semibold">{title}</h2>}
      {children}
    </div>
  );
}

function Bar({ label, value }) {
  return (
    <div className="py-1">
      <div className="flex justify-between text-[12px] text-stone-500 dark:text-stone-400">
        <span>{label}</span>
        <span className="tabular-nums">{value}</span>
      </div>
      <div className="mt-0.5 h-1.5 rounded-full bg-stone-200 dark:bg-stone-700">
        <div
          className="h-full rounded-full bg-wine-600 dark:bg-wine-400"
          style={{ width: `${value}%` }}
        />
      </div>
    </div>
  );
}

// Минимальный просмотр дегустации: read-only в структуре опросника + удаление
export default function TastingScreen() {
  const { id } = useParams();
  const navigate = useNavigate();
  const tasting = useLiveQuery(() => db.tastings.get(id).then((t) => t ?? null), [id]);
  const wine = useLiveQuery(
    () => (tasting?.wineId ? db.wines.get(tasting.wineId) : null),
    [tasting?.wineId]
  );
  const [glassUrl, setGlassUrl] = useState(null);
  const [fillOpen, setFillOpen] = useState(false);
  const glassPhoto = useLiveQuery(
    () =>
      db.photos
        .where('tastingId')
        .equals(id)
        .first()
        .then((p) => p ?? null),
    [id]
  );

  useEffect(() => {
    if (!glassPhoto?.blob) {
      setGlassUrl(null);
      return;
    }
    const url = URL.createObjectURL(glassPhoto.blob);
    setGlassUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [glassPhoto]);

  if (tasting === undefined) return null;
  if (tasting === null)
    return <p className="mt-10 text-center text-sm text-stone-500">Дегустация не найдена</p>;

  const remove = async () => {
    if (!window.confirm('Удалить дегустацию? Это необратимо')) return;
    await db.transaction('rw', [db.tastings, db.photos], async () => {
      await db.photos.where('tastingId').equals(tasting.id).delete();
      await db.tastings.delete(tasting.id);
    });
    navigate(-1);
  };

  const scoreRows = [
    ['Внешний вид', tasting.scores?.appearance, 1.5],
    ['Нос', tasting.scores?.nose, 3.0],
    ['Вкус', tasting.scores?.taste, 3.0],
    ['Послевкусие', tasting.scores?.finish, 1.5],
    ['Впечатление', tasting.scores?.overall, 1.0],
  ];

  return (
    <div className="flex min-h-dvh flex-col gap-3 pb-8">
      <header className="sticky top-0 z-10 flex items-center justify-between bg-stone-50/95 px-2 py-2 backdrop-blur dark:bg-stone-950/95">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-1 rounded-lg px-2 py-2 text-sm font-medium text-wine-600 dark:text-wine-400"
        >
          <ArrowLeft className="size-4" /> Назад
        </button>
        <span className={`mr-2 rounded-full px-2.5 py-1 text-sm font-bold ${scoreBadgeClasses(tasting.totalScore)}`}>
          {tasting.totalScore?.toFixed(1)}/10
        </span>
      </header>

      <div className="px-4">
        <h1 className="text-lg font-medium">{wine?.name ?? 'Дегустация'}</h1>
        <p className="mt-0.5 text-[13px] text-stone-500 dark:text-stone-400">
          📅 {fmtDate(tasting.date)} · 📍 {PLACE_LABEL[tasting.place] ?? tasting.place}
          {tasting.decantMinutes > 0 && <> · 💨 {tasting.decantMinutes} мин</>}
        </p>
      </div>

      {/* Дозаполнение после аэрации */}
      {tasting.aerationPending && !fillOpen && (
        <div className="mx-4 rounded-xl bg-amber-100 p-3 dark:bg-amber-950">
          <p className="text-sm text-amber-800 dark:text-amber-200">
            💨 Вино дышит ({tasting.decantMinutes ?? '—'} мин декантации) — вернись и допиши,
            как оно раскрылось
          </p>
          <button
            onClick={() => setFillOpen(true)}
            className="mt-2 w-full rounded-lg bg-amber-500 py-2 text-[13px] font-medium text-white dark:bg-amber-600"
          >
            Дописать сейчас
          </button>
        </div>
      )}
      {tasting.aerationPending && fillOpen && (
        <AerationFill tasting={tasting} onDone={() => setFillOpen(false)} />
      )}
      {!tasting.aerationPending && tasting.aerationNotes && (
        <Card title="После аэрации">
          <p className="text-sm text-stone-700 dark:text-stone-300">{tasting.aerationNotes}</p>
        </Card>
      )}

      {tasting.colorNote && (
        <Card title="Цвет">
          <div className="flex items-center gap-2.5">
            {tasting.colorNote.hue && (
              <span className="size-9 rounded-lg" style={{ background: tasting.colorNote.hue }} />
            )}
            <div className="text-[13px] text-stone-600 dark:text-stone-300">
              <p>{tasting.colorNote.hueName ?? '—'}</p>
              <p className="text-[11px] text-stone-400 dark:text-stone-500">
                интенсивность {tasting.colorNote.intensity ?? '—'}
                {tasting.colorNote.clarity && ` · ${CLARITY_LABEL[tasting.colorNote.clarity]}`}
              </p>
            </div>
          </div>
        </Card>
      )}

      {(tasting.aromas?.length > 0 || tasting.aromaIntensity != null) && (
        <Card title="Нос">
          <div className="flex flex-wrap gap-1.5">
            {(tasting.aromas ?? []).map((a) => (
              <span key={a} className="rounded-full bg-stone-100 px-2.5 py-1 text-[12px] text-stone-600 dark:bg-stone-800 dark:text-stone-300">
                {a}
              </span>
            ))}
          </div>
          {tasting.aromaIntensity != null && (
            <div className="mt-2">
              <Bar label="Интенсивность аромата" value={tasting.aromaIntensity} />
            </div>
          )}
        </Card>
      )}

      {tasting.taste && (
        <Card title="Вкус и текстура">
          {TASTE_ROWS.map(([key, label]) =>
            tasting.taste[key] != null ? <Bar key={key} label={label} value={tasting.taste[key]} /> : null
          )}
          {tasting.finishLength != null && <Bar label="Послевкусие" value={tasting.finishLength} />}
          {tasting.tasteFlavors?.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {tasting.tasteFlavors.map((a) => (
                <span key={a} className="rounded-full bg-stone-100 px-2.5 py-1 text-[12px] text-stone-600 dark:bg-stone-800 dark:text-stone-300">
                  {a}
                </span>
              ))}
            </div>
          )}
        </Card>
      )}

      {(tasting.notesNow || glassUrl) && (
        <Card title="Сейчас в бокале">
          {tasting.notesNow && (
            <p className="text-sm text-stone-700 dark:text-stone-300">{tasting.notesNow}</p>
          )}
          {glassUrl && <img src={glassUrl} alt="" className="mt-2 h-32 rounded-lg object-cover" />}
        </Card>
      )}

      <Card title="Оценка">
        {scoreRows.map(([label, value, max]) => (
          <div key={label} className="flex justify-between py-0.5 text-[13px]">
            <span className="text-stone-500 dark:text-stone-400">{label}</span>
            <span className="tabular-nums">{value != null ? value.toFixed(1) : '—'}/{max.toFixed(1)}</span>
          </div>
        ))}
      </Card>

      <button
        onClick={remove}
        className="mx-4 flex items-center justify-center gap-1.5 rounded-lg border border-red-200 py-2.5 text-[13px] font-medium text-red-600 dark:border-red-900 dark:text-red-400"
      >
        <Trash2 className="size-4" /> Удалить дегустацию
      </button>
    </div>
  );
}
