import { useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowLeft } from 'lucide-react';
import { db } from '../db.js';

// Заглушка карточки вина — полный экран придёт отдельной задачей
export default function WineScreen() {
  const { id } = useParams();
  const navigate = useNavigate();
  const wine = useLiveQuery(() => db.wines.get(id), [id]);

  return (
    <div className="px-4 py-5">
      <button
        onClick={() => navigate(-1)}
        className="mb-6 flex items-center gap-1 text-sm font-medium text-wine-600 dark:text-wine-400"
      >
        <ArrowLeft className="size-4" />
        Назад
      </button>
      <h1 className="text-xl font-semibold">{wine ? wine.name : '…'}</h1>
      {wine && (
        <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">{wine.wineryName}</p>
      )}
      <p className="mt-6 text-sm text-stone-400 dark:text-stone-500">
        Полная карточка вина — в разработке.
      </p>
    </div>
  );
}
