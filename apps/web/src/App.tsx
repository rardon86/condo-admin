import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Spinner } from './components/ui';
import { can, useAuth } from './lib/auth';
import { AccountPage } from './pages/Account';
import { AttendancePage } from './pages/Attendance';
import { DashboardPage } from './pages/Dashboard';
import { GeofencesPage } from './pages/Geofences';
import { LoginPage, RegisterPage } from './pages/Auth';
import { MonthlyReportPage } from './pages/MonthlyReport';
import { MovementsPage } from './pages/Movements';
import { ProjectionsPage } from './pages/Projections';
import { ServicesPage } from './pages/Services';
import { SettingsPage } from './pages/Settings';
import { StaffPage } from './pages/Staff';
import { StatementsPage } from './pages/Statements';
import { UnitsPage } from './pages/Units';

export function App() {
  const { me, loading, complex } = useAuth();
  if (loading) return <Spinner />;

  if (!me) {
    return (
      <Routes>
        <Route path="/registro" element={<RegisterPage />} />
        <Route path="*" element={<LoginPage />} />
      </Routes>
    );
  }

  // El personal operativo entra directo a marcación.
  const home = can(complex?.role, 'finRead') ? <DashboardPage /> : <Navigate to="/marcacion" replace />;

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={home} />
        <Route path="ingresos" element={<MovementsPage kind="INCOME" />} />
        <Route path="egresos" element={<MovementsPage kind="EXPENSE" />} />
        <Route path="servicios" element={<ServicesPage />} />
        <Route path="informes/gastos" element={<MonthlyReportPage />} />
        <Route path="informes/estados" element={<StatementsPage />} />
        <Route path="informes/proyecciones" element={<ProjectionsPage />} />
        <Route path="unidades" element={<UnitsPage />} />
        <Route path="marcacion" element={<AttendancePage />} />
        <Route path="personal" element={<StaffPage />} />
        <Route path="geocercas" element={<GeofencesPage />} />
        <Route path="ajustes" element={<SettingsPage />} />
        <Route path="cuenta" element={<AccountPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
