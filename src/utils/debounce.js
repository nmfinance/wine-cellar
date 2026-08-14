import { useEffect, useState } from 'react';

// P21: отложенное значение для поиска — ввод не дёргает запросы к базе
// на каждый символ (150 мс достаточно, чтобы не мешать быстрой печати)
export function useDebounced(value, ms = 150) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}
