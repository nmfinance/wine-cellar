// Адреса серверной части и ключ приложения.
// APP_KEY не секрет: он виден в бандле по замыслу — его роль лишь отсечение
// случайных сканеров от квот AI. Настоящие секреты (ключи Gemini/GigaChat)
// живут на серверах и сюда не попадают.
export const AI_URL = 'https://pogreb-ai.pogreb-ai.workers.dev';
export const VIVINO_URL = 'https://d5dlupicqp46hpphst15.y5sm01em.apigw.yandexcloud.net';
export const APP_KEY = 'c2fecae3-61f9-4627-b2b7-2643fe9d5ca5';
// OAuth ClientID Яндекс.Диска (implicit flow, не секрет)
export const YA_CLIENT_ID = '091bf1c61eae4e5b8c5c07e365e9d8fb';
// Идентификация для Nominatim (политика OSM для браузерных приложений)
export const NOMINATIM_EMAIL = 'nikmv1159@gmail.com';
