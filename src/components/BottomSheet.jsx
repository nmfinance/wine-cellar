import { useEffect, useRef } from 'react';
import { useSheetDrag } from '../utils/sheetDrag.js';

// Общий bottom sheet проекта: подложка, выезд снизу, свайп вниз.
// P22.1: жест — через useSheetDrag (нативные non-passive слушатели,
// уважение скролла контента); драг-зона (ручка+заголовок) дополнительно
// закрыта touch-action: none — двойной слой против pull-to-refresh.
export default function BottomSheet({ open, onClose, title, children }) {
  const sheetRef = useRef(null);
  const dragY = useSheetDrag(sheetRef, { onDown: onClose, enabled: open });

  useEffect(() => {
    if (!open) return undefined;
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
        ref={sheetRef}
        className={`absolute inset-x-0 bottom-0 mx-auto max-w-[480px] rounded-t-2xl bg-white pb-[env(safe-area-inset-bottom)] shadow-2xl transition-transform duration-200 dark:bg-stone-900 ${
          open ? 'translate-y-0' : 'translate-y-full'
        }`}
        style={
          open && dragY > 0 ? { transform: `translateY(${dragY}px)`, transition: 'none' } : undefined
        }
      >
        <div style={{ touchAction: 'none' }}>
          <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-stone-300 dark:bg-stone-700" />
          {title && (
            <h2 className="px-4 pt-3 text-base font-semibold text-stone-900 dark:text-stone-100">
              {title}
            </h2>
          )}
        </div>
        {children}
      </div>
    </div>
  );
}
