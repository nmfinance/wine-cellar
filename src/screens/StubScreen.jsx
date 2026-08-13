import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

export default function StubScreen({ title }) {
  const navigate = useNavigate();
  return (
    <div className="px-4 py-5">
      <button
        onClick={() => navigate(-1)}
        className="mb-6 flex items-center gap-1 text-sm font-medium text-wine-600 dark:text-wine-400"
      >
        <ArrowLeft className="size-4" />
        Назад
      </button>
      <h1 className="text-xl font-semibold">{title}</h1>
      <p className="mt-6 text-sm text-stone-400 dark:text-stone-500">Раздел в разработке.</p>
    </div>
  );
}
