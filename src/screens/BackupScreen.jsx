import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowLeft, CloudUpload, RefreshCw } from 'lucide-react';
import { db } from '../db.js';
import { authorize, getToken, logout } from '../api/yadisk.js';
import { listBackups, restoreBackup, runBackup } from '../data/backup.js';
import { pluralize } from '../utils/plural.js';
import Toast from '../components/Toast.jsx';

const fmtDateTime = (iso) => {
  if (!iso) return null;
  const d = new Date(iso);
  const today = new Date().toDateString() === d.toDateString();
  const time = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  return today
    ? `сегодня ${time}`
    : `${d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })} ${time}`;
};

export default function BackupScreen() {
  const navigate = useNavigate();
  const [toast, setToast] = useState(null);
  const [busy, setBusy] = useState(null); // {phase, done, total} | null
  const [expired, setExpired] = useState(false);
  const [restoreList, setRestoreList] = useState(null); // null | [{name, modified}]
  const [, setTokenBump] = useState(0); // перерисовка после logout

  const status = useLiveQuery(async () => (await db.meta.get('backupStatus'))?.value ?? null);
  const token = getToken();

  const progressText = (p) =>
    p?.phase === 'photos' && p.total > 0 ? `фото ${p.done}/${p.total}` : 'база…';

  const backupNow = async () => {
    if (busy) return;
    setBusy({ phase: 'db' });
    setExpired(false);
    try {
      const res = await runBackup(token, setBusy);
      setToast(
        res.status === 'partial'
          ? `Бэкап частично: ${res.failedPhotos} фото не залилось`
          : 'Бэкап готов'
      );
    } catch (err) {
      if (err.status === 401) setExpired(true);
      else setToast('Бэкап не удался — попробуй позже');
    } finally {
      setBusy(null);
    }
  };

  const openRestore = async () => {
    if (busy) return;
    try {
      setRestoreList(await listBackups(token));
    } catch (err) {
      if (err.status === 401) setExpired(true);
      else setToast('Не удалось получить список копий');
    }
  };

  const doRestore = async (name) => {
    const wines = await db.wines.count();
    const tastings = await db.tastings.count();
    const dateText = name.replace('T', ' ').replace('-', ':');
    if (
      !window.confirm(
        `Заменит все текущие данные (${wines} ${pluralize(wines, 'вино', 'вина', 'вин')}, ${tastings} ${pluralize(tastings, 'дегустация', 'дегустации', 'дегустаций')}) данными копии от ${dateText}. Продолжить?`
      )
    )
      return;
    setRestoreList(null);
    setBusy({ phase: 'db' });
    try {
      const res = await restoreBackup(token, name, setBusy);
      setToast(res.failedPhotos ? `Восстановлено, но ${res.failedPhotos} фото не скачалось` : 'Восстановлено');
      setTimeout(() => window.location.reload(), 800);
    } catch (err) {
      if (err.status === 401) setExpired(true);
      else setToast('Восстановление не удалось');
      setBusy(null);
    }
  };

  const disconnect = () => {
    if (!window.confirm('Отключить Яндекс.Диск? Данные на Диске останутся.')) return;
    logout();
    setTokenBump((v) => v + 1);
  };

  return (
    <div className="px-4 py-5">
      <button
        onClick={() => navigate(-1)}
        className="mb-4 flex items-center gap-1 text-sm font-medium text-wine-600 dark:text-wine-400"
      >
        <ArrowLeft className="size-4" /> Назад
      </button>
      <h1 className="text-xl font-semibold">Бэкап</h1>

      {expired && (
        <p className="mt-3 rounded-lg bg-amber-100 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-200">
          Подключение к Диску истекло — подключи заново
        </p>
      )}

      {!token || expired ? (
        <div className="mt-4 rounded-xl bg-white p-4 dark:bg-stone-900">
          <p className="text-sm text-stone-600 dark:text-stone-300">
            Бэкап сохраняет все вина, дегустации и фото в папку приложения на твоём
            Яндекс.Диске. Данные не покидают твой Диск и обновляются автоматически раз в день.
          </p>
          <button
            onClick={authorize}
            className="mt-3 w-full rounded-lg bg-wine-600 py-2.5 text-sm font-medium text-white dark:bg-wine-400 dark:text-stone-950"
          >
            Подключить Яндекс.Диск
          </button>
        </div>
      ) : (
        <>
          <div className="mt-4 rounded-xl bg-white p-4 dark:bg-stone-900">
            {status?.at ? (
              <p className="text-sm">
                Последний бэкап: {fmtDateTime(status.at)}
                {status.counts && (
                  <span className="text-stone-500 dark:text-stone-400">
                    {' · '}
                    {status.counts.wines} {pluralize(status.counts.wines, 'вино', 'вина', 'вин')},{' '}
                    {status.counts.tastings}{' '}
                    {pluralize(status.counts.tastings, 'дегустация', 'дегустации', 'дегустаций')},{' '}
                    {status.counts.photos} фото
                  </span>
                )}
              </p>
            ) : (
              <p className="text-sm text-stone-500 dark:text-stone-400">Бэкапов ещё не было</p>
            )}
            {status?.status === 'partial' && (
              <p className="mt-1 text-[13px] text-amber-600 dark:text-amber-400">
                частично — {status.failedPhotos} фото не залилось, повторится при следующем бэкапе
              </p>
            )}
            {status?.status === 'error' && (
              <p className="mt-1 text-[13px] text-amber-600 dark:text-amber-400">
                последняя попытка не удалась ({status.error}) — повторится при следующем запуске
              </p>
            )}

            <button
              onClick={backupNow}
              disabled={!!busy}
              className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg bg-wine-600 py-2.5 text-sm font-medium text-white disabled:opacity-60 dark:bg-wine-400 dark:text-stone-950"
            >
              {busy ? (
                <>
                  <RefreshCw className="size-4 animate-spin" /> {progressText(busy)}
                </>
              ) : (
                <>
                  <CloudUpload className="size-4" /> Сделать бэкап сейчас
                </>
              )}
            </button>
            <button
              onClick={openRestore}
              disabled={!!busy}
              className="mt-2 w-full rounded-lg border border-stone-300 py-2.5 text-sm font-medium text-stone-700 disabled:opacity-60 dark:border-stone-600 dark:text-stone-300"
            >
              Восстановить из копии
            </button>
            <button
              onClick={disconnect}
              className="mt-2 w-full py-2 text-[13px] text-stone-400 dark:text-stone-500"
            >
              Отключить
            </button>
          </div>

          {restoreList && (
            <div className="mt-3 rounded-xl bg-white p-3 dark:bg-stone-900">
              <p className="mb-2 text-sm font-medium">Копии на Диске</p>
              {restoreList.length === 0 && (
                <p className="text-sm text-stone-400">Копий пока нет</p>
              )}
              {restoreList.map((b) => (
                <button
                  key={b.name}
                  onClick={() => doRestore(b.name)}
                  className="block w-full border-t border-stone-100 py-2.5 text-left text-sm first:border-0 dark:border-stone-800"
                >
                  {b.name.replace('T', ' · ').replace(/-(\d\d)$/, ':$1')}
                </button>
              ))}
            </div>
          )}
        </>
      )}

      <Toast message={toast} onDone={() => setToast(null)} />
    </div>
  );
}
