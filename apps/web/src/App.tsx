import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Spinner } from './components/ui';
import { can, useAuth } from './lib/auth';
import { AccountPage } from './pages/Account';
import { AccountStatementsPage, MyStatementPage, UnitStatementPage } from './pages/AccountStatements';
import { AnnouncementsPage } from './pages/Announcements';
import { AttendancePage } from './pages/Attendance';
import { LoginPage, RegisterPage } from './pages/Auth';
import { DashboardPage } from './pages/Dashboard';
import { GeofencesPage } from './pages/Geofences';
import { MonthlyReportPage } from './pages/MonthlyReport';
import { MovementsPage } from './pages/Movements';
import { PlatformEmployeesPage, PlatformProjectsPage } from './pages/Platform';
import { OfflinePage, PendingPage, PortalPage } from './pages/Portal';
import { ProjectionsPage } from './pages/Projections';
import { ResidentsPage } from './pages/Residents';
import { ServicesPage } from './pages/Services';
import { SettingsPage } from './pages/Settings';
import { StaffPage } from './pages/Staff';
import { StatementsPage } from './pages/Statements';
import { TicketsPage } from './pages/Tickets';
import { PropertiesPage } from './pages/Units';
import { FeesPage } from './pages/Fees';
import { CatalogsPage } from './pages/Catalogs';
import { UsersPage } from './pages/Users';

export function App() {
  const { me, loading, offline, complex } = useAuth();
  if (loading) return <Spinner />;
  if (offline) return <OfflinePage />;

  if (!me) {
    return (
      <Routes>
        <Route path="/registro" element={<RegisterPage />} />
        <Route path="*" element={<LoginPage />} />
      </Routes>
    );
  }

  // Cuentas sin acceso activo (propietario pendiente de aprobación, rechazado o sin proyecto)
  if (!me.isSuperAdmin && (!complex || complex.status !== 'ACTIVE')) {
    return <PendingPage reason={!complex ? 'none' : complex.status === 'REJECTED' ? 'rejected' : 'pending'} />;
  }

  // Portal del propietario: solo consulta
  if (can(complex?.role, 'resident')) {
    return (
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<PortalPage />} />
          <Route path="estado-de-cuenta" element={<MyStatementPage />} />
          <Route path="consultas" element={<TicketsPage />} />
          <Route path="cuenta" element={<AccountPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    );
  }

  // Superusuario sin proyectos todavía → consola de plataforma
  const home = !complex
    ? <Navigate to="/plataforma/proyectos" replace />
    : can(complex.role, 'finRead') ? <DashboardPage /> : <Navigate to="/marcacion" replace />;

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={home} />
        {me.isSuperAdmin && <Route path="plataforma/proyectos" element={<PlatformProjectsPage />} />}
        {me.isSuperAdmin && <Route path="plataforma/empleados" element={<PlatformEmployeesPage />} />}
        {me.isSuperAdmin && <Route path="plataforma/usuarios" element={<UsersPage />} />}
        <Route path="ingresos" element={<MovementsPage kind="INCOME" />} />
        <Route path="egresos" element={<MovementsPage kind="EXPENSE" />} />
        <Route path="servicios" element={<ServicesPage />} />
        <Route path="cuotas" element={<FeesPage />} />
        <Route path="informes/gastos" element={<MonthlyReportPage />} />
        <Route path="informes/estados" element={<StatementsPage />} />
        <Route path="informes/proyecciones" element={<ProjectionsPage />} />
        <Route path="informes/estado-cuenta" element={<AccountStatementsPage />} />
        <Route path="informes/estado-cuenta/:unitId" element={<UnitStatementPage />} />
        <Route path="propiedades" element={<PropertiesPage />} />
        <Route path="unidades" element={<Navigate to="/propiedades" replace />} />
        <Route path="propietarios" element={<ResidentsPage />} />
        <Route path="avisos" element={<AnnouncementsPage />} />
        <Route path="consultas" element={<TicketsPage />} />
        <Route path="marcacion" element={<AttendancePage />} />
        <Route path="personal" element={<StaffPage />} />
        <Route path="geocercas" element={<GeofencesPage />} />
        <Route path="ajustes" element={<SettingsPage />} />
        <Route path="catalogos" element={<CatalogsPage />} />
        <Route path="cuenta" element={<AccountPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
