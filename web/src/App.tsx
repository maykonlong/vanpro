import { Suspense, lazy } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';

import { AuthProvider, useAuth } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import { FeaturesProvider } from './context/FeaturesContext';
import { AppLayout } from './layouts/AppLayout';
import { RequireRole } from './components/RequireRole';
import { SkeletonList } from './components/ui';
import { homeForRole } from './lib/routes';

import { Login } from './pages/public/Login';
import { NotFound } from './pages/public/NotFound';

/*
 * Telas em pedaços separados.
 *
 * Quem entra pela primeira vez baixa a landing e o login; o painel financeiro
 * do dono, com todas as suas tabelas, só desce quando ele de fato abre. O
 * motorista no 3G da rua nunca baixa o CRM. É o mesmo orçamento de bytes
 * gasto onde a pessoa está olhando.
 */
const Landing = lazy(() => import('./pages/public/Landing').then((m) => ({ default: m.Landing })));
const Register = lazy(() =>
  import('./pages/public/Register').then((m) => ({ default: m.Register })),
);
const ForgotPassword = lazy(() =>
  import('./pages/public/ForgotPassword').then((m) => ({ default: m.ForgotPassword })),
);
const ResetPassword = lazy(() =>
  import('./pages/public/ResetPassword').then((m) => ({ default: m.ResetPassword })),
);
const AcceptInvite = lazy(() =>
  import('./pages/public/AcceptInvite').then((m) => ({ default: m.AcceptInvite })),
);
const PrivacyPolicy = lazy(() =>
  import('./pages/public/PrivacyPolicy').then((m) => ({ default: m.PrivacyPolicy })),
);
const Suspended = lazy(() =>
  import('./pages/public/Suspended').then((m) => ({ default: m.Suspended })),
);

const Dashboard = lazy(() =>
  import('./pages/owner/Dashboard').then((m) => ({ default: m.Dashboard })),
);
const Financial = lazy(() =>
  import('./pages/owner/Financial').then((m) => ({ default: m.Financial })),
);
const Students = lazy(() =>
  import('./pages/owner/Students').then((m) => ({ default: m.Students })),
);
const Fleet = lazy(() => import('./pages/owner/Fleet').then((m) => ({ default: m.Fleet })));
const Team = lazy(() => import('./pages/owner/Team').then((m) => ({ default: m.Team })));
const Charters = lazy(() =>
  import('./pages/owner/Charters').then((m) => ({ default: m.Charters })),
);
const CrmAi = lazy(() => import('./pages/owner/CrmAi').then((m) => ({ default: m.CrmAi })));
const Compliance = lazy(() =>
  import('./pages/owner/Compliance').then((m) => ({ default: m.Compliance })),
);
const Settings = lazy(() =>
  import('./pages/owner/Settings').then((m) => ({ default: m.Settings })),
);

const DriverRoute = lazy(() =>
  import('./pages/driver/DriverRoute').then((m) => ({ default: m.DriverRoute })),
);
const Timeclock = lazy(() =>
  import('./pages/driver/Timeclock').then((m) => ({ default: m.Timeclock })),
);
const MyEarnings = lazy(() =>
  import('./pages/driver/MyEarnings').then((m) => ({ default: m.MyEarnings })),
);
const Boarding = lazy(() =>
  import('./pages/assistant/Boarding').then((m) => ({ default: m.Boarding })),
);
const ParentHome = lazy(() =>
  import('./pages/parent/ParentHome').then((m) => ({ default: m.ParentHome })),
);
const ParentInvoices = lazy(() =>
  import('./pages/parent/ParentInvoices').then((m) => ({ default: m.ParentInvoices })),
);
const ParentPrivacy = lazy(() =>
  import('./pages/parent/ParentPrivacy').then((m) => ({ default: m.ParentPrivacy })),
);
const PlatformPanel = lazy(() =>
  import('./pages/admin/PlatformPanel').then((m) => ({ default: m.PlatformPanel })),
);

const GESTAO = ['OWNER', 'MANAGER'] as const;
const TODOS = ['OWNER', 'MANAGER', 'DRIVER', 'ASSISTANT', 'PARENT', 'SUPER_ADMIN'] as const;

/** Esqueleto enquanto o pedaço da tela desce. Nunca uma tela em branco. */
function Carregando() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <SkeletonList rows={3} />
    </div>
  );
}

/** `/app` sozinho manda cada papel para a tela que ele de fato usa. */
function AppHome() {
  const { user, status } = useAuth();
  if (status === 'loading') return <Carregando />;
  if (!user) return <Navigate to="/entrar" replace />;
  return <Navigate to={homeForRole(user.role)} replace />;
}

/** Landing pública: quem já está logado não precisa passar por ela. */
function PublicHome() {
  const { user, status } = useAuth();
  if (status === 'authenticated' && user) return <Navigate to={homeForRole(user.role)} replace />;
  return <Landing />;
}

export default function App() {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <AuthProvider>
          <FeaturesProvider>
            <Suspense fallback={<Carregando />}>
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
                    <RequireRole roles={[...TODOS]}>
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
                  {/* Aprovar eliminação e ler a trilha são atos do controlador
                      dos dados: só o proprietário, como a API exige. */}
                  <Route
                    path="privacidade-auditoria"
                    element={
                      <RequireRole roles={['OWNER']}>
                        <Compliance />
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
                      <RequireRole roles={[...TODOS]}>
                        <Settings />
                      </RequireRole>
                    }
                  />
                </Route>

                <Route path="*" element={<NotFound />} />
              </Routes>
            </Suspense>
          </FeaturesProvider>
        </AuthProvider>
      </BrowserRouter>
    </ThemeProvider>
  );
}
