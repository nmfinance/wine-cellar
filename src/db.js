import Dexie from 'dexie';

// Заглушка базы: реальная схема (вина, дегустации, wishlist) появится
// в следующей задаче отдельной версией. Таблица meta — служебная.
export const db = new Dexie('pogreb');

db.version(1).stores({
  meta: 'key',
});
