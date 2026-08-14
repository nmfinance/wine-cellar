import { useEffect, useRef, useState } from 'react';
import { Mic } from 'lucide-react';

// Textarea с голосовым вводом (Web Speech API, ru-RU, interim-результаты).
// Финальный текст ДОПИСЫВАЕТСЯ к содержимому. Нет API — кнопка не рендерится.
export default function VoiceInput({ value, onChange, placeholder, rows = 3, onToast = null }) {
  const getSR = () => window.SpeechRecognition ?? window.webkitSpeechRecognition;
  const [supported] = useState(() => !!getSR());
  const [recording, setRecording] = useState(false);
  const [interim, setInterim] = useState('');
  const recRef = useRef(null);
  const valueRef = useRef(value);
  const silenceRef = useRef(null);

  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  useEffect(
    () => () => {
      recRef.current?.abort?.();
      clearTimeout(silenceRef.current);
    },
    []
  );

  // 3 секунды тишины (нет новых результатов) → стоп
  const armSilence = () => {
    clearTimeout(silenceRef.current);
    silenceRef.current = setTimeout(() => recRef.current?.stop(), 3000);
  };

  const start = () => {
    const SR = getSR();
    if (!SR) return;
    const rec = new SR();
    rec.lang = 'ru-RU';
    rec.interimResults = true;
    rec.continuous = true;
    rec.onresult = (e) => {
      let interimText = '';
      let finalText = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalText += t;
        else interimText += t;
      }
      if (finalText.trim()) {
        const base = valueRef.current?.trimEnd();
        onChange(base ? `${base} ${finalText.trim()}` : finalText.trim());
      }
      setInterim(interimText);
      armSilence();
    };
    rec.onerror = (e) => {
      if (e.error === 'network') onToast?.('Распознавание речи требует интернета');
      // no-speech / aborted — тихо останавливаемся (onend приберётся)
    };
    rec.onend = () => {
      setRecording(false);
      setInterim('');
      clearTimeout(silenceRef.current);
    };
    recRef.current = rec;
    rec.start();
    setRecording(true);
    armSilence();
  };

  const toggle = () => (recording ? recRef.current?.stop() : start());

  return (
    <div className="relative">
      <textarea
        rows={rows}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm outline-none focus:border-wine-400 dark:border-stone-700 dark:bg-stone-800 ${supported ? 'pr-11' : ''}`}
      />
      {interim && (
        <p className="px-1 pb-1 text-[12px] text-stone-400 italic dark:text-stone-500">
          {interim}…
        </p>
      )}
      {supported && (
        <button
          type="button"
          onClick={toggle}
          aria-label={recording ? 'Остановить запись' : 'Голосовой ввод'}
          className={`absolute top-2 right-2 grid size-8 place-items-center rounded-full transition-colors ${
            recording
              ? 'animate-pulse bg-red-500 text-white'
              : 'bg-stone-100 text-stone-500 dark:bg-stone-700 dark:text-stone-300'
          }`}
        >
          <Mic className="size-4" />
        </button>
      )}
    </div>
  );
}
