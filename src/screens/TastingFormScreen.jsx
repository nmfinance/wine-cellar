import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { Camera, Copy, X } from 'lucide-react';
import { db } from '../db.js';
import { addTasting, buildGrapeExperience, fireScoreOpinion } from '../data/tastings.js';
import { askTastingQuestions } from '../api/ai.js';
import { drinkBottle } from '../data/wines.js';
import { AROMA_SETS, addCustomAromas, getCustomAromas } from '../data/aromas.js';
import { compressImage } from '../utils/image.js';
import { scoreBadgeClasses } from '../theme.js';
import Slider from '../components/Slider.jsx';
import Toast from '../components/Toast.jsx';
import VoiceInput from '../components/VoiceInput.jsx';

// Палитры оттенков по типу вина: [hex, название]
const HUE_SETS = {
  red: [
    ['#8E2043', 'пурпурный'],
    ['#9B1B30', 'рубиновый'],
    ['#7B1F2B', 'гранатовый'],
    ['#A34A2A', 'кирпичный'],
    ['#7A4B32', 'коричневатый'],
  ],
  white: [
    ['#EFE96E', 'лимонный'],
    ['#E8D889', 'соломенный'],
    ['#D9B84A', 'золотистый'],
    ['#C98F32', 'янтарный'],
    ['#A5763B', 'коричневатый'],
  ],
  rose: [
    ['#F4C2C9', 'бледно-розовый'],
    ['#F19A7B', 'лососевый'],
    ['#D45D79', 'малиновый'],
    ['#E98E6D', 'оранжево-розовый'],
    ['#C46A4F', 'медный'],
  ],
  orange: [
    ['#E5B04C', 'соломенно-оранжевый'],
    ['#E08A3C', 'абрикосовый'],
    ['#C96F2F', 'янтарно-оранжевый'],
    ['#B05A28', 'медно-оранжевый'],
    ['#8F4A22', 'махагоновый'],
  ],
};

const PLACES = [
  ['home', 'Дома'],
  ['restaurant', 'Ресторан'],
  ['guests', 'В гостях'],
];
const PLACE_LABEL = { home: 'дома', restaurant: 'ресторан', guests: 'в гостях' };
const CLARITY = [
  ['clear', 'Прозрачное'],
  ['semi', 'Полупрозрачное'],
  ['hazy', 'Мутное'],
];

const round1 = (n) => Math.round(n * 10) / 10;

function Chip({ active, children, onClick }) {
  return (
    <button
      type="button"
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
    <div className="mx-4 rounded-xl bg-white p-3.5 dark:bg-stone-900">
      <h2 className="mb-2 text-sm font-semibold">{title}</h2>
      {children}
    </div>
  );
}

// Чипы ароматов/вкусовых нот со счётчиком и «+ своё»
function AromaPicker({ options, selected, onToggle, onAddCustom }) {
  const [inputOpen, setInputOpen] = useState(false);
  const [text, setText] = useState('');
  const add = () => {
    const name = text.trim().toLowerCase();
    if (name) onAddCustom(name);
    setText('');
    setInputOpen(false);
  };
  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
        {options.map((a) => (
          <Chip key={a} active={selected.includes(a)} onClick={() => onToggle(a)}>
            {a}
          </Chip>
        ))}
        {inputOpen ? (
          <span className="flex gap-1">
            <input
              autoFocus
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && add()}
              className="h-8 w-32 rounded-full border border-stone-300 bg-white px-3 text-[13px] outline-none focus:border-wine-400 dark:border-stone-600 dark:bg-stone-800"
              placeholder="свой аромат"
            />
            <button type="button" onClick={add} className="text-[13px] font-medium text-wine-600 dark:text-wine-400">
              ок
            </button>
          </span>
        ) : (
          <Chip active={false} onClick={() => setInputOpen(true)}>
            + своё
          </Chip>
        )}
      </div>
      <p className="mt-1.5 text-[11px] text-stone-400 dark:text-stone-500">
        выбрано {selected.length}
      </p>
    </div>
  );
}

