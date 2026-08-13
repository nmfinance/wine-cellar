import { useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowLeft } from 'lucide-react';
import { db } from '../db.js';

// Заглушка экрана дегустации — полный экран придёт с блоком дегустаций
export default function TastingScreen() {
  const { id } = useParams();
  const navigate = useNavigate();
  const tasting = useLiveQuery(() => db.tastings.get(id), [id]);

  return (
    <div className="px-4 py-5">
      <button
        onClick={() => navigate(-1)}
        className="mb-6 flex items-center gap-1 text-sm font-medium text-wine-600 dark:text-wine-400"
      >
        <ArrowLeft className="size-4" />
        Назад
      </button>
      <h1 className="text-xl font-semibold">Дегустация</h1>
      {tasting && (
        <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">
          Оценка {tasting.totalScore?.toFixed(1)}
        </p>
      )}
      <p className="mt-6 text-sm text-stone-400 dark:text-stone-500">
        Полный экран дегустации — в разработке.
      </p>
    </div>
  );
}
