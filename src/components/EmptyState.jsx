// Пустое состояние списка: иконка + текст по центру
export default function EmptyState({ icon: Icon, children }) {
  return (
    <div className="flex flex-col items-center gap-3 px-8 py-16 text-center">
      {Icon && <Icon className="size-10 text-stone-300 dark:text-stone-600" strokeWidth={1.5} />}
      <p className="text-sm text-stone-500 dark:text-stone-400">{children}</p>
    </div>
  );
}
