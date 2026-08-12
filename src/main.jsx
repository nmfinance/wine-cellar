import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App.jsx';
import { db } from './db.js';
import './index.css';

// ?debug=1 → мобильная панель DevTools (eruda) отдельным чанком, по требованию
if (new URLSearchParams(window.location.search).has('debug')) {
  import('eruda').then((eruda) => eruda.default.init());
}

registerSW({ immediate: true });

db.open()
  .then(() => console.debug(`[db] pogreb открыта, версия схемы ${db.verno}`))
  .catch((err) => console.error('[db] не открылась:', err));

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
);
