import { useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useNavigate } from 'react-router-dom';

import { AuthProvider, useAuth } from './context/AuthContext';
import { AppLayout } from './layouts/AppLayout';
import { RequireRole } from './components/RequireRole';
import { SkeletonList } from './components/ui';
import { homeForRole } from './lib/routes';

import { Landing } from './pages/public/Landing';
import { Login } from './pages/public/Login';
import { Register } from './pages/public/Register';
import { ForgotPassword } from './pages/public/ForgotPassword';
import { ResetPassword } from './pages/public/ResetPassword';
import { AcceptInvite } from './pages/public/AcceptInvite';
import { PrivacyPolicy } from './pages/public/PrivacyPolicy';
import { Suspended } from './pages/public/Suspended';
import { NotFound } from './pages/public/NotFound';

import { Dashboard } from './pages/owner/Dashboard';
import { Financial } from './pages/owner/Financial';
import { Students } from './pages/owner/Students';
import { Fleet } from './pages/owner/Fleet';
import { Team } from './pages/owner/Team';
import { Charters } from './pages/owner/Charters';
import { CrmAi } from './pages/owner/CrmAi';
import { Settings } from './pages/owner/Settings';

import { DriverRoute } from './pages/driver/DriverRoute';
import { Timeclock } from './pages/driver/Timeclock';
import { MyEarnings } from './pages/driver/MyEarnings';
import { Boarding } from './pages/assistant/Boarding';
import { ParentHome } from './pages/parent/ParentHome';
import { ParentInvoices } from './pages/parent/ParentInvoices';
import { ParentPrivacy } from './pages/parent/ParentPrivacy';
import { PlatformPanel } from './pages/admin/PlatformPanel';

const GESTAO = ['OWNER', 'MANAGER'] as const;

/** `/app` sozinho manda cada papel para a tela que ele de fato usa. */
function AppHome() {
  const { user, status } = useAuth();
  if (status === 'loading') {
    return (
      <div className="p-4">
        <SkeletonList rows={3} />
      </div>
    );
  }
  if (!user) return <Navigate to="/entrar" replace />;
  return <Navigate to={homeForRole(user.role)} replace />;
}

/** Landing publica: quem ja esta logado nao precisa passar por ela. */
function PublicHome() {
  const { user, status } = useAuth();
  if (status === 'authenticated' && user) return <Navigate to={homeForRole(user.role)} replace />;
  return <Landing />;
}

/** Empresa suspensa redireciona uma vez, sem prender o usuario na tela. */
function SuspensionWatcher() {
  const { suspended } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (suspended) navigate('/conta-suspensa', { replace: true });
  }, [suspended, navigate]);

  return null;
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <SuspensionWatcher />
        <Routes>
          <Route path="/" element={<PublicHome />} />
          <Route path="/entrar" element={<Login />} />
          <Route path="/cadastro" element={<Register />} />
          <Route path="/esqueci-a-senha" element={<ForgotPassword />} />
          <Route path="/redefinir-senha" element={<ResetPassword />} />
          <Route path="/aceitar-convite" element={<AcceptInvite />} />
          <Route path="/privacidade" element={<PrivacyPolicy />} />
          <Route path="/conta-suspensa" element={<Suspended />} />

          <Route
            path="/app"
            element={
              <RequireRole roles={['OWNER', 'MANAGER', 'DRIVER', 'ASSISTANT', 'PARENT', 'SUPER_ADMIN']}>
                <AppLayout />
              </RequireRole>
            }
          >
            <Route index element={<AppHome />} />

            <Route
              path="painel"
              element={
                <RequireRole roles={[...GESTAO]}>
                  <Dashboard />
                </RequireRole>
              }
            />
            <Route
              path="financeiro"
              element={
                <RequireRole roles={[...GESTAO]}>
                  <Financial />
                </RequireRole>
              }
            />
            <Route
              path="alunos"
              element={
                <RequireRole roles={[...GESTAO]}>
                  <Students />
                </RequireRole>
              }
            />
            <Route
              path="frota"
              element={
                <RequireRole roles={[...GESTAO]}>
                  <Fleet />
                </RequireRole>
              }
            />
            <Route
              path="equipe"
              element={
                <RequireRole roles={[...GESTAO]}>
                  <Team />
                </RequireRole>
              }
            />
            <Route
              path="fretamentos"
              element={
                <RequireRole roles={[...GESTAO]}>
                  <Charters />
                </RequireRole>
              }
            />
            <Route
              path="crm"
              element={
                <RequireRole roles={[...GESTAO]}>
                  <CrmAi />
                </RequireRole>
              }
            />

            <Route
              path="rota"
              element={
                <RequireRole roles={['DRIVER']}>
                  <DriverRoute />
                </RequireRole>
              }
            />
            <Route
              path="ponto"
              element={
                <RequireRole roles={['DRIVER']}>
                  <Timeclock />
                </RequireRole>
              }
            />
            <Route
              path="meus-ganhos"
              element={
                <RequireRole roles={['DRIVER']}>
                  <MyEarnings />
                </RequireRole>
              }
            />

            <Route
              path="embarque"
              element={
                <RequireRole roles={['ASSISTANT']}>
                  <Boarding />
                </RequireRole>
              }
            />

            <Route
              path="acompanhamento"
              element={
                <RequireRole roles={['PARENT']}>
                  <ParentHome />
                </RequireRole>
              }
            />
            <Route
              path="faturas"
              element={
                <RequireRole roles={['PARENT']}>
                  <ParentInvoices />
                </RequireRole>
              }
            />
            <Route
              path="privacidade"
              element={
                <RequireRole roles={['PARENT']}>
                  <ParentPrivacy />
                </RequireRole>
              }
            />

            <Route
              path="plataforma"
              element={
                <RequireRole roles={['SUPER_ADMIN']}>
                  <PlatformPanel />
                </RequireRole>
              }
            />

            <Route
              path="configuracoes"
              element={
                <RequireRole
                  roles={['OWNER', 'MANAGER', 'DRIVER', 'ASSISTANT', 'PARENT', 'SUPER_ADMIN']}
                >
                  <Settings />
                </RequireRole>
              }
            />
          </Route>

          <Route path="*" element={<NotFound />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
