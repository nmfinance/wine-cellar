import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Camera, Wine, X } from 'lucide-react';
import { db } from '../db.js';
import { compressImage } from '../utils/image.js';
import { usePageTitle } from '../utils/title.js';
import { scanLabel } from '../api/ai.js';
import { buildVivinoQuery, lookupVivinoCached } from '../api/vivino.js';
import { matchScore } from '../api/score.js';
import { addWine, updateWine } from '../data/wines.js';
import { ensureWineryInfo } from '../data/wineries.js';
import { ensureDeepInfo } from '../data/deep.js';
import { WineForm } from './WineFormScreen.jsx';

const COLOR_MAP = { красное: 'red', белое: 'white', розовое: 'rose', оранжевое: 'orange' };
const SWEET_MAP = { сухое: 'dry', полусухое: 'semidry', полусладкое: 'semisweet', сладкое: 'sweet' };
const SCAN_STATUSES = ['Разглядываю этикетку…', 'Читаю мелкий шрифт…', 'Ищу вино в памяти…'];

// Маппинг ответа S1 в контракт схемы wines
function s1ToInitialData(d) {
  return {
    name: d.name ?? '',
    wineryName: d.winery ?? '',
    year: typeof d.year === 'number' ? d.year : null,
    nvFlag: d.nv_flag === true,
    color: COLOR_MAP[String(d.color ?? '').toLowerCase()] ?? 'red',
    sweetness: SWEET_MAP[String(d.sweetness ?? '').toLowerCase()] ?? null,
    sparkling: d.sparkling === true,
    fortified: d.fortified === true,
    grapes: Array.isArray(d.grapes)
      ? d.grapes
          .filter((g) => g?.name)
          .map((g) => ({ name: g.name, percent: typeof g.percent === 'number' ? g.percent : null }))
      : [],
    appellation: d.appellation ?? null,
    region: d.region ?? null,
    country: d.country ?? null,
    alcohol: typeof d.alcohol === 'number' ? d.alcohol : null,
    quantity: 1,
    aiReference:
      d.reference && (d.reference.style || d.reference.peak || d.reference.pairing)
        ? d.reference
        : null,
  };
}

const ERROR_BANNERS = {
  daily_limit: { text: 'Дневной лимит AI исчерпан. Добавь вино вручную — или вернись завтра', action: 'manual' },
  ai_overloaded: { text: 'AI перегружен, попробуй через минуту', action: 'retry' },
  offline: { text: 'Для скана нужен интернет', action: 'manual' },
  network: { text: 'Для скана нужен интернет', action: 'manual' },
};

