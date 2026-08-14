# Мой погреб 🍷

Личный винный погреб: PWA для одного владельца — каталог вин с местами на полках,
скан этикеток с AI-распознаванием, дегустационные заметки с обучающими вопросами
сомелье, анализ ресторанных винных карт с персональными рекомендациями,
карта виноделен и бэкап на Яндекс.Диск. Все данные живут локально в браузере
(IndexedDB), облако — только для AI и бэкапа.

Продакшен: https://nmfinance.github.io/wine-cellar/

## Архитектура

```
┌─────────────────────────────────────────────┐
│  PWA (GitHub Pages, HashRouter)             │
│  React 18 + Vite + Tailwind v4              │
│  Dexie (IndexedDB `pogreb`, 8 таблиц)       │
│  vite-plugin-pwa (offline, prompt-update)   │
└───────┬──────────────┬──────────────┬───────┘
        │              │              │
        ▼              ▼              ▼
┌───────────────┐ ┌──────────────────┐ ┌──────────────────┐
│ Cloudflare    │ │ Яндекс Облако    │ │ Яндекс.Диск      │
│ Worker /ai    │ │ Function+Gateway │ │ (папка прилож.)  │
│ → Gemini      │ │ /vivino — парсер │ │ бэкапы db.json   │
│ (цепочка      │ │ SSR-пропсов      │ │ + фото,          │
│ моделей, KV   │ │ поиска Vivino    │ │ ротация 5 копий  │
│ стоп-кран)    │ │                  │ │ implicit OAuth   │
└───────────────┘ └──────────────────┘ └──────────────────┘

Прочее напрямую с клиента: Nominatim (геокодинг виноделен, e-mail в params),
cbr-xml-daily.ru (курсы валют для наценки), OpenFreeMap (тайлы MapLibre).
```

AI-сценарии (S1 скан этикетки, S2 справка винодельни, S3 вопросы дегустации,
S4 мнение об оценке, S5 винная карта, S6 «глубже о вине») описаны в
[prompts.md](prompts.md) — это источник истины, код в `src/ai/prompts.js`
синхронизируется с ним вручную. Экономика запросов — [docs/usage.md](docs/usage.md).

## Как деплоить

**Приложение** — GitHub Pages, автоматически: пуш в `main` запускает
`.github/workflows/deploy.yml` (build → Pages). База пути `/wine-cellar/`
зашита в `vite.config.js` и манифесте.

**Воркер AI** (`worker/`) — Cloudflare:

```bash
cd worker && npx wrangler deploy
```

Секреты: `GEMINI_API_KEY`, `APP_KEY` — через `npx wrangler secret bulk secrets.json`
(не по одному: PowerShell 5.1 добавляет \r через pipe). Модельная цепочка,
дневной стоп-кран (`DAILY_HARD_CAP`) и CORS-allowlist — в `worker/wrangler.toml`
и `worker/src/index.js`. Текущий расход: `GET /health` → `usedToday`.

**Vivino-прокси** (`proxy/`) — Яндекс Облако, функция + API Gateway:

```powershell
cd proxy; .\deploy.ps1
```

Шлюз нужен, потому что функция не принимает суффиксы пути; маршруты — в
`openapi.template.yaml`.

## Где живут ключи

| Ключ | Где | Секретность |
|------|-----|-------------|
| `GEMINI_API_KEY` | секрет Cloudflare Worker | секрет |
| `APP_KEY` (клиент → воркер) | секрет воркера + `src/api/config.js` | несекретный по дизайну (отсекает чужой трафик, не защита) |
| ClientID Яндекс OAuth | `src/api/config.js` | публичный (implicit flow) |
| e-mail для Nominatim | `src/api/config.js` | публичный (требование сервиса) |

Токен Яндекс.Диска хранится только в localStorage владельца.

## Документация

- [prompts.md](prompts.md) — AI-промпты, версии, открытые вопросы
- [docs/usage.md](docs/usage.md) — экономика AI-запросов
- [docs/states.md](docs/states.md) — аудит состояний P21 (регрессионная карта)
- [docs/acceptance.md](docs/acceptance.md) — приёмочный чек-лист владельца
- `experiments/` — прототипы P0/P0.5 и юнит-тест профиля вкуса
  (`node experiments/profile-test.js`)

## Локальная разработка

```bash
npm install
npm run dev
```

Dev-сиды заливаются автоматически в пустую базу (только в DEV). Отладка:
`window.__db`, `window.__data`, `?debug=1` — панель eruda,
`window.__crashTest = true` — проверка ErrorBoundary.

Сделано с Claude.
