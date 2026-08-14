import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Camera, Plus, Wine, X } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db.js';
import { compressImage } from '../utils/image.js';
import { analyzeWineList } from '../api/ai.js';
import { pluralize } from '../utils/plural.js';

const SCAN_STATUSES = ['Читаю карту…', 'Советуюсь с сомелье…', 'Подбираю рекомендации…'];

const ERROR_BANNERS = {
  daily_limit: 'Дневной лимит AI исчерпан — вернись завтра',
  ai_overloaded: 'AI перегружен, попробуй через минуту',
  offline: 'Для анализа карты нужен интернет',
  network: 'Для анализа карты нужен интернет',
  forbidden: 'Сервис недоступен — обнови приложение или загляни позже',
};

const fmtDate = (iso) =>
  new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' }).replace(' г.', '');

// /winelist: история сканов винных карт + новый скан (до 5 страниц одним S5)
export default function WineListScreen() {
  const navigate = useNavigate();
  const [mode, setMode] = useState('list'); // list | shoot | scanning
  const [photos, setPhotos] = useState([]); // {blob, url}
  const [restaurant, setRestaurant] = useState('');
  const [banner, setBanner] = useState(null);
  const [statusIdx, setStatusIdx] = useState(0);
  const cameraRef = useRef(null);
  const galleryRef = useRef(null);
  const statusTimer = useRef(null);

  const scans = useLiveQuery(() =>
    db.restaurantScans.orderBy('date').reverse().toArray()
  );

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const blob = await compressImage(file);
      setPhotos((prev) => [...prev, { blob, url: URL.createObjectURL(blob) }].slice(0, 5));
      setBanner(null);
    } catch {
      setBanner('Не удалось обработать фото');
    }
  };

  const analyze = async () => {
    setBanner(null);
    setMode('scanning');
    setStatusIdx(0);
    statusTimer.current = setInterval(
      () => setStatusIdx((i) => (i + 1) % SCAN_STATUSES.length),
      4000
    );
    const res = await analyzeWineList(photos.map((p) => p.blob));
    clearInterval(statusTimer.current);

    if (!res.ok) {
      setMode('shoot');
      setBanner(ERROR_BANNERS[res.error] ?? `Не получилось (${res.error})`);
      return;
    }
    const positions = res.data.positions ?? [];
    if (positions.length < 3) {
      setMode('shoot');
      setBanner('Карта распозналась плохо — попробуй по одной странице и при хорошем свете');
      return;
    }
    // сохранить скан: фото + результат
    const now = new Date().toISOString();
    const scanId = crypto.randomUUID();
    const photoIds = [];
    for (const [i, p] of photos.entries()) {
      const pid = crypto.randomUUID();
      photoIds.push(pid);
      await db.photos.add({
        id: pid,
        wineId: null,
        tastingId: null,
        scanId,
        blob: p.blob,
        kind: 'winelist',
        order: i,
        createdAt: now,
      });
    }
    await db.restaurantScans.add({
      id: scanId,
      restaurantName: restaurant.trim() || null,
      date: now,
      photoIds,
      result: res.data,
      createdAt: now,
    });
    photos.forEach((p) => URL.revokeObjectURL(p.url));
    navigate(`/winelist/${scanId}`, { replace: true });
  };

  if (mode === 'scanning') {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-8 text-center">
        <Wine className="size-16 animate-pulse text-wine-600 dark:text-wine-400" strokeWidth={1.25} />
        <p className="text-base font-medium">{SCAN_STATUSES[statusIdx]}</p>
        <p className="text-sm text-stone-400 dark:text-stone-500">обычно 15–30 секунд</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col pb-8">
      <header className="flex items-center bg-stone-50/95 px-2 py-2 dark:bg-stone-950/95">
        <button
          onClick={() => (mode === 'shoot' ? setMode('list') : navigate(-1))}
          className="flex items-center gap-1 rounded-lg px-2 py-2 text-sm font-medium text-wine-600 dark:text-wine-400"
        >
          <ArrowLeft className="size-4" /> Назад
        </button>
        <h1 className="ml-2 text-base font-medium">Винная карта</h1>
      </header>

      <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={onFile} />
      <input ref={galleryRef} type="file" accept="image/*" className="hidden" onChange={onFile} />

      {banner && (
        <p className="mx-4 mt-2 rounded-xl bg-amber-100 px-4 py-3 text-center text-sm text-amber-800 dark:bg-amber-900 dark:text-amber-200">
          {banner}
        </p>
      )}

      {mode === 'list' ? (
        <div className="mt-2 space-y-2 px-4">
          {(scans ?? []).map((s) => (
            <button
              key={s.id}
              onClick={() => navigate(`/winelist/${s.id}`)}
              className="block w-full rounded-xl bg-white p-3 text-left dark:bg-stone-900"
            >
              <p className="text-sm font-medium">{s.restaurantName ?? 'Без названия'}</p>
              <p className="mt-0.5 text-[12px] text-stone-400 dark:text-stone-500">
                {fmtDate(s.date)} · {s.result?.positions?.length ?? 0}{' '}
                {pluralize(s.result?.positions?.length ?? 0, 'позиция', 'позиции', 'позиций')}
              </p>
            </button>
          ))}
          {scans?.length === 0 && (
            <p className="px-6 py-10 text-center text-sm text-stone-400 dark:text-stone-500">
              Сфотографируй винную карту ресторана — AI разберёт позиции и подскажет, что взять
            </p>
          )}
          <button
            onClick={() => setMode('shoot')}
            className="mt-2 w-full rounded-xl bg-wine-600 py-3 text-sm font-medium text-white dark:bg-wine-400 dark:text-stone-950"
          >
            + Новый скан
          </button>
        </div>
      ) : (
        <div className="mt-3 flex flex-1 flex-col items-center gap-4 px-6">
          {photos.length > 0 && (
            <div className="flex w-full gap-2 overflow-x-auto">
              {photos.map((p, i) => (
                <div key={p.url} className="relative shrink-0">
                  <img src={p.url} alt="" className="h-28 w-20 rounded-lg object-cover" />
                  <button
                    onClick={() =>
                      setPhotos((prev) => {
                        URL.revokeObjectURL(p.url);
                        return prev.filter((_, j) => j !== i);
                      })
                    }
                    aria-label="Убрать страницу"
                    className="absolute top-1 right-1 grid size-5 place-items-center rounded-full bg-black/55 text-white"
                  >
                    <X className="size-3" />
                  </button>
                  <span className="absolute bottom-1 left-1 rounded-full bg-black/55 px-1.5 text-[10px] text-white">
                    стр. {i + 1}
                  </span>
                </div>
              ))}
            </div>
          )}

          {photos.length === 0 ? (
            <div className="flex w-full max-w-xs flex-col gap-2 pt-6">
              <button
                onClick={() => cameraRef.current?.click()}
                className="flex items-center justify-center gap-2 rounded-xl bg-wine-600 py-4 text-[15px] font-medium text-white dark:bg-wine-400 dark:text-stone-950"
              >
                <Camera className="size-5" /> Снять страницу карты
              </button>
              <button
                onClick={() => galleryRef.current?.click()}
                className="rounded-xl border border-stone-300 py-3.5 text-sm font-medium text-stone-700 dark:border-stone-600 dark:text-stone-300"
              >
                🖼 Выбрать из галереи
              </button>
            </div>
          ) : (
            <div className="flex w-full max-w-xs flex-col gap-2">
              {photos.length < 5 && (
                <button
                  onClick={() => galleryRef.current?.click()}
                  className="flex items-center justify-center gap-1.5 rounded-lg border border-stone-300 py-2.5 text-sm font-medium text-stone-700 dark:border-stone-600 dark:text-stone-300"
                >
                  <Plus className="size-4" /> Ещё страница
                </button>
              )}
              <input
                value={restaurant}
                onChange={(e) => setRestaurant(e.target.value)}
                placeholder="Ресторан (не обязательно)"
                className="h-10 w-full rounded-lg border border-stone-200 bg-white px-3 text-sm outline-none focus:border-wine-400 dark:border-stone-700 dark:bg-stone-900"
              />
              <button
                onClick={analyze}
                className="rounded-lg bg-wine-600 py-3 text-sm font-medium text-white dark:bg-wine-400 dark:text-stone-950"
              >
                Проанализировать
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
