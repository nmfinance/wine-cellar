import { useEffect, useRef, useState } from 'react';

// P22.1: жест шторки. Нативные слушатели с passive:false — preventDefault
// в React-обработчиках touchmove игнорируется (частая ловушка), и жест
// проваливался в pull-to-refresh Chrome. Механика нативных шторок:
// драг вниз начинается только когда скроллируемый контент прокручен
// к верху (scrollTop === 0), иначе жест отдаётся скроллу.
// Закрытие: порог ~30% высоты ИЛИ скорость флика; доводка — CSS-transition.
export function useSheetDrag(sheetRef, { onDown, onUp = null, enabled = true }) {
  const [dragY, setDragY] = useState(0);
  const drag = useRef(null);

  useEffect(() => {
    if (!enabled) return undefined;
    const el = sheetRef.current;
    if (!el) return undefined;

    const findScrollable = (node) => {
      let n = node;
      while (n && n !== el) {
        if (
          n.scrollHeight > n.clientHeight + 1 &&
          /(auto|scroll)/.test(getComputedStyle(n).overflowY)
        ) {
          return n;
        }
        n = n.parentElement;
      }
      return null;
    };

    const onStart = (e) => {
      drag.current = {
        startY: e.touches[0].clientY,
        lastY: e.touches[0].clientY,
        lastT: performance.now(),
        vel: 0,
        dir: null, // 'down' | 'up'
        scrollEl: findScrollable(e.target),
      };
    };

    const onMove = (e) => {
      const d = drag.current;
      if (!d) return;
      const y = e.touches[0].clientY;
      const delta = y - d.startY;
      if (!d.dir) {
        // контент не у верха → жест принадлежит скроллу, не шторке
        if (d.scrollEl && d.scrollEl.scrollTop > 0) {
          drag.current = null;
          return;
        }
        if (delta > 6) d.dir = 'down';
        else if (delta < -6) {
          if (onUp) d.dir = 'up';
          else if (d.scrollEl) {
            drag.current = null; // вверх без onUp — это скролл контента
            return;
          } else d.dir = 'up';
        } else return;
      }
      e.preventDefault(); // работает только при passive:false
      const now = performance.now();
      d.vel = (y - d.lastY) / Math.max(1, now - d.lastT);
      d.lastY = y;
      d.lastT = now;
      if (d.dir === 'down') setDragY(Math.max(0, delta));
    };

    const onEnd = () => {
      const d = drag.current;
      drag.current = null;
      if (!d?.dir) {
        setDragY(0);
        return;
      }
      const h = el.getBoundingClientRect().height || 1;
      if (d.dir === 'down') {
        setDragY((cur) => {
          if (cur > h * 0.3 || d.vel > 0.5) onDown();
          return 0; // transition класса доводит без рывка
        });
      } else if (d.dir === 'up' && onUp) {
        const rise = d.startY - d.lastY;
        if (rise > 50 || d.vel < -0.5) onUp();
        setDragY(0);
      }
    };

    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd);
    el.addEventListener('touchcancel', onEnd);
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onEnd);
    };
  }, [enabled, onDown, onUp, sheetRef]);

  return dragY;
}
