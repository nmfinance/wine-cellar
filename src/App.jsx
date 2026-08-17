import { lazy, Suspense } from 'react';
import { HashRouter, Route, Routes } from 'react-router-dom';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import UpdateToast from './components/UpdateToast.jsx';
import CellarScreen from './screens/CellarScreen.jsx';

// MapLibre тяжёлый — чанки карты и её диагностики грузятся лениво
const MapScreen = lazy(() => import('./screens/MapScreen.jsx'));
const MapCheckScreen = lazy(() => import('./screens/MapCheckScreen.jsx'));
const MapMatrixScreen = lazy(() => import('./screens/MapMatrixScreen.jsx'));
import CellarSettingsScreen from './screens/CellarSettingsScreen.jsx';
import BackupScreen from './screens/BackupScreen.jsx';
import ScanScreen from './screens/ScanScreen.jsx';
import SettingsScreen from './screens/SettingsScreen.jsx';
import StatsScreen from './screens/StatsScreen.jsx';
import TastingScreen from './screens/TastingScreen.jsx';
import TastingFormScreen from './screens/TastingFormScreen.jsx';
import WineFormScreen from './screens/WineFormScreen.jsx';
import WineScreen from './screens/WineScreen.jsx';
import WineListScreen from './screens/WineListScreen.jsx';
import WineListResultScreen from './screens/WineListResultScreen.jsx';
import WineryScreen from './screens/WineryScreen.jsx';

export default function App() {
  return (
    <HashRouter>
      <div className="min-h-dvh bg-stone-50 text-stone-900 dark:bg-stone-950 dark:text-stone-100">
        <div className="mx-auto min-h-dvh max-w-[480px]">
          <ErrorBoundary>
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
            <Route path="/winery/:id" element={<WineryScreen />} />
            <Route path="/winelist" element={<WineListScreen />} />
            <Route path="/winelist/:id" element={<WineListResultScreen />} />
            <Route path="/stats" element={<StatsScreen />} />
            <Route
              path="/map"
              element={
                <Suspense fallback={null}>
                  <MapScreen />
                </Suspense>
              }
            />
            <Route
              path="/map-check"
              element={
                <Suspense fallback={null}>
                  <MapCheckScreen />
                </Suspense>
              }
            />
            <Route
              path="/map-matrix"
              element={
                <Suspense fallback={null}>
                  <MapMatrixScreen />
                </Suspense>
              }
            />
            <Route path="/settings" element={<SettingsScreen />} />
            <Route path="/settings/cellar" element={<CellarSettingsScreen />} />
            <Route path="/settings/backup" element={<BackupScreen />} />
          </Routes>
          </ErrorBoundary>
          <UpdateToast />
        </div>
      </div>
    </HashRouter>
  );
}
