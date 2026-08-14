import { useEffect } from 'react';

// P21: заголовок вкладки по экрану — «Barolo — Мой погреб»
export function usePageTitle(title) {
  useEffect(() => {
    document.title = title ? `${title} — Мой погреб` : 'Мой погреб';
    return () => {
      document.title = 'Мой погреб';
    };
  }, [title]);
}
