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
