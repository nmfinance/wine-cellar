import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowLeft, Camera, Minus, Plus, Settings, X } from 'lucide-react';
import { db } from '../db.js';
import { addWine, updateWine } from '../data/wines.js';
import { listRacks, shelfOccupancy } from '../data/cellar.js';
import { compressImage } from '../utils/image.js';
import CellarStructureEditor from '../components/CellarStructureEditor.jsx';
import Toast from '../components/Toast.jsx';
import VivinoSearchBlock from '../components/VivinoSearchBlock.jsx';

const inputCls =
  'h-10 w-full rounded-lg border border-stone-200 bg-white px-3 text-sm outline-none focus:border-wine-400 dark:border-stone-700 dark:bg-stone-900';

const COLOR_OPTIONS = [
  ['red', 'Красное'],
  ['white', 'Белое'],
  ['rose', 'Розовое'],
  ['orange', 'Оранжевое'],
];
const SWEET_OPTIONS = [
  ['dry', 'Сухое'],
  ['semidry', 'Полусухое'],
  ['semisweet', 'Полусладкое'],
  ['sweet', 'Сладкое'],
  [null, '—'],
];

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

// Обёртка поля: label + жёлтая подсветка для scan-review (confidence low)
function Field({ label, confKey, confidence, children }) {
  const low = confKey && confidence?.[confKey] === 'low';
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-stone-500 dark:text-stone-400">
        {label}
      </label>
      <div className={low ? 'rounded-lg ring-2 ring-amber-400 dark:ring-amber-500' : ''}>
        {children}
      </div>
      {low && (
        <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">AI не уверен, проверь</p>
      )}
    </div>
  );
}

