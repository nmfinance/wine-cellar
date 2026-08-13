import { HashRouter, Route, Routes } from 'react-router-dom';
import CellarScreen from './screens/CellarScreen.jsx';
import StubScreen from './screens/StubScreen.jsx';
import TastingScreen from './screens/TastingScreen.jsx';
import WineScreen from './screens/WineScreen.jsx';

export default function App() {
  return (
    <HashRouter>
      <div className="min-h-dvh bg-stone-50 text-stone-900 dark:bg-stone-950 dark:text-stone-100">
        <div className="mx-auto min-h-dvh max-w-[480px]">
          <Routes>
            <Route path="/" element={<CellarScreen tab="cellar" />} />
            <Route path="/wishlist" element={<CellarScreen tab="wishlist" />} />
            <Route path="/history" element={<CellarScreen tab="history" />} />
            <Route path="/wine/:id" element={<WineScreen />} />
            <Route path="/tasting/:id" element={<TastingScreen />} />
            <Route path="/stats" element={<StubScreen title="Статистика" />} />
            <Route path="/map" element={<StubScreen title="Карта" />} />
            <Route path="/settings" element={<StubScreen title="Настройки" />} />
          </Routes>
        </div>
      </div>
    </HashRouter>
  );
}
