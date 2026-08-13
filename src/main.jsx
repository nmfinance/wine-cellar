import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App.jsx';
import { db } from './db.js';
import { seedIfEmpty } from './data/seed.js';
import './index.css';

// ?debug=1 → мобильная панель DevTools (eruda) отдельным чанком, по требованию
if (new URLSearchParams(window.location.search).has('debug')) {
  import('eruda').then((eruda) => eruda.default.init());
}

registerSW({ immediate: true });

db.open()
  .then(async () => {
    console.debug(`[db] pogreb открыта, версия схемы ${db.verno}`);
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
