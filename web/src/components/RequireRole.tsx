import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Button, Card, SkeletonList } from './ui';
import type { Role } from '../lib/types';

export function Forbidden({ detail }: { detail?: string }) {
  return (
    <main className="mx-auto flex max-w-lg flex-col gap-4 px-4 py-16">
      <Card>
        <h1 className="text-xl font-semibold text-ink-50">403 — sem acesso a esta área</h1>
        <p className="mt-2 text-sm text-ink-400">
          {detail ??
            'Seu papel nesta empresa não inclui esta tela. Se você precisa dela, peça ao proprietário da conta para ajustar suas permissões em Equipe.'}
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => window.history.back()}>
            Voltar
          </Button>
          <Button onClick={() => window.location.assign('/app')}>Ir para o início</Button>
        </div>
      </Card>
    </main>
  );
}

/**
 * Guarda de rota por papel.
 *
 * Existe para o usuario nao cair em tela branca ou em erro cru — a negacao que
 * conta continua sendo a do servidor (`requireRole`/`requirePermission`), que e
 * quem devolve 403 mesmo se alguem digitar a URL na mao.
 */
export function RequireRole({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { user, status, suspended } = useAuth();
  const location = useLocation();

  if (status === 'loading') {
    return (
      <main className="mx-auto max-w-3xl px-4 py-10">
        <SkeletonList rows={3} />
      </main>
    );
  }

  if (status === 'anonymous' || !user) {
    return <Navigate to="/entrar" replace state={{ from: location.pathname }} />;
  }

  if (suspended) return <Navigate to="/conta-suspensa" replace />;

  if (!roles.includes(user.role)) return <Forbidden />;

  return <>{children}</>;
}
