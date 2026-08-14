import { useEffect, useState } from 'react';

// P21: плашка «Доступна новая версия» — появляется по onNeedRefresh
// service worker'а (registerType: 'prompt'), тап = skipWaiting + reload.
export default function UpdateToast() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const on = () => setShow(true);
    window.addEventListener('sw-need-refresh', on);
    return () => window.removeEventListener('sw-need-refresh', on);
  }, []);

  if (!show) return null;
  return (
    <div
      className="fixed left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-xl bg-stone-900 py-2.5 pr-2.5 pl-4 text-sm text-white shadow-lg dark:bg-stone-100 dark:text-stone-900"
      style={{ bottom: 'calc(1.25rem + env(safe-area-inset-bottom))' }}
    >
      <span className="whitespace-nowrap">Доступна новая версия</span>
      <button
        onClick={() => window.__applySWUpdate?.()}
        className="rounded-lg bg-wine-400 px-3 py-1.5 font-medium whitespace-nowrap text-stone-950 dark:bg-wine-600 dark:text-white"
      >
        Обновить
      </button>
    </div>
  );
}
