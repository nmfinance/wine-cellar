import { Plus } from 'lucide-react';

// Плавающая кнопка добавления; right учитывает центрированную колонку 480px
export default function Fab({ onClick }) {
  return (
    <button
      onClick={onClick}
      aria-label="Добавить вино"
      className="fixed z-40 grid size-[52px] place-items-center rounded-full bg-wine-600 text-white shadow-lg transition-transform active:scale-95"
      style={{
        right: 'max(1rem, calc(50vw - 240px + 1rem))',
        bottom: 'calc(1rem + env(safe-area-inset-bottom))',
      }}
    >
      <Plus className="size-6" />
    </button>
  );
}
