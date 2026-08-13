import { useEffect, useRef, useState } from 'react';

// Общий bottom sheet проекта: подложка, выезд снизу, свайп вниз.
export default function BottomSheet({ open, onClose, title, children }) {
  const [dragY, setDragY] = useState(0);
  const startY = useRef(null);

  useEffect(() => {
    if (!open) return;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  return (
    <div className={`fixed inset-0 z-50 ${open ? '' : 'pointer-events-none'}`} aria-hidden={!open}>
      <div
        onClick={onClose}
        className={`absolute inset-0 bg-black/40 transition-opacity duration-200 ${
          open ? 'opacity-100' : 'opacity-0'
        }`}
      />
      <div
        className={`absolute inset-x-0 bottom-0 mx-auto max-w-[480px] rounded-t-2xl bg-white pb-[env(safe-area-inset-bottom)] shadow-2xl transition-transform duration-200 dark:bg-stone-900 ${
          open ? 'translate-y-0' : 'translate-y-full'
        }`}
        style={open && dragY > 0 ? { transform: `translateY(${dragY}px)`, transition: 'none' } : undefined}
        onTouchStart={(e) => {
          startY.current = e.touches[0].clientY;
        }}
        onTouchMove={(e) => {
          if (startY.current == null) return;
          const delta = e.touches[0].clientY - startY.current;
          if (delta > 0) setDragY(delta);
        }}
        onTouchEnd={() => {
          if (dragY > 80) onClose();
          setDragY(0);
          startY.current = null;
        }}
      >
        <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-stone-300 dark:bg-stone-700" />
        {title && (
          <h2 className="px-4 pt-3 text-base font-semibold text-stone-900 dark:text-stone-100">
            {title}
          </h2>
        )}
        {children}
      </div>
    </div>
  );
}
