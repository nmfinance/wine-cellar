import { Component } from 'react';

// P21: глобальный предохранитель — краш любого экрана показывает карточку
// вместо белого экрана. База не трогается, «Перезагрузить» лечит.
export default class ErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('[boundary]', error, info?.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex min-h-dvh items-center justify-center bg-stone-50 px-6 dark:bg-stone-950">
        <div className="w-full max-w-sm rounded-xl bg-white p-5 text-center dark:bg-stone-900">
          <p className="text-3xl">🥂</p>
          <p className="mt-2 text-base font-medium text-stone-900 dark:text-stone-100">
            Что-то сломалось
          </p>
          <p className="mt-1 text-[13px] text-stone-500 dark:text-stone-400">
            Данные целы — это только экран. Перезагрузка обычно помогает.
          </p>
          <button
            onClick={() => location.reload()}
            className="mt-4 w-full rounded-lg bg-wine-600 py-2.5 text-sm font-medium text-white dark:bg-wine-400 dark:text-stone-950"
          >
            Перезагрузить
          </button>
          <details className="mt-3 text-left">
            <summary className="cursor-pointer text-[12px] text-stone-400 dark:text-stone-500">
              Детали ошибки
            </summary>
            <pre className="mt-1 max-h-40 overflow-auto rounded-lg bg-stone-100 p-2 text-[11px] whitespace-pre-wrap text-stone-600 dark:bg-stone-800 dark:text-stone-300">
              {String(this.state.error?.stack ?? this.state.error)}
            </pre>
          </details>
        </div>
      </div>
    );
  }
}