// Многорежимная форма: create | edit | scan-review (initialData + confidence
// + initialPhotos + vivinoQuery — приходят из потока скана)
export function WineForm({
  mode,
  wine = null,
  initialData = null,
  confidence = null,
  initialPhotos = null,
  banner = null,
  source = 'manual',
  vivinoQuery = null,
  vivinoYear = null,
}) {
  const navigate = useNavigate();
  const [toast, setToast] = useState(null);
  const [saving, setSaving] = useState(false);
  const vivinoRef = useRef(null); // результат VivinoSearchBlock к моменту сабмита

  const src = wine ?? initialData;
  const [f, setF] = useState(() => ({
    name: src?.name ?? '',
    wineryName: src?.wineryName ?? '',
    year: src?.year != null ? String(src.year) : '',
    nvFlag: src?.nvFlag ?? false,
    color: src?.color ?? 'red',
    sweetness: src?.sweetness ?? null,
    sparkling: src?.sparkling ?? false,
    fortified: src?.fortified ?? false,
    grapes: src?.grapes?.length
      ? src.grapes.map((g) => ({ name: g.name, percent: g.percent != null ? String(g.percent) : '' }))
      : [],
    appellation: src?.appellation ?? '',
    region: src?.region ?? '',
    country: src?.country ?? '',
    alcohol: src?.alcohol != null ? String(src.alcohol) : '',
    quantity: src?.quantity ?? 1,
    price: src?.price != null ? String(src.price) : '',
    rackId: src?.location?.rackId ?? null,
    shelf: src?.location?.shelf ?? null,
    locationFreeText: src?.locationFreeText ?? '',
    vivinoRating: src?.vivino?.rating != null ? String(src.vivino.rating) : '',
    notes: src?.notes ?? '',
  }));
  const set = (key, value) => setF((prev) => ({ ...prev, [key]: value }));

  // --- фото: blob'ы в стейте, запись только при сохранении -------------------
  const [photos, setPhotos] = useState(() =>
    (initialPhotos ?? []).map((blob) => ({
      key: crypto.randomUUID(),
      blob,
      url: URL.createObjectURL(blob),
      existing: false,
    }))
  ); // {key, id?, blob, url, existing}
  const [removedIds, setRemovedIds] = useState([]);
  const fileRef = useRef(null);
  const photosRef = useRef([]);
  photosRef.current = photos;

  useEffect(() => {
    if (!wine) return;
    let alive = true;
    db.photos
      .where('wineId')
      .equals(wine.id)
      .sortBy('order')
      .then((list) => {
        if (!alive) return;
        const existing = list.map((p) => ({
          key: p.id,
          id: p.id,
          blob: p.blob,
          url: URL.createObjectURL(p.blob),
          existing: true,
        }));
        // мерж, а не перезапись: фото, добавленные до резолва запроса, не теряются
        setPhotos((prev) => [...existing, ...prev.filter((p) => !p.existing)]);
      });
    return () => {
      alive = false;
    };
  }, [wine?.id]);

  useEffect(() => () => photosRef.current.forEach((p) => URL.revokeObjectURL(p.url)), []);

  const onFiles = async (e) => {
    const files = [...e.target.files];
    e.target.value = '';
    const added = [];
    for (const file of files) {
      try {
        const blob = await compressImage(file);
        added.push({ key: crypto.randomUUID(), blob, url: URL.createObjectURL(blob), existing: false });
      } catch (err) {
        console.error('[form] фото не сжалось:', err);
        setToast('Не удалось обработать фото');
      }
    }
    if (added.length) setPhotos((prev) => [...prev, ...added]);
  };

  const removePhoto = (photo) => {
    if (!window.confirm('Удалить фото?')) return;
    if (photo.existing) setRemovedIds((prev) => [...prev, photo.id]);
    URL.revokeObjectURL(photo.url);
    setPhotos((prev) => prev.filter((p) => p.key !== photo.key));
  };

  // --- подсказки из базы ------------------------------------------------------
  const suggestions = useLiveQuery(async () => {
    const wines = await db.wines.toArray();
    const wineries = new Set(wines.map((w) => w.wineryName).filter(Boolean));
    (await db.wineries.toArray()).forEach((w) => wineries.add(w.name));
    return {
      wineries: [...wineries].sort(),
      countries: [...new Set(wines.map((w) => w.country).filter(Boolean))].sort(),
      grapes: [...new Set(wines.flatMap((w) => (w.grapes ?? []).map((g) => g.name)))].sort(),
    };
  });

  // --- место в погребе --------------------------------------------------------
  const racks = useLiveQuery(listRacks);
  const occupancy = useLiveQuery(
    () => (f.rackId ? shelfOccupancy(f.rackId) : Promise.resolve(null)),
    [f.rackId]
  );
  const [freeTextOpen, setFreeTextOpen] = useState(!!src?.locationFreeText);
  // конструктор погреба открывается ОВЕРЛЕЕМ, чтобы форма не теряла стейт
  const [cellarEditorOpen, setCellarEditorOpen] = useState(false);
  const selectedRack = racks?.find((r) => r.id === f.rackId);

  // предупреждение по процентам сортов
  const percents = f.grapes.map((g) => g.percent).filter((p) => p !== '');
  const percentSum = percents.reduce((a, b) => a + Number(b), 0);
  const grapeWarn = percents.length > 0 && percentSum !== 100 ? `Сумма ${percentSum}%` : null;

  const nameOk = f.name.trim().length > 0;
  const showCellarFields = mode === 'create' || wine?.status === 'cellar';

  // --- сохранение -------------------------------------------------------------
  const save = async (status) => {
    if (!nameOk || saving) return;
    setSaving(true);
    try {
      const num = (v) => (v !== '' && !Number.isNaN(Number(v)) ? Number(v) : null);
      const isCellar = status === 'cellar';
      const data = {
        name: f.name.trim(),
        wineryName: f.wineryName.trim(),
        year: f.nvFlag ? null : num(f.year),
        nvFlag: f.nvFlag,
        color: f.color,
        sweetness: f.sweetness,
        sparkling: f.sparkling,
        fortified: f.fortified,
        grapes: f.grapes
          .filter((g) => g.name.trim())
          .map((g) => ({ name: g.name.trim(), percent: num(g.percent) })),
        appellation: f.appellation.trim() || null,
        region: f.region.trim() || null,
        country: f.country.trim() || null,
        alcohol: num(f.alcohol),
        price: num(f.price),
        notes: f.notes.trim() || null,
      };

      let wineId;
      if (mode === 'edit') {
        const patch = { ...data };
        if (wine.status === 'cellar') {
          patch.quantity = f.quantity;
          patch.location = f.rackId && f.shelf != null ? { rackId: f.rackId, shelf: f.shelf } : null;
          patch.locationFreeText = f.locationFreeText.trim() || null;
        }
        await updateWine(wine.id, patch);
        wineId = wine.id;
      } else {
        const rec = await addWine({
          ...data,
          status,
          source,
          quantity: isCellar ? f.quantity : 0,
          location:
            isCellar && f.rackId && f.shelf != null ? { rackId: f.rackId, shelf: f.shelf } : null,
          locationFreeText: isCellar ? f.locationFreeText.trim() || null : null,
          // наследие скана: AI-справка, confidence для жёлтых рамок, Vivino-матч
          ...(initialData?.aiReference ? { aiReference: initialData.aiReference } : {}),
          ...(confidence ? { confidence } : {}),
          ...(vivinoRef.current ? { vivino: vivinoRef.current } : {}),
        });
        wineId = rec.id;
      }

      // ручной рейтинг Vivino (перебивает найденное сканом, сохраняя матч)
      const rating = num(f.vivinoRating);
      const vivinoBase = wine?.vivino ?? vivinoRef.current ?? null;
      if (rating != null && rating !== (vivinoBase?.rating ?? null)) {
        const now = new Date().toISOString();
        const vivino = vivinoBase
          ? { ...vivinoBase, rating, manual: true, checkedAt: now }
          : {
              rating,
              ratingsCount: null,
              source: null,
              matchedName: null,
              matchScore: null,
              price: null,
              priceCurrency: null,
              checkedAt: now,
              manual: true,
            };
        await updateWine(wineId, { vivino });
      }

      // фото: удалить убранные, дописать новые, переупорядочить
      await db.transaction('rw', db.photos, async () => {
        if (removedIds.length) await db.photos.bulkDelete(removedIds);
        let order = 0;
        for (const p of photos) {
          const kind = order === 0 ? 'label' : 'back_label';
          if (p.existing) await db.photos.update(p.id, { order, kind });
          else
            await db.photos.add({
              id: crypto.randomUUID(),
              wineId,
              tastingId: null,
              blob: p.blob,
              kind,
              order,
              createdAt: new Date().toISOString(),
            });
          order++;
        }
      });

      navigate(`/wine/${wineId}`, { replace: true, state: { toast: 'Сохранено' } });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-10 flex items-center bg-stone-50/95 px-2 py-2 backdrop-blur dark:bg-stone-950/95">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-1 rounded-lg px-2 py-2 text-sm font-medium text-wine-600 dark:text-wine-400"
        >
          <ArrowLeft className="size-4" /> Назад
        </button>
        <h1 className="ml-2 text-base font-medium">
          {mode === 'edit' ? 'Редактировать вино' : 'Новое вино'}
        </h1>
      </header>

      {banner}

      <div className="flex-1 space-y-4 px-4 pt-2 pb-4">
        {/* Фото */}
        <div className="flex gap-2 overflow-x-auto py-1 [scrollbar-width:none]">
          {photos.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => removePhoto(p)}
              className="relative size-[72px] shrink-0 overflow-hidden rounded-lg"
              aria-label="Удалить фото"
            >
              <img src={p.url} alt="" className="h-full w-full object-cover" />
              <span className="absolute top-0.5 right-0.5 grid size-5 place-items-center rounded-full bg-black/50 text-white">
                <X className="size-3" />
              </span>
            </button>
          ))}
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="grid size-[72px] shrink-0 place-items-center rounded-lg border border-dashed border-stone-300 text-stone-400 dark:border-stone-600 dark:text-stone-500"
          >
            <span className="flex flex-col items-center text-[11px]">
              <Camera className="mb-0.5 size-5" />
              Фото
            </span>
          </button>
          {/* без capture: системный выбор — камера или галерея */}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={onFiles}
          />
        </div>

        <Field label="Название *" confKey="name" confidence={confidence}>
          <input
            className={inputCls}
            value={f.name}
            onChange={(e) => set('name', e.target.value)}
            placeholder="Barolo Bussia"
          />
        </Field>

        <Field label="Винодельня" confKey="winery" confidence={confidence}>
          <input
            className={inputCls}
            value={f.wineryName}
            onChange={(e) => set('wineryName', e.target.value)}
            list="winery-suggest"
            placeholder="Aldo Conterno"
          />
          <datalist id="winery-suggest">
            {suggestions?.wineries.map((w) => (
              <option key={w} value={w} />
            ))}
          </datalist>
        </Field>

        <Field label="Год" confKey="year" confidence={confidence}>
          <div className="flex items-center gap-3">
            <input
              type="number"
              inputMode="numeric"
              className={`${inputCls} w-28`}
              value={f.year}
              disabled={f.nvFlag}
              onChange={(e) => set('year', e.target.value)}
              placeholder="2019"
            />
            <label className="flex items-center gap-1.5 text-sm text-stone-600 dark:text-stone-300">
              <input
                type="checkbox"
                checked={f.nvFlag}
                onChange={(e) => set('nvFlag', e.target.checked)}
                className="size-4 accent-wine-600"
              />
              NV (без года)
            </label>
          </div>
        </Field>

        <Field label="Тип" confKey="color" confidence={confidence}>
          <div className="flex flex-wrap gap-1.5">
            {COLOR_OPTIONS.map(([value, label]) => (
              <Chip key={value} active={f.color === value} onClick={() => set('color', value)}>
                {label}
              </Chip>
            ))}
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {SWEET_OPTIONS.map(([value, label]) => (
              <Chip
                key={String(value)}
                active={f.sweetness === value}
                onClick={() => set('sweetness', value)}
              >
                {label}
              </Chip>
            ))}
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <Chip active={f.sparkling} onClick={() => set('sparkling', !f.sparkling)}>
              Игристое
            </Chip>
            <Chip active={f.fortified} onClick={() => set('fortified', !f.fortified)}>
              Креплёное
            </Chip>
          </div>
        </Field>

        <Field label="Сорта" confKey="grapes" confidence={confidence}>
          <div className="space-y-1.5">
            {f.grapes.map((g, i) => (
              <div key={i} className="flex gap-1.5">
                <input
                  className={inputCls}
                  value={g.name}
                  list="grape-suggest"
                  placeholder="Неббиоло"
                  onChange={(e) =>
                    set(
                      'grapes',
                      f.grapes.map((x, j) => (j === i ? { ...x, name: e.target.value } : x))
                    )
                  }
                />
                <input
                  type="number"
                  inputMode="numeric"
                  className={`${inputCls} w-20`}
                  value={g.percent}
                  placeholder="%"
                  onChange={(e) =>
                    set(
                      'grapes',
                      f.grapes.map((x, j) => (j === i ? { ...x, percent: e.target.value } : x))
                    )
                  }
                />
                <button
                  type="button"
                  aria-label="Удалить сорт"
                  onClick={() => set('grapes', f.grapes.filter((_, j) => j !== i))}
                  className="grid size-10 shrink-0 place-items-center rounded-lg text-stone-400"
                >
                  <X className="size-4" />
                </button>
              </div>
            ))}
            <datalist id="grape-suggest">
              {suggestions?.grapes.map((g) => (
                <option key={g} value={g} />
              ))}
            </datalist>
            <button
              type="button"
              onClick={() => set('grapes', [...f.grapes, { name: '', percent: '' }])}
              className="text-sm font-medium text-wine-600 dark:text-wine-400"
            >
              + Добавить сорт
            </button>
            {grapeWarn && (
              <p className="text-[11px] text-amber-600 dark:text-amber-400">{grapeWarn}</p>
            )}
          </div>
        </Field>

        <Field label="Аппелласьон" confKey="appellation" confidence={confidence}>
          <input
            className={inputCls}
            value={f.appellation}
            onChange={(e) => set('appellation', e.target.value)}
            placeholder="Barolo DOCG"
          />
        </Field>
        <Field label="Регион" confKey="region" confidence={confidence}>
          <input
            className={inputCls}
            value={f.region}
            onChange={(e) => set('region', e.target.value)}
            placeholder="Пьемонт"
          />
        </Field>
        <Field label="Страна" confKey="country" confidence={confidence}>
          <input
            className={inputCls}
            value={f.country}
            onChange={(e) => set('country', e.target.value)}
            list="country-suggest"
            placeholder="Италия"
          />
          <datalist id="country-suggest">
            {suggestions?.countries.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </Field>

        <Field label="Алкоголь, %" confKey="alcohol" confidence={confidence}>
          <input
            type="number"
            inputMode="decimal"
            step="0.1"
            className={`${inputCls} w-28`}
            value={f.alcohol}
            onChange={(e) => set('alcohol', e.target.value)}
            placeholder="14.5"
          />
        </Field>

        {showCellarFields && (
          <Field label="Количество">
            <div className="flex items-center gap-3">
              <button
                type="button"
                aria-label="Меньше"
                onClick={() => set('quantity', Math.max(0, f.quantity - 1))}
                className="grid size-10 place-items-center rounded-lg border border-stone-300 dark:border-stone-600"
              >
                <Minus className="size-4" />
              </button>
              <span className="w-8 text-center text-base font-medium">{f.quantity}</span>
              <button
                type="button"
                aria-label="Больше"
                onClick={() => set('quantity', f.quantity + 1)}
                className="grid size-10 place-items-center rounded-lg border border-stone-300 dark:border-stone-600"
              >
                <Plus className="size-4" />
              </button>
            </div>
          </Field>
        )}

        <Field label="Цена, ₽">
          <input
            type="number"
            inputMode="numeric"
            className={`${inputCls} w-36`}
            value={f.price}
            onChange={(e) => set('price', e.target.value)}
            placeholder="4 200"
          />
        </Field>

        {showCellarFields && (
          <Field label="Место в погребе">
            {racks?.length ? (
              <div className="space-y-1.5">
                <div className="flex flex-wrap gap-1.5">
                  {racks.map((r) => (
                    <Chip
                      key={r.id}
                      active={f.rackId === r.id}
                      onClick={() => {
                        set('rackId', f.rackId === r.id ? null : r.id);
                        set('shelf', null);
                      }}
                    >
                      {r.name}
                    </Chip>
                  ))}
                </div>
                {selectedRack && (
                  <div className="flex flex-wrap gap-1.5">
                    {selectedRack.shelves.map((s) => {
                      const free =
                        s.capacity != null ? Math.max(0, s.capacity - (occupancy?.[s.n] ?? 0)) : null;
                      return (
                        <Chip
                          key={s.n}
                          active={f.shelf === s.n}
                          onClick={() => set('shelf', f.shelf === s.n ? null : s.n)}
                        >
                          Полка {s.n}
                          {free != null && (
                            <span className="opacity-70"> · свободно {free} из {s.capacity}</span>
                          )}
                        </Chip>
                      );
                    })}
                  </div>
                )}
                {freeTextOpen ? (
                  <input
                    className={inputCls}
                    value={f.locationFreeText}
                    onChange={(e) => set('locationFreeText', e.target.value)}
                    placeholder="на даче"
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => setFreeTextOpen(true)}
                    className="text-sm text-stone-500 underline decoration-dotted dark:text-stone-400"
                  >
                    Другое место (текстом)
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setCellarEditorOpen(true)}
                  className="flex items-center gap-1.5 text-sm text-stone-500 dark:text-stone-400"
                >
                  <Settings className="size-4" /> Настроить структуру погреба
                </button>
              </div>
            ) : (
              <div className="space-y-1.5">
                <input
                  className={inputCls}
                  value={f.locationFreeText}
                  onChange={(e) => set('locationFreeText', e.target.value)}
                  placeholder="на даче"
                />
                <button
                  type="button"
                  onClick={() => setCellarEditorOpen(true)}
                  className="flex items-center gap-1.5 text-sm text-stone-500 dark:text-stone-400"
                >
                  <Settings className="size-4" /> Настроить структуру погреба
                </button>
              </div>
            )}
          </Field>
        )}

        <Field label="★ Рейтинг Vivino (вручную)">
          <input
            type="number"
            inputMode="decimal"
            step="0.1"
            min="0"
            max="5"
            className={`${inputCls} w-28`}
            value={f.vivinoRating}
            onChange={(e) => set('vivinoRating', e.target.value)}
            placeholder="4.2"
          />
        </Field>

        <Field label="Заметки">
          <textarea
            rows={3}
            className={`${inputCls} h-auto py-2`}
            value={f.notes}
            onChange={(e) => set('notes', e.target.value)}
            placeholder="Подарок, открыть на юбилей…"
          />
        </Field>

        {vivinoQuery && (
          <VivinoSearchBlock
            initialQuery={vivinoQuery}
            year={vivinoYear}
            onResult={(v) => {
              vivinoRef.current = v;
            }}
          />
        )}
      </div>

      {/* Кнопки */}
      <div className="sticky bottom-0 mt-auto bg-gradient-to-t from-stone-50 via-stone-50/90 px-4 pt-6 pb-[calc(1rem+env(safe-area-inset-bottom))] dark:from-stone-950 dark:via-stone-950/90">
        {!nameOk && (
          <p className="mb-1.5 text-center text-[11px] text-stone-400">Укажи название вина</p>
        )}
        {mode === 'edit' ? (
          <button
            disabled={!nameOk || saving}
            onClick={() => save(wine.status)}
            className="w-full rounded-lg bg-wine-600 py-3 text-sm font-medium text-white disabled:bg-stone-300 disabled:text-stone-500 dark:bg-wine-400 dark:text-stone-950 dark:disabled:bg-stone-700 dark:disabled:text-stone-400"
          >
            Сохранить
          </button>
        ) : (
          <div className="flex gap-2">
            <button
              disabled={!nameOk || saving}
              onClick={() => save('wishlist')}
              className="flex-1 rounded-lg border border-stone-300 py-3 text-sm font-medium text-stone-700 disabled:opacity-50 dark:border-stone-600 dark:text-stone-300"
            >
              В Wishlist
            </button>
            <button
              disabled={!nameOk || saving}
              onClick={() => save('cellar')}
              className="flex-1 rounded-lg bg-wine-600 py-3 text-sm font-medium text-white disabled:bg-stone-300 disabled:text-stone-500 dark:bg-wine-400 dark:text-stone-950 dark:disabled:bg-stone-700 dark:disabled:text-stone-400"
            >
              В погреб
            </button>
          </div>
        )}
      </div>

      {/* конструктор погреба поверх формы — стейт формы сохраняется */}
      {cellarEditorOpen && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-stone-50 dark:bg-stone-950">
          <div className="mx-auto max-w-[480px] pb-8">
            <header className="sticky top-0 z-10 bg-stone-50/95 px-2 py-2 backdrop-blur dark:bg-stone-950/95">
              <button
                onClick={() => setCellarEditorOpen(false)}
                className="flex items-center gap-1 rounded-lg px-2 py-2 text-sm font-medium text-wine-600 dark:text-wine-400"
              >
                <ArrowLeft className="size-4" /> Готово
              </button>
            </header>
            <CellarStructureEditor />
          </div>
        </div>
      )}

      <Toast message={toast} onDone={() => setToast(null)} />
    </div>
  );
}

export default function WineFormScreen({ mode }) {
  const { id } = useParams();
  const wine = useLiveQuery(
    () => (mode === 'edit' ? db.wines.get(id).then((w) => w ?? null) : Promise.resolve(null)),
    [mode, id]
  );

  if (mode === 'edit' && wine === undefined) return null;
  if (mode === 'edit' && wine === null)
    return <p className="mt-10 text-center text-sm text-stone-500">Вино не найдено</p>;
  // key: форма пере-инициализируется при смене вина
  return <WineForm key={wine?.id ?? 'new'} mode={mode} wine={wine} />;
}
