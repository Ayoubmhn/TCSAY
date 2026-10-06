import { Navigate, Route, Routes } from 'react-router';
import { SeasonsPage } from './features/seasons/SeasonsPage';
import { AdminLayout } from './layouts/AdminLayout';
import { ComingSoonPage } from './pages/admin/ComingSoonPage';
import { DashboardPage } from './pages/admin/DashboardPage';

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/admin" replace />} />
      <Route path="/admin" element={<AdminLayout />}>
        <Route index element={<DashboardPage />} />
        <Route path="saisons" element={<SeasonsPage />} />
        <Route path="*" element={<ComingSoonPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/admin" replace />} />
    </Routes>
  );
}
