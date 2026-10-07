import type { ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router';
import { homeOf, useAuth } from './auth/AuthContext';
import { EmptyState } from './components/ui/Card';
import { SeasonsPage } from './features/seasons/SeasonsPage';
import { AppShell } from './layouts/AppShell';
import type { Role } from './lib/types';
import { AuditPage } from './pages/admin/AuditPage';
import { CategoriesPage } from './pages/admin/CategoriesPage';
import { CoachesPage } from './pages/admin/CoachesPage';
import { CourtRatesPage } from './pages/admin/CourtRatesPage';
import { CourtsPage } from './pages/admin/CourtsPage';
import { DashboardPage } from './pages/admin/DashboardPage';
import { EmailsPage } from './pages/admin/EmailsPage';
import { FeesPage } from './pages/admin/FeesPage';
import { GroupsPage } from './pages/admin/GroupsPage';
import { ParentsPage } from './pages/admin/ParentsPage';
import { PaymentsAdminPage } from './pages/admin/PaymentsAdminPage';
import { PlayersPage } from './pages/admin/PlayersPage';
import { ReservationsAdminPage } from './pages/admin/ReservationsAdminPage';
import { SalariesPage } from './pages/admin/SalariesPage';
import { ChangePasswordPage } from './pages/auth/ChangePasswordPage';
import { LoginPage } from './pages/auth/LoginPage';
import { BookPage } from './pages/BookPage';
import { CoachSalariesPage } from './pages/coach/CoachSalariesPage';
import { CoachSessionsPage } from './pages/coach/CoachSessionsPage';
import { AbsencesPage } from './pages/player/AbsencesPage';
import { HomePage } from './pages/player/HomePage';
import { PaymentsPage } from './pages/player/PaymentsPage';
import { SessionsPage } from './pages/player/SessionsPage';
import { NotFoundPage, SoonPage } from './pages/SoonPage';

/** Connexion obligatoire, mot de passe temporaire changé, rôle autorisé. */
function Protected({ roles, children }: { roles?: Role[]; children: ReactNode }) {
  const { me, loading } = useAuth();
  const location = useLocation();
  if (loading) {
    return (
      <div className="grid min-h-full place-items-center p-6">
        <EmptyState>Chargement…</EmptyState>
      </div>
    );
  }
  if (!me) return <Navigate to="/connexion" replace state={{ from: location.pathname }} />;
  if (me.mustChangePassword) return <Navigate to="/mot-de-passe" replace />;
  if (roles && !roles.includes(me.role)) return <Navigate to={homeOf(me.role)} replace />;
  return <>{children}</>;
}

const PLAYER: Role[] = ['PLAYER', 'PARENT'];

export function App() {
  return (
    <Routes>
      <Route path="/connexion" element={<LoginPage />} />
      <Route path="/mot-de-passe" element={<ChangePasswordPage />} />

      <Route
        element={
          <Protected>
            <AppShell />
          </Protected>
        }
      >
        {/* Joueur / parent */}
        <Route index element={<Protected roles={PLAYER}><HomePage /></Protected>} />
        <Route path="paiements" element={<Protected roles={PLAYER}><PaymentsPage /></Protected>} />
        <Route path="seances" element={<Protected roles={PLAYER}><SessionsPage /></Protected>} />
        <Route path="absences" element={<Protected roles={PLAYER}><AbsencesPage /></Protected>} />
        <Route path="reserver" element={<Protected roles={PLAYER}><BookPage /></Protected>} />
        <Route
          path="tournois"
          element={
            <Protected roles={PLAYER}>
              <SoonPage title="Historique des tournois" text="Vos résultats et participations aux tournois apparaîtront ici." />
            </Protected>
          }
        />

        {/* Coach */}
        <Route path="coach/seances" element={<Protected roles={['COACH']}><CoachSessionsPage /></Protected>} />
        <Route path="coach/salaires" element={<Protected roles={['COACH']}><CoachSalariesPage /></Protected>} />
        <Route path="coach/reserver" element={<Protected roles={['COACH']}><BookPage /></Protected>} />

        {/* Administrateur */}
        <Route path="admin" element={<Protected roles={['ADMIN']}><DashboardPage /></Protected>} />
        <Route path="admin/joueurs" element={<Protected roles={['ADMIN']}><PlayersPage /></Protected>} />
        <Route path="admin/parents" element={<Protected roles={['ADMIN']}><ParentsPage /></Protected>} />
        <Route path="admin/entraineurs" element={<Protected roles={['ADMIN']}><CoachesPage /></Protected>} />
        <Route path="admin/groupes" element={<Protected roles={['ADMIN']}><GroupsPage /></Protected>} />
        <Route path="admin/terrains" element={<Protected roles={['ADMIN']}><CourtsPage /></Protected>} />
        <Route path="admin/categories" element={<Protected roles={['ADMIN']}><CategoriesPage /></Protected>} />
        <Route path="admin/saisons" element={<Protected roles={['ADMIN']}><SeasonsPage /></Protected>} />
        <Route path="admin/tarifs" element={<Protected roles={['ADMIN']}><FeesPage /></Protected>} />
        <Route path="admin/tarifs-terrains" element={<Protected roles={['ADMIN']}><CourtRatesPage /></Protected>} />
        <Route path="admin/reservations" element={<Protected roles={['ADMIN']}><ReservationsAdminPage /></Protected>} />
        <Route path="admin/salaires" element={<Protected roles={['ADMIN']}><SalariesPage /></Protected>} />
        <Route path="admin/paiements" element={<Protected roles={['ADMIN']}><PaymentsAdminPage /></Protected>} />
        <Route path="admin/emails" element={<Protected roles={['ADMIN']}><EmailsPage /></Protected>} />
        <Route path="admin/audit" element={<Protected roles={['ADMIN']}><AuditPage /></Protected>} />
        <Route
          path="admin/import"
          element={
            <Protected roles={['ADMIN']}>
              <SoonPage
                title="Import historique"
                text="Numérisation des cahiers depuis 2010 : envoi des scans, extraction par IA, validation humaine ligne par ligne (sprint 9, pilote de 30 à 50 pages)."
              />
            </Protected>
          }
        />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
