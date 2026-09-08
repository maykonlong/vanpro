import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import * as Sentry from "@sentry/react";
import MainLayout from './layouts/MainLayout';
import OwnerDashboard from './pages/OwnerDashboard';
import DriverDashboard from './pages/DriverDashboard';
import ParentDashboard from './pages/ParentDashboard';
import CharterManagement from './pages/owners/CharterManagement';
import AIMarketingPanel from './pages/owners/AIMarketingPanel';
import Login from './pages/Login';
import LandingPage from './pages/public/LandingPage';
import { AuthProvider, useAuth } from './context/AuthContext';

Sentry.init({
  dsn: process.env.VITE_SENTRY_DSN || "",
  integrations: [
    Sentry.browserTracingIntegration(),
    Sentry.replayIntegration(),
  ],
  tracesSampleRate: 1.0,
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,
});

const PrivateRoute = ({ children }: { children: React.ReactNode }) => {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
};

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={<Login />} />
        
        {/* Rotas Protegidas */}
        <Route path="/app" element={<PrivateRoute><MainLayout /></PrivateRoute>}>
          <Route index element={<Navigate to="/owner" replace />} />
          <Route path="owner" element={<OwnerDashboard />} />
          <Route path="charters" element={<CharterManagement />} />
          <Route path="marketing" element={<AIMarketingPanel />} />
          <Route path="driver" element={<DriverDashboard />} />
          <Route path="assistant" element={<AssistantDashboard />} />
          <Route path="parent" element={<ParentDashboard />} />
        </Route>
      </Routes>
    </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
