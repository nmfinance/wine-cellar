import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App.jsx';
import { db } from './db.js';
import { seedIfEmpty } from './data/seed.js';
import { maybeAutoBackup } from './data/backup.js';
import { backfillGeocode } from './data/wineries.js';
import { initTheme } from './data/settings.js';
import './index.css';

// ?debug=1 → мобильная панель DevTools (eruda) отдельным чанком, по требованию
if (new URLSearchParams(window.location.search).has('debug')) {
  import('eruda').then((eruda) => eruda.default.init());
}

// prompt-контур обновления: SW готов → событие для тоста «Доступна новая
// версия»; тап по «Обновить» вызывает skipWaiting + reload (см. UpdateToast)
const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    window.dispatchEvent(new CustomEvent('sw-need-refresh'));
  },
});
window.__applySWUpdate = () => updateSW(true);

db.open()
  .then(async () => {
    console.debug(`[db] pogreb открыта, версия схемы ${db.verno}`);
    // тема из meta (или системная) — до первого рендера контента
    initTheme();
    // автобэкап на Яндекс.Диск (тихий, раз в сутки, только с токеном и онлайн)
    setTimeout(() => maybeAutoBackup(), 3000);
    // доборка геокодинга (отложенные офлайном + самолечение старых записей)
    setTimeout(() => backfillGeocode().catch(() => {}), 5000);
    if (import.meta.env.DEV) {
      await seedIfEmpty();
      // консольный доступ для отладки: window.__db, window.__data
      window.__db = db;
      window.__data = {
        ...(await import('./data/wines.js')),
        ...(await import('./data/tastings.js')),
        ...(await import('./data/cellar.js')),
      };
    }
  })
  .catch((err) => console.error('[db] не открылась:', err));

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
);
