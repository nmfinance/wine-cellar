import { db } from '../db.js';

const now = () => new Date().toISOString();

export function listRacks() {
  return db.racks.orderBy('order').toArray();
}

export async function saveRack(rack) {
  const ts = now();
  if (rack.id) {
    await db.racks.update(rack.id, { ...rack, updatedAt: ts });
    return db.racks.get(rack.id);
  }
  const record = {
    id: crypto.randomUUID(),
    name: '',
    order: 0,
    shelves: [],
    ...rack,
    createdAt: ts,
    updatedAt: ts,
  };
  await db.racks.add(record);
  return record;
}

// Новый стеллаж: «Стеллаж N», 4 полки, без лимита
export async function addRack() {
  const racks = await db.racks.toArray();
  const order = racks.length ? Math.max(...racks.map((r) => r.order)) + 1 : 1;
  return saveRack({
    name: `Стеллаж ${racks.length + 1}`,
    order,
    shelves: Array.from({ length: 4 }, (_, i) => ({ n: i + 1, capacity: null })),
  });
}

export function renameRack(id, name) {
  return db.racks.update(id, { name, updatedAt: now() });
}

// Изменение числа полок; вина с убранных полок теряют место
export function setShelfCount(rackId, count) {
  return db.transaction('rw', [db.racks, db.wines], async () => {
    const rack = await db.racks.get(rackId);
    if (!rack) return;
    const capacity = rack.shelves[0]?.capacity ?? null;
    const shelves = Array.from(
      { length: count },
      (_, i) => rack.shelves[i] ?? { n: i + 1, capacity }
    );
    if (count < rack.shelves.length) {
      await db.wines
        .filter((w) => w.location?.rackId === rackId && w.location.shelf > count)
        .modify({ location: null, updatedAt: now() });
    }
    await db.racks.update(rackId, { shelves, updatedAt: now() });
  });
}

// Вместимость одна на стеллаж, пишется в каждую полку (схема per-shelf — на вырост)
export async function setRackCapacity(rackId, capacity) {
  const rack = await db.racks.get(rackId);
  if (!rack) return;
  await db.racks.update(rackId, {
    shelves: rack.shelves.map((s) => ({ ...s, capacity })),
    updatedAt: now(),
  });
}

// Удаление стеллажа; вина на нём остаются без места
export function deleteRack(rackId) {
  return db.transaction('rw', [db.racks, db.wines], async () => {
    await db.wines
      .filter((w) => w.location?.rackId === rackId)
      .modify({ location: null, updatedAt: now() });
    await db.racks.delete(rackId);
  });
}

// Занятость полок: { [shelf]: количество бутылок }
export async function shelfOccupancy(rackId) {
  const wines = await db.wines
    .where('status')
    .equals('cellar')
    .filter((w) => w.location?.rackId === rackId)
    .toArray();
  const occupancy = {};
  for (const w of wines) {
    const shelf = w.location.shelf;
    occupancy[shelf] = (occupancy[shelf] ?? 0) + (w.quantity ?? 0);
  }
  return occupancy;
}

// Всего бутылок на стеллаже (для подтверждений при удалении)
export async function bottlesOnRack(rackId) {
  const occ = await shelfOccupancy(rackId);
  return Object.values(occ).reduce((a, b) => a + b, 0);
}