export default function TastingFormScreen() {
  const { id } = useParams();
  const navigate = useNavigate();
  const wine = useLiveQuery(() => db.wines.get(id).then((w) => w ?? null), [id]);
  const [toast, setToast] = useState(null);
  const [saving, setSaving] = useState(false);

  // --- стейт опросника -------------------------------------------------------
  const today = new Date().toISOString().slice(0, 10);
  const [prep, setPrep] = useState({ date: today, place: 'home', customPlace: '', decant: 0 });
  const [prepOpen, setPrepOpen] = useState(true);
  const [hue, setHue] = useState(null); // [hex, name]
  const [colorIntensity, setColorIntensity] = useState(70);
  const [clarity, setClarity] = useState(null);
  const [scoreAppearance, setScoreAppearance] = useState(1.05);
  const [aromas, setAromas] = useState([]);
  const [customPool, setCustomPool] = useState([]); // «свои» из meta
  const [sessionCustom, setSessionCustom] = useState([]); // добавленные сейчас
  const [aromaIntensity, setAromaIntensity] = useState(70);
  const [scoreNose, setScoreNose] = useState(2.1);
  const [taste, setTaste] = useState({ sweetness: 70, acidity: 70, tannins: 70, body: 70, balance: 70 });
  const [tasteFlavors, setTasteFlavors] = useState([]);
  const [scoreTaste, setScoreTaste] = useState(2.1);
  const [finishLength, setFinishLength] = useState(70);
  const [scoreFinish, setScoreFinish] = useState(1.05);
  const [notesNow, setNotesNow] = useState('');
  const [glassPhoto, setGlassPhoto] = useState(null); // {blob, url}
  const [scoreOverall, setScoreOverall] = useState(0.7);
  const [aerationPending, setAerationPending] = useState(false);
  const [touched, setTouched] = useState({}); // {1..5: true}
  const [writeOff, setWriteOff] = useState(null); // {tasting, quantity} — диалог списания
  // S3: 'loading' | 'none' | [{question, answer}] — AI-сбой не мешает опроснику
  const [aiQ, setAiQ] = useState('loading');
  const fileRef = useRef(null);

  const color = wine?.color ?? 'red';
  const hues = HUE_SETS[color] ?? HUE_SETS.red;
  const baseAromas = AROMA_SETS[color] ?? AROMA_SETS.red;

  useEffect(() => {
    getCustomAromas(color).then(setCustomPool);
  }, [color]);

  // S3 — асинхронно при открытии, один раз; офлайн/ошибка → карточки просто нет
  useEffect(() => {
    if (!wine) return;
    let alive = true;
    (async () => {
      try {
        const experience = await buildGrapeExperience(wine);
        const res = await askTastingQuestions(wine, experience, wine.aiDeep?.sommelier_tips ?? null);
        if (!alive) return;
        if (res.ok && Array.isArray(res.data?.questions) && res.data.questions.length) {
          setAiQ(res.data.questions.slice(0, 2).map((q) => ({ question: String(q), answer: '' })));
        } else {
          setAiQ('none');
        }
      } catch {
        if (alive) setAiQ('none');
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wine?.id]);

  const touch = (n) => setTouched((t) => (t[n] ? t : { ...t, [n]: true }));

  const total = round1(scoreAppearance + scoreNose + scoreTaste + scoreFinish + scoreOverall);
  const anyFilled =
    Object.keys(touched).length > 0 || aromas.length > 0 || notesNow.trim() || hue != null;

  const aromaOptions = useMemo(
    () => [...baseAromas, ...customPool.filter((a) => !baseAromas.includes(a)), ...sessionCustom.filter((a) => !baseAromas.includes(a) && !customPool.includes(a))],
    [baseAromas, customPool, sessionCustom]
  );

  if (wine === undefined) return null;
  if (wine === null) return <p className="mt-10 text-center text-sm text-stone-500">Вино не найдено</p>;

  const placeText = prep.place === 'custom' ? prep.customPlace || 'своё место' : PLACE_LABEL[prep.place];

  const exit = () => {
    if (anyFilled && !window.confirm('Выйти? Заполненное не сохранится')) return;
    navigate(-1);
  };

  const onPhoto = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const blob = await compressImage(file);
      if (glassPhoto) URL.revokeObjectURL(glassPhoto.url);
      setGlassPhoto({ blob, url: URL.createObjectURL(blob) });
      touch(4);
    } catch {
      setToast('Не удалось обработать фото');
    }
  };

  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const dateIso =
        prep.date === today ? new Date().toISOString() : `${prep.date}T12:00:00.000Z`;
      const tasting = await addTasting(wine.id, {
        date: dateIso,
        place: prep.place === 'custom' ? (prep.customPlace.trim() || 'другое') : prep.place,
        decantMinutes: prep.decant > 0 ? prep.decant : null,
        colorNote: hue
          ? { hue: hue[0], hueName: hue[1], intensity: colorIntensity, clarity }
          : null,
        aromas,
        aromaIntensity,
        taste,
        tasteFlavors,
        finishLength,
        notesNow: notesNow.trim() || null,
        aerationNotes: null,
        aerationPending,
        aiQuestions: Array.isArray(aiQ)
          ? aiQ.map((q) => ({ question: q.question, answer: q.answer.trim() || null }))
          : [],
        aiOpinion: null,
        scores: {
          appearance: round1(scoreAppearance),
          nose: round1(scoreNose),
          taste: round1(scoreTaste),
          finish: round1(scoreFinish),
          overall: round1(scoreOverall * 10) / 10,
        },
      });
      // фото бокала
      if (glassPhoto) {
        await db.photos.add({
          id: crypto.randomUUID(),
          wineId: wine.id,
          tastingId: tasting.id,
          blob: glassPhoto.blob,
          kind: 'glass',
          order: 99,
          createdAt: new Date().toISOString(),
        });
      }
      // «свои» ароматы — в словарь типа
      const custom = [...aromas, ...tasteFlavors].filter(
        (a) => !baseAromas.includes(a) && !customPool.includes(a)
      );
      await addCustomAromas(color, custom);

      // S4 вдогонку — сохранение и выход не ждут AI
      fireScoreOpinion(wine, tasting);

      // Списание бутылки: только для cellar-вина с бутылками
      // и не в ресторане (там очевидно не из погреба)
      const fresh = await db.wines.get(wine.id);
      const placeVal = prep.place === 'custom' ? prep.customPlace.trim() : prep.place;
      if (fresh.status === 'cellar' && fresh.quantity >= 1 && placeVal !== 'restaurant') {
        setWriteOff({ tasting, quantity: fresh.quantity });
        return;
      }
      navigate(`/wine/${wine.id}`, {
        replace: true,
        state: { toast: `Дегустация сохранена · ${tasting.totalScore.toFixed(1)}` },
      });
    } finally {
      setSaving(false);
    }
  };

  const finishWriteOff = async (doDrink) => {
    const { tasting } = writeOff;
    let toastText = `Дегустация сохранена · ${tasting.totalScore.toFixed(1)}`;
    if (doDrink) {
      const updated = await drinkBottle(wine.id);
      if (updated.status === 'history') toastText = 'Вино в Истории со всеми дегустациями';
    }
    navigate(`/wine/${wine.id}`, { replace: true, state: { toast: toastText } });
  };

  const scoreRows = [
    ['Внешний вид', scoreAppearance, 1.5],
    ['Нос', scoreNose, 3.0],
    ['Вкус', scoreTaste, 3.0],
    ['Послевкусие', scoreFinish, 1.5],
    ['Впечатление', scoreOverall, 1.0],
  ];

  return (
    <div className="flex min-h-dvh flex-col pb-8">
      {/* Шапка */}
      <header className="sticky top-0 z-10 bg-stone-50/95 backdrop-blur dark:bg-stone-950/95">
        <div className="flex items-center justify-between px-2 py-2">
          <button onClick={exit} aria-label="Выйти" className="grid size-10 place-items-center rounded-lg text-stone-500 dark:text-stone-400">
            <X className="size-5" />
          </button>
          <div className="min-w-0 flex-1 px-1 text-center">
            <p className="text-sm font-semibold">Дегустация</p>
            <p className="truncate text-[11px] text-stone-500 dark:text-stone-400">{wine.name}</p>
          </div>
          <span className={`rounded-full px-2.5 py-1 text-sm font-bold tabular-nums ${scoreBadgeClasses(total)}`}>
            {total.toFixed(1)}/10
          </span>
        </div>
        {/* прогресс секций */}
        <div className="flex gap-1 px-4 pb-2">
          {[1, 2, 3, 4, 5].map((n) => (
            <span
              key={n}
              className={`h-1 flex-1 rounded-full ${touched[n] ? 'bg-wine-600 dark:bg-wine-400' : 'bg-stone-200 dark:bg-stone-800'}`}
            />
          ))}
        </div>
      </header>

      <div className="mt-2 space-y-3">
        {/* Секция 0 — подготовка */}
        {prepOpen ? (
          <Section title="Подготовка">
            <div className="space-y-2.5">
              <input
                type="date"
                value={prep.date}
                max={today}
                onChange={(e) => setPrep((p) => ({ ...p, date: e.target.value }))}
                className="h-10 rounded-lg border border-stone-200 bg-white px-3 text-sm dark:border-stone-700 dark:bg-stone-800"
              />
              <div className="flex flex-wrap gap-1.5">
                {PLACES.map(([value, label]) => (
                  <Chip key={value} active={prep.place === value} onClick={() => setPrep((p) => ({ ...p, place: value }))}>
                    {label}
                  </Chip>
                ))}
                <Chip active={prep.place === 'custom'} onClick={() => setPrep((p) => ({ ...p, place: 'custom' }))}>
                  + своё
                </Chip>
              </div>
              {prep.place === 'custom' && (
                <input
                  value={prep.customPlace}
                  onChange={(e) => setPrep((p) => ({ ...p, customPlace: e.target.value }))}
                  placeholder="например, дача"
                  className="h-10 w-full rounded-lg border border-stone-200 bg-white px-3 text-sm dark:border-stone-700 dark:bg-stone-800"
                />
              )}
              <div className="flex items-center justify-between">
                <span className="text-[13px] text-stone-600 dark:text-stone-300">Декантация</span>
                <span className="flex items-center gap-2.5">
                  <button
                    type="button"
                    onClick={() => setPrep((p) => ({ ...p, decant: Math.max(0, p.decant - 15) }))}
                    className="grid size-9 place-items-center rounded-lg border border-stone-300 text-lg dark:border-stone-600"
                  >
                    −
                  </button>
                  <span className="min-w-16 text-center text-sm font-medium">
                    {prep.decant > 0 ? `${prep.decant} мин` : 'без'}
                  </span>
                  <button
                    type="button"
                    onClick={() => setPrep((p) => ({ ...p, decant: p.decant + 15 }))}
                    className="grid size-9 place-items-center rounded-lg border border-stone-300 text-lg dark:border-stone-600"
                  >
                    +
                  </button>
                </span>
              </div>
              <button
                type="button"
                onClick={() => setPrepOpen(false)}
                className="w-full rounded-lg bg-stone-200 py-2 text-[13px] font-medium text-stone-700 dark:bg-stone-800 dark:text-stone-300"
              >
                Готово
              </button>
            </div>
          </Section>
        ) : (
          <button
            type="button"
            onClick={() => setPrepOpen(true)}
            className="mx-4 flex w-[calc(100%-2rem)] items-center gap-2 overflow-x-auto rounded-xl bg-white px-3.5 py-2.5 text-[13px] text-stone-600 dark:bg-stone-900 dark:text-stone-300"
          >
            <span>📅 {prep.date === today ? 'сегодня' : prep.date}</span>
            <span>· 📍 {placeText}</span>
            {prep.decant > 0 && <span>· 💨 {prep.decant} мин</span>}
            <span className="ml-auto shrink-0 font-medium text-wine-600 dark:text-wine-400">изменить</span>
          </button>
        )}

        {/* 1 · Цвет */}
        <Section title="1 · Цвет">
          <div className="flex gap-2">
            {hues.map(([hex, name]) => (
              <button
                key={hex}
                type="button"
                title={name}
                onClick={() => { setHue([hex, name]); touch(1); }}
                className={`h-12 flex-1 rounded-lg transition-all ${hue?.[0] === hex ? 'ring-2 ring-wine-600 ring-offset-2 ring-offset-white dark:ring-wine-400 dark:ring-offset-stone-900' : ''}`}
                style={{ background: hex }}
              />
            ))}
          </div>
          <p className="mt-1.5 h-4 text-[12px] text-stone-500 dark:text-stone-400">
            {hue ? hue[1] : 'выбери оттенок'}
          </p>
          <Slider
            label="Интенсивность"
            value={colorIntensity}
            onChange={(v) => { setColorIntensity(v); touch(1); }}
            leftLabel="бледный"
            rightLabel="насыщенный"
          />
          <div className="mb-2 flex flex-wrap gap-1.5">
            {CLARITY.map(([value, label]) => (
              <Chip key={value} active={clarity === value} onClick={() => { setClarity(value); touch(1); }}>
                {label}
              </Chip>
            ))}
          </div>
          <div className="border-t border-stone-100 pt-1 dark:border-stone-800">
            <Slider
              kind="score"
              label="Балл за вид"
              value={scoreAppearance}
              onChange={(v) => { setScoreAppearance(v); touch(1); }}
              min={0}
              max={1.5}
              step={0.05}
              valueText={`${round1(scoreAppearance).toFixed(1)}/1.5`}
            />
          </div>
        </Section>

        {/* 2 · Нос */}
        <Section title="2 · Нос">
          <AromaPicker
            options={aromaOptions}
            selected={aromas}
            onToggle={(a) => { setAromas((s) => (s.includes(a) ? s.filter((x) => x !== a) : [...s, a])); touch(2); }}
            onAddCustom={(name) => {
              setSessionCustom((s) => (s.includes(name) ? s : [...s, name]));
              setAromas((s) => (s.includes(name) ? s : [...s, name]));
              touch(2);
            }}
          />
          <Slider
            label="Интенсивность аромата"
            value={aromaIntensity}
            onChange={(v) => { setAromaIntensity(v); touch(2); }}
            leftLabel="едва слышен"
            rightLabel="мощный"
          />
          <div className="border-t border-stone-100 pt-1 dark:border-stone-800">
            <Slider
              kind="score"
              label="Балл за нос"
              value={scoreNose}
              onChange={(v) => { setScoreNose(v); touch(2); }}
              min={0}
              max={3}
              step={0.05}
              valueText={`${round1(scoreNose).toFixed(1)}/3.0`}
            />
          </div>
        </Section>

        {/* Вопросы от AI (между Носом и Вкусом) */}
        {aiQ === 'loading' && (
          <div className="mx-4 rounded-xl bg-white p-3 dark:bg-stone-900">
            <p className="animate-pulse text-[13px] text-stone-400 dark:text-stone-500">
              ✨ AI готовит вопросы…
            </p>
          </div>
        )}
        {Array.isArray(aiQ) && (
          <Section title="✨ Вопросы от AI">
            <div className="space-y-3">
              {aiQ.map((q, i) => (
                <div key={i}>
                  <p className="mb-1.5 text-[13px] text-stone-700 dark:text-stone-300">
                    {q.question}
                  </p>
                  <VoiceInput
                    rows={2}
                    value={q.answer}
                    onChange={(v) =>
                      setAiQ((list) => list.map((x, j) => (j === i ? { ...x, answer: v } : x)))
                    }
                    placeholder="ответ (не обязательно)"
                    onToast={setToast}
                  />
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* 3 · Вкус и текстура */}
        <Section title="3 · Вкус и текстура">
          <Slider label="Сладость" value={taste.sweetness} onChange={(v) => { setTaste((t) => ({ ...t, sweetness: v })); touch(3); }} leftLabel="сухое" rightLabel="сладкое" />
          <Slider label="Кислотность" value={taste.acidity} onChange={(v) => { setTaste((t) => ({ ...t, acidity: v })); touch(3); }} leftLabel="вялая" rightLabel="резкая" />
          <Slider label="Танины" value={taste.tannins} onChange={(v) => { setTaste((t) => ({ ...t, tannins: v })); touch(3); }} leftLabel="мягкие" rightLabel="жёсткие" />
          <Slider label="Тело" value={taste.body} onChange={(v) => { setTaste((t) => ({ ...t, body: v })); touch(3); }} leftLabel="лёгкое" rightLabel="полное" />
          <Slider label="Баланс" value={taste.balance} onChange={(v) => { setTaste((t) => ({ ...t, balance: v })); touch(3); }} leftLabel="разваливается" rightLabel="гармония" />

          <div className="mt-2 flex items-center justify-between">
            <p className="text-[13px] text-stone-600 dark:text-stone-300">Вкусовые ноты</p>
            <button
              type="button"
              onClick={() => { setTasteFlavors([...aromas]); touch(3); }}
              className="flex items-center gap-1 text-[12px] font-medium text-wine-600 dark:text-wine-400"
            >
              <Copy className="size-3" /> скопировать из носа
            </button>
          </div>
          <div className="mt-1.5">
            <AromaPicker
              options={aromaOptions}
              selected={tasteFlavors}
              onToggle={(a) => { setTasteFlavors((s) => (s.includes(a) ? s.filter((x) => x !== a) : [...s, a])); touch(3); }}
              onAddCustom={(name) => {
                setSessionCustom((s) => (s.includes(name) ? s : [...s, name]));
                setTasteFlavors((s) => (s.includes(name) ? s : [...s, name]));
                touch(3);
              }}
            />
          </div>

          <div className="mt-1 border-t border-stone-100 pt-1 dark:border-stone-800">
            <Slider
              kind="score"
              label="Балл за вкус"
              value={scoreTaste}
              onChange={(v) => { setScoreTaste(v); touch(3); }}
              min={0}
              max={3}
              step={0.05}
              valueText={`${round1(scoreTaste).toFixed(1)}/3.0`}
            />
            <Slider
              label="Послевкусие"
              value={finishLength}
              onChange={(v) => { setFinishLength(v); touch(3); }}
              leftLabel="короткое"
              rightLabel="минуты"
            />
            <Slider
              kind="score"
              label="Балл за послевкусие"
              value={scoreFinish}
              onChange={(v) => { setScoreFinish(v); touch(3); }}
              min={0}
              max={1.5}
              step={0.05}
              valueText={`${round1(scoreFinish).toFixed(1)}/1.5`}
            />
          </div>
        </Section>

        {/* 4 · Сейчас в бокале */}
        <Section title="4 · Сейчас в бокале">
          <VoiceInput
            value={notesNow}
            onChange={(v) => { setNotesNow(v); touch(4); }}
            placeholder="Что чувствуешь? Пара слов честности..."
            onToast={setToast}
          />
          <div className="mt-2 flex items-center gap-2">
            {glassPhoto ? (
              <button type="button" onClick={() => { URL.revokeObjectURL(glassPhoto.url); setGlassPhoto(null); }} className="relative">
                <img src={glassPhoto.url} alt="" className="size-16 rounded-lg object-cover" />
                <span className="absolute -top-1 -right-1 grid size-5 place-items-center rounded-full bg-black/60 text-white">
                  <X className="size-3" />
                </span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="flex items-center gap-1.5 rounded-lg border border-dashed border-stone-300 px-3 py-2.5 text-[13px] text-stone-500 dark:border-stone-600 dark:text-stone-400"
              >
                <Camera className="size-4" /> Фото бокала
              </button>
            )}
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onPhoto} />
          </div>
        </Section>

        {/* 5 · Итог */}
        <Section title="5 · Итог">
          <Slider
            kind="score"
            label="Общее впечатление"
            value={scoreOverall}
            onChange={(v) => { setScoreOverall(v); touch(5); }}
            min={0}
            max={1}
            step={0.05}
            valueText={`${round1(scoreOverall).toFixed(1)}/1.0`}
          />
          <div className="mt-2 rounded-lg bg-stone-50 p-3 dark:bg-stone-800">
            {scoreRows.map(([label, value, max]) => (
              <div key={label} className="flex justify-between py-0.5 text-[13px]">
                <span className="text-stone-500 dark:text-stone-400">{label}</span>
                <span className="tabular-nums">{round1(value).toFixed(1)}/{max.toFixed(1)}</span>
              </div>
            ))}
            <div className="mt-1.5 flex items-center justify-between border-t border-stone-200 pt-2 dark:border-stone-700">
              <span className="text-sm font-medium">Итог</span>
              <span className={`rounded-full px-3 py-1 text-base font-bold ${scoreBadgeClasses(total)}`}>
                {total.toFixed(1)}
              </span>
            </div>
          </div>
          {prep.decant > 0 && (
            <label className="mt-2.5 flex items-center gap-2 text-[13px] text-stone-600 dark:text-stone-300">
              <input
                type="checkbox"
                checked={aerationPending}
                onChange={(e) => { setAerationPending(e.target.checked); touch(5); }}
                className="size-4 accent-wine-600"
              />
              напомнить дозаполнить после аэрации
            </label>
          )}
          <button
            onClick={save}
            disabled={saving}
            className="mt-3 w-full rounded-lg bg-wine-600 py-3 text-sm font-medium text-white disabled:opacity-60 dark:bg-wine-400 dark:text-stone-950"
          >
            Сохранить дегустацию
          </button>
        </Section>
      </div>

      {/* Диалог списания бутылки */}
      {writeOff && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 px-6">
          <div className="w-full max-w-sm rounded-2xl bg-white p-4 shadow-xl dark:bg-stone-900">
            <p className="text-base font-semibold">Бутылка из погреба?</p>
            <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">
              {writeOff.quantity === 1
                ? 'Это последняя — вино переедет в Историю'
                : `Списать одну? Останется ${writeOff.quantity - 1}`}
            </p>
            <div className="mt-3.5 flex gap-2">
              <button
                onClick={() => finishWriteOff(true)}
                className="flex-1 rounded-lg bg-wine-600 py-2.5 text-sm font-medium text-white dark:bg-wine-400 dark:text-stone-950"
              >
                Списать −1
              </button>
              <button
                onClick={() => finishWriteOff(false)}
                className="flex-1 rounded-lg border border-stone-300 py-2.5 text-sm font-medium text-stone-700 dark:border-stone-600 dark:text-stone-300"
              >
                Не списывать
              </button>
            </div>
          </div>
        </div>
      )}

      <Toast message={toast} onDone={() => setToast(null)} />
    </div>
  );
}
