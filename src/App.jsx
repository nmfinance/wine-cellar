import { lazy, Suspense } from 'react';
import { HashRouter, Route, Routes } from 'react-router-dom';
import CellarScreen from './screens/CellarScreen.jsx';

// MapLibre тяжёлый — чанк карты грузится только на /map
const MapScreen = lazy(() => import('./screens/MapScreen.jsx'));
import CellarSettingsScreen from './screens/CellarSettingsScreen.jsx';
import BackupScreen from './screens/BackupScreen.jsx';
import ScanScreen from './screens/ScanScreen.jsx';
import SettingsScreen from './screens/SettingsScreen.jsx';
import StubScreen from './screens/StubScreen.jsx';
import TastingScreen from './screens/TastingScreen.jsx';
import TastingFormScreen from './screens/TastingFormScreen.jsx';
import WineFormScreen from './screens/WineFormScreen.jsx';
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
            <Route path="/add" element={<WineFormScreen mode="create" />} />
            <Route path="/scan" element={<ScanScreen />} />
            <Route path="/wine/:id" element={<WineScreen />} />
            <Route path="/wine/:id/edit" element={<WineFormScreen mode="edit" />} />
            <Route path="/wine/:id/taste" element={<TastingFormScreen />} />
            <Route path="/tasting/:id" element={<TastingScreen />} />
            <Route path="/stats" element={<StubScreen title="Статистика" />} />
            <Route
              path="/map"
              element={
                <Suspense fallback={null}>
                  <MapScreen />
                </Suspense>
              }
            />
            <Route path="/settings" element={<SettingsScreen />} />
            <Route path="/settings/cellar" element={<CellarSettingsScreen />} />
            <Route path="/settings/backup" element={<BackupScreen />} />
          </Routes>
        </div>
      </div>
    </HashRouter>
  );
}
