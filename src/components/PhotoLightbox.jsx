import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';

// Полноэкранный просмотр фото: свайп между кадрами (scroll-snap),
// двойной тап — зум 2x/сброс, pinch-зум трансформом, закрытие — крестик,
// свайп вниз или системный «назад» (перехват popstate).
export default function PhotoLightbox({ urls, start = 0, onClose }) {
  const scrollRef = useRef(null);
  const closedRef = useRef(false);
  const pinchRef = useRef(null);
  const swipeRef = useRef(null);
  const lastTapRef = useRef(0);
  const [zoom, setZoom] = useState(1);
  const [active, setActive] = useState(start);

  // «назад» закрывает лайтбокс, не карточку.
  // Guard от StrictMode: двойной прогон эффекта не должен пушить два entry.
  useEffect(() => {
    if (!window.history.state?.lightbox) window.history.pushState({ lightbox: true }, '');
    const onPop = () => {
      if (!closedRef.current) {
        closedRef.current = true;
        onClose();
      }
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [onClose]);

  const close = () => {
    if (closedRef.current) return;
    closedRef.current = true;
    window.history.back(); // съедаем свой pushState
    onClose();
  };

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollLeft = start * el.clientWidth;
  }, [start]);

  const dist = (t) =>
    Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);

  const onTouchStart = (e) => {
    if (e.touches.length === 2) {
      pinchRef.current = { d: dist(e.touches), zoom };
      return;
    }
    swipeRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    const ts = Date.now();
    if (ts - lastTapRef.current < 300) {
      setZoom((z) => (z > 1 ? 1 : 2)); // двойной тап
      lastTapRef.current = 0;
    } else {
      lastTapRef.current = ts;
    }
  };

  const onTouchMove = (e) => {
    if (e.touches.length === 2 && pinchRef.current) {
      const scale = (dist(e.touches) / pinchRef.current.d) * pinchRef.current.zoom;
      setZoom(Math.min(4, Math.max(1, scale)));
    }
  };

  const onTouchEnd = (e) => {
    if (pinchRef.current && e.touches.length < 2) {
      pinchRef.current = null;
      return;
    }
    if (swipeRef.current && zoom === 1 && e.changedTouches.length === 1) {
      const dy = e.changedTouches[0].clientY - swipeRef.current.y;
      const dx = Math.abs(e.changedTouches[0].clientX - swipeRef.current.x);
      if (dy > 100 && dx < 60) close(); // свайп вниз
    }
    swipeRef.current = null;
  };

  return (
    <div
      className="fixed inset-0 z-[70] bg-black"
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      <button
        onClick={close}
        aria-label="Закрыть"
        className="absolute top-[calc(0.75rem+env(safe-area-inset-top))] right-3 z-10 grid size-10 place-items-center rounded-full bg-white/15 text-white"
      >
        <X className="size-5" />
      </button>

      <div
        ref={scrollRef}
        onScroll={() => {
          const el = scrollRef.current;
          if (el) setActive(Math.round(el.scrollLeft / el.clientWidth));
        }}
        className={`flex h-full snap-x snap-mandatory [scrollbar-width:none] ${
          zoom > 1 ? 'overflow-hidden' : 'overflow-x-auto'
        }`}
      >
        {urls.map((u, i) => (
          <div
            key={i}
            className="flex h-full w-full flex-none snap-center items-center justify-center overflow-hidden"
          >
            <img
              src={u}
              alt=""
              draggable={false}
              className="max-h-full max-w-full transition-transform duration-150"
              style={{ transform: `scale(${zoom})` }}
            />
          </div>
        ))}
      </div>

      {urls.length > 1 && (
        <div className="absolute bottom-[calc(1rem+env(safe-area-inset-bottom))] left-1/2 flex -translate-x-1/2 gap-1.5">
          {urls.map((_, i) => (
            <span
              key={i}
              className={`size-1.5 rounded-full ${i === active ? 'bg-white' : 'bg-white/40'}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
