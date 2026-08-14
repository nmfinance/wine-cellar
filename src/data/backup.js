import { db } from '../db.js';
import * as yd from '../api/yadisk.js';

// Бэкап в папку приложения Яндекс.Диска:
//   app:/backups/{timestamp}/db.json — вся база БЕЗ blob'ов
//   app:/photos/{photoId}.jpg        — блобы, общая папка, append-only
//   app:/photos-index.json           — список залитых photoId (дедуп)
const TABLES = ['wines', 'photos', 'tastings', 'wineries', 'racks', 'restaurantScans', 'aiCache', 'meta'];
const KEEP_BACKUPS = 5;

const now = () => new Date().toISOString();

async function readStatus() {
  return (await db.meta.get('backupStatus'))?.value ?? null;
}

async function writeStatus(value) {
  await db.meta.put({ key: 'backupStatus', value });
}

export async function runBackup(token, onProgress = null) {
  // 1. дамп базы без блобов
  const dump = {};
  for (const name of TABLES) {
    const rows = await db.table(name).toArray();
    dump[name] =
      name === 'photos' ? rows.map(({ blob, ...meta }) => meta) : rows;
  }
  const counts = {
    wines: dump.wines.length,
    tastings: dump.tastings.length,
    photos: dump.photos.length,
  };

  const ts = now().slice(0, 16).replace(':', '-'); // 2026-08-14T20-15
  onProgress?.({ phase: 'db' });
  await yd.mkdir(token, 'app:/backups').catch(() => {});
  await yd.mkdir(token, `app:/backups/${ts}`).catch(() => {});
  await yd.uploadFile(
    token,
    `app:/backups/${ts}/db.json`,
    new Blob([JSON.stringify(dump)], { type: 'application/json' })
  );

  // 2. фото, которых ещё нет в индексе
  await yd.mkdir(token, 'app:/photos').catch(() => {});
  let indexed = [];
  try {
    indexed = await (await yd.downloadFile(token, 'app:/photos-index.json')).json();
  } catch {
    // индекса ещё нет — первая заливка
  }
  const indexSet = new Set(Array.isArray(indexed) ? indexed : []);
  const photos = await db.photos.toArray();
  const toUpload = photos.filter((p) => p.blob && !indexSet.has(p.id));
  let failedPhotos = 0;
  let done = 0;
  for (const p of toUpload) {
    try {
      await yd.uploadFile(token, `app:/photos/${p.id}.jpg`, p.blob);
      indexSet.add(p.id);
    } catch (err) {
      if (err.status === 401) throw err;
      failedPhotos++;
      console.warn('[backup] фото не залилось:', p.id, err.message);
    }
    done++;
    onProgress?.({ phase: 'photos', done, total: toUpload.length });
  }
  if (toUpload.length) {
    await yd.uploadFile(
      token,
      'app:/photos-index.json',
      new Blob([JSON.stringify([...indexSet])], { type: 'application/json' })
    );
  }
  console.debug(`[backup] фото: залито ${toUpload.length - failedPhotos}, пропущено по индексу ${photos.length - toUpload.length}`);

  // 3. ротация: старые папки сверх KEEP_BACKUPS
  const dirs = (await yd.listDir(token, 'app:/backups'))
    .filter((i) => i.type === 'dir')
    .map((i) => i.name)
    .sort();
  for (const name of dirs.slice(0, Math.max(0, dirs.length - KEEP_BACKUPS))) {
    await yd.deleteResource(token, `app:/backups/${name}`).catch(() => {});
  }

  const status = {
    at: now(),
    counts,
    failedPhotos,
    status: failedPhotos > 0 ? 'partial' : 'ok',
  };
  await writeStatus(status);
  return status;
}

export async function listBackups(token) {
  const items = await yd.listDir(token, 'app:/backups');
  return items
    .filter((i) => i.type === 'dir')
    .map((i) => ({ name: i.name, modified: i.modified }))
    .sort((a, b) => b.name.localeCompare(a.name));
}

export async function restoreBackup(token, name, onProgress = null) {
  onProgress?.({ phase: 'db' });
  const dump = await (
    await yd.downloadFile(token, `app:/backups/${name}/db.json`)
  ).json();

  await db.transaction('rw', db.tables, async () => {
    for (const t of TABLES) await db.table(t).clear();
    for (const t of TABLES) {
      if (Array.isArray(dump[t]) && dump[t].length) await db.table(t).bulkAdd(dump[t]);
    }
  });

  // докачка блобов фото по id
  const metas = dump.photos ?? [];
  let failed = 0;
  let done = 0;
  for (const m of metas) {
    try {
      const file = await yd.downloadFile(token, `app:/photos/${m.id}.jpg`);
      const blob = await file.blob();
      await db.photos.update(m.id, { blob });
    } catch (err) {
      failed++;
      console.warn('[backup] фото не скачалось:', m.id, err.message);
    }
    done++;
    onProgress?.({ phase: 'photos', done, total: metas.length });
  }
  return { failedPhotos: failed };
}

// Автобэкап при запуске: токен есть, онлайн, последний успешный > 24 ч назад
export async function maybeAutoBackup() {
  const token = yd.getToken();
  if (!token || navigator.onLine === false) return;
  const st = await readStatus();
  const fresh =
    st?.at && st.status !== 'error' && Date.now() - new Date(st.at).getTime() < 24 * 3600_000;
  if (fresh) return;
  try {
    console.debug('[backup] автобэкап…');
    await runBackup(token);
    console.debug('[backup] автобэкап готов');
  } catch (err) {
    console.warn('[backup] автобэкап не удался:', err.message);
    await writeStatus({
      ...(st ?? {}),
      status: 'error',
      error: err.status === 401 ? 'unauthorized' : String(err.message),
      errorAt: now(),
    });
  }
}
