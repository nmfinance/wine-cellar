import { db } from '../db.js';

// Словари ароматов по типу вина (S: нос и вкусовые ноты опросника).
export const AROMA_SETS = {
  red: [
    'вишня', 'слива', 'чёрная смородина', 'ежевика', 'малина', 'роза', 'фиалка',
    'дёготь', 'кожа', 'табак', 'специи', 'чёрный перец', 'дуб', 'ваниль',
    'шоколад', 'земля', 'грибы',
  ],
  white: [
    'лимон', 'цитрус', 'яблоко', 'груша', 'персик', 'абрикос', 'ананас', 'личи',
    'мёд', 'белые цветы', 'минералы', 'травы', 'сливочное масло', 'ваниль',
    'петроль', 'орехи',
  ],
  rose: [
    'клубника', 'малина', 'вишня', 'арбуз', 'персик', 'цитрус', 'цветы',
    'гренадин', 'красная смородина', 'травы', 'минералы', 'специи',
  ],
  orange: [
    'курага', 'цедра', 'мёд', 'орехи', 'чай', 'специи', 'сухофрукты', 'травы',
    'мандарин', 'воск', 'печёное яблоко', 'минералы',
  ],
};

const metaKey = (color) => `customAromas:${color}`;

// «Свои» ароматы пользователя — копятся в meta по типу вина
export async function getCustomAromas(color) {
  const row = await db.meta.get(metaKey(color));
  return Array.isArray(row?.value) ? row.value : [];
}

export async function addCustomAromas(color, names) {
  if (!names.length) return;
  const existing = await getCustomAromas(color);
  const merged = [...new Set([...existing, ...names])];
  await db.meta.put({ key: metaKey(color), value: merged });
}
