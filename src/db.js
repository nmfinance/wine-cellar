import Dexie from 'dexie';

// Контракт данных проекта. Документный стиль: вложенные объекты хранятся
// прямо в записях, индексируется только то, по чему реально фильтруем.
// Полные формы записей — см. src/data/*.js и P2-спецификацию.
export const db = new Dexie('pogreb');

db.version(1).stores({
  wines: 'id, status, color, country, wineryName, updatedAt',
  photos: 'id, wineId, tastingId',
  tastings: 'id, wineId, date',
  wineries: 'id, nameNormalized',
  racks: 'id, order',
  restaurantScans: 'id, date',
  aiCache: 'id, kind, expiresAt',
  meta: 'key',
});
