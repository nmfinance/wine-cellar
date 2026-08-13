import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import CellarStructureEditor from '../components/CellarStructureEditor.jsx';

export default function CellarSettingsScreen() {
  const navigate = useNavigate();
  return (
    <div className="pb-8">
      <header className="sticky top-0 z-10 bg-stone-50/95 px-2 py-2 backdrop-blur dark:bg-stone-950/95">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-1 rounded-lg px-2 py-2 text-sm font-medium text-wine-600 dark:text-wine-400"
        >
          <ArrowLeft className="size-4" /> Назад
        </button>
      </header>
      <CellarStructureEditor />
    </div>
  );
}