export default function ScanScreen() {
  const navigate = useNavigate();
  usePageTitle('Скан этикетки');
  const [step, setStep] = useState('photo'); // photo | scanning | review
  const [photos, setPhotos] = useState([]); // {blob, url}
  const [banner, setBanner] = useState(null); // {text, action?: 'manual'|'retry', warn?}
  const [statusIdx, setStatusIdx] = useState(0);
  const [review, setReview] = useState(null); // {s1, initialData, vivinoQuery}
  const cameraRef = useRef(null); // input с capture — принудительная камера
  const galleryRef = useRef(null); // input без capture — системный выбор
  const abortRef = useRef(null);
  const photosRef = useRef([]);
  photosRef.current = photos;

  useEffect(() => {
    return () => photosRef.current.forEach((p) => URL.revokeObjectURL(p.url));
  }, []);

  // ротация статусов ожидания
  useEffect(() => {
    if (step !== 'scanning') return;
    const t = setInterval(() => setStatusIdx((i) => (i + 1) % SCAN_STATUSES.length), 4000);
    return () => clearInterval(t);
  }, [step]);

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const blob = await compressImage(file);
      setPhotos((prev) =>
        [...prev, { blob, url: URL.createObjectURL(blob) }].slice(0, 2)
      );
      setBanner(null);
    } catch {
      setBanner({ text: 'Не удалось обработать фото — попробуй ещё раз' });
    }
  };

  const removePhoto = (i) => {
    setPhotos((prev) => {
      URL.revokeObjectURL(prev[i].url);
      return prev.filter((_, j) => j !== i);
    });
  };

  const retake = () => {
    photos.forEach((p) => URL.revokeObjectURL(p.url));
    setPhotos([]);
    setReview(null);
    setBanner(null);
    setStep('photo');
  };

  // ok/multiple: вино сразу в Историю (historyReason='scanned') → карточка
  const saveScannedWine = async (d) => {
    const initial = s1ToInitialData(d);
    const ts = new Date().toISOString();
    const wine = await addWine({
      ...initial,
      status: 'history',
      source: 'scan',
      historyReason: 'scanned',
      historyAt: ts,
      quantity: 0,
      confidence: d.confidence ?? null,
    });
    // фото: первое label, второе back_label
    await db.photos.bulkAdd(
      photos.map((p, i) => ({
        id: crypto.randomUUID(),
        wineId: wine.id,
        tastingId: null,
        blob: p.blob,
        kind: i === 0 ? 'label' : 'back_label',
        order: i,
        createdAt: ts,
      }))
    );
    await ensureWineryInfo(wine); // справка S2 грузится внутри асинхронно
    ensureDeepInfo(wine); // S6 «глубже о вине» — асинхронно, один раз
    // Vivino — асинхронно, карточка подхватит через useLiveQuery
    if (d.winery || d.name) {
      const query = buildVivinoQuery(d);
      lookupVivinoCached(query, initial.year)
        .then((res) => {
          if (!res.ok) return;
          const score = matchScore(query, res.data.matchedName);
          if (score === 'low') return; // низкий матч не подставляем
          return updateWine(wine.id, {
            vivino: { ...res.data, matchScore: score, checkedAt: new Date().toISOString(), manual: false },
          });
        })
        .catch(() => {});
    }
    return wine;
  };

  const doScan = async () => {
    setBanner(null);
    setStatusIdx(0);
    setStep('scanning');
    abortRef.current = new AbortController();
    const res = await scanLabel(photos.map((p) => p.blob), abortRef.current.signal);

    if (res.ok) {
      const d = res.data;
      if (d.status === 'not_wine') {
        setStep('photo');
        setBanner({ text: 'Это не похоже на винную этикетку' });
        return;
      }
      if (d.status === 'unreadable') {
        // мусор автоматом не сохраняем — форма проверки с частичными полями
        setReview({ s1: d, initialData: s1ToInitialData(d), vivinoQuery: null });
        setStep('review');
        return;
      }
      const wine = await saveScannedWine(d);
      navigate(`/wine/${wine.id}`, { replace: true, state: { scanned: true } });
      return;
    }

    if (res.error === 'cancelled') {
      setStep('photo');
      return;
    }
    setStep('photo');
    setBanner(
      ERROR_BANNERS[res.error] ?? { text: `Не получилось распознать (${res.error})`, action: 'retry' }
    );
  };

  // --- шаг 3: форма проверки ---------------------------------------------------
  if (step === 'review' && review) {
    const st = review.s1.status;
    const scanBanner = (
      <div className="mx-4 mb-2">
        <div className="flex items-center gap-2.5 rounded-xl bg-white p-2.5 dark:bg-stone-900">
          {photos[0] && (
            <img src={photos[0].url} alt="" className="h-10 w-8 shrink-0 rounded-md object-cover" />
          )}
          <p className="min-w-0 flex-1 text-[13px]">
            {st === 'unreadable' ? (
              <span className="text-stone-600 dark:text-stone-300">
                Не удалось прочитать этикетку — попробуй при лучшем свете или заполни вручную
              </span>
            ) : (
              <>✓ Этикетка распознана · Проверь поля</>
            )}
          </p>
          <button
            onClick={retake}
            className="shrink-0 text-[13px] font-medium text-wine-600 dark:text-wine-400"
          >
            Переснять
          </button>
        </div>
        {st === 'multiple' && (
          <p className="mt-1.5 rounded-lg bg-amber-100 px-3 py-2 text-[12px] text-amber-800 dark:bg-amber-900 dark:text-amber-200">
            В кадре несколько бутылок — распознал центральную
          </p>
        )}
      </div>
    );
    return (
      <WineForm
        mode="create"
        initialData={review.initialData}
        confidence={review.s1.confidence ?? null}
        initialPhotos={photos.map((p) => p.blob)}
        source="scan"
        banner={scanBanner}
        vivinoQuery={review.vivinoQuery}
        vivinoYear={review.initialData.year}
      />
    );
  }

  // --- шаг 2: ожидание ----------------------------------------------------------
  if (step === 'scanning') {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-8 text-center">
        <Wine className="size-16 animate-pulse text-wine-600 dark:text-wine-400" strokeWidth={1.25} />
        <p className="text-base font-medium">{SCAN_STATUSES[statusIdx]}</p>
        <p className="text-sm text-stone-400 dark:text-stone-500">обычно 10–20 секунд</p>
        <button
          onClick={() => abortRef.current?.abort()}
          className="mt-4 rounded-lg border border-stone-300 px-5 py-2.5 text-sm font-medium text-stone-600 dark:border-stone-600 dark:text-stone-300"
        >
          Отмена
        </button>
      </div>
    );
  }

  // --- шаг 1: фото ---------------------------------------------------------------
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex items-center bg-stone-50/95 px-2 py-2 dark:bg-stone-950/95">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-1 rounded-lg px-2 py-2 text-sm font-medium text-wine-600 dark:text-wine-400"
        >
          <ArrowLeft className="size-4" /> Назад
        </button>
        <h1 className="ml-2 text-base font-medium">Скан этикетки</h1>
      </header>

      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={onFile}
      />
      <input ref={galleryRef} type="file" accept="image/*" className="hidden" onChange={onFile} />

      <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 pb-16">
        {banner && (
          <div className="w-full rounded-xl bg-amber-100 px-4 py-3 text-center text-sm text-amber-800 dark:bg-amber-900 dark:text-amber-200">
            {banner.text}
            {banner.action === 'manual' && (
              <button
                onClick={() => navigate('/add', { replace: true })}
                className="mt-2 block w-full rounded-lg bg-wine-600 py-2 text-sm font-medium text-white dark:bg-wine-400 dark:text-stone-950"
              >
                Заполнить вручную
              </button>
            )}
            {banner.action === 'retry' && photos.length > 0 && (
              <button
                onClick={doScan}
                className="mt-2 block w-full rounded-lg bg-wine-600 py-2 text-sm font-medium text-white dark:bg-wine-400 dark:text-stone-950"
              >
                Повторить
              </button>
            )}
          </div>
        )}

        {photos.length === 0 ? (
          <div className="flex w-full max-w-xs flex-col gap-2">
            <button
              onClick={() => cameraRef.current?.click()}
              className="flex items-center justify-center gap-2 rounded-xl bg-wine-600 py-4 text-[15px] font-medium text-white dark:bg-wine-400 dark:text-stone-950"
            >
              <Camera className="size-5" /> Снять этикетку
            </button>
            <button
              onClick={() => galleryRef.current?.click()}
              className="rounded-xl border border-stone-300 py-3.5 text-sm font-medium text-stone-700 dark:border-stone-600 dark:text-stone-300"
            >
              🖼 Выбрать из галереи
            </button>
          </div>
        ) : (
          <>
            <div className="flex gap-3">
              {photos.map((p, i) => (
                <div key={p.url} className="relative">
                  <img src={p.url} alt="" className="h-40 w-32 rounded-xl object-cover" />
                  <button
                    onClick={() => removePhoto(i)}
                    aria-label="Убрать фото"
                    className="absolute top-1 right-1 grid size-6 place-items-center rounded-full bg-black/55 text-white"
                  >
                    <X className="size-3.5" />
                  </button>
                  <span className="absolute bottom-1 left-1 rounded-full bg-black/55 px-2 py-0.5 text-[10px] text-white">
                    {i === 0 ? 'этикетка' : 'контрэтикетка'}
                  </span>
                </div>
              ))}
            </div>
            <div className="flex w-full max-w-xs flex-col gap-2">
              {photos.length === 1 && (
                // P22.3: оба пути — на части устройств input без capture
                // открывает только выбор файлов, камеру надо просить явно
                <div className="flex gap-2">
                  <button
                    onClick={() => cameraRef.current?.click()}
                    className="flex-1 rounded-lg border border-stone-300 py-2.5 text-sm font-medium text-stone-700 dark:border-stone-600 dark:text-stone-300"
                  >
                    📷 Контрэтикетка
                  </button>
                  <button
                    onClick={() => galleryRef.current?.click()}
                    className="flex-1 rounded-lg border border-stone-300 py-2.5 text-sm font-medium text-stone-700 dark:border-stone-600 dark:text-stone-300"
                  >
                    🖼 Из галереи
                  </button>
                </div>
              )}
              <button
                onClick={doScan}
                className="rounded-lg bg-wine-600 py-3 text-sm font-medium text-white dark:bg-wine-400 dark:text-stone-950"
              >
                Распознать
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
