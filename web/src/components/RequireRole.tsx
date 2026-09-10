import type { ReactNode } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Lock } from 'lucide-react';

import { useAuth } from '../context/AuthContext';
import { Button, Card, SkeletonList } from './ui';
import { label } from '../lib/format';
import { homeForRole } from '../lib/routes';
import type { Role } from '../lib/types';

/**
 * Negação de acesso com saída.
 *
 * Um 403 seco é um beco: a pessoa não sabe por que não pode, nem a quem pedir,
 * nem para onde ir. Esta tela responde as três coisas.
 */
export function Forbidden({ detail }: { detail?: string }) {
  const { user } = useAuth();
  const navigate = useNavigate();

  return (
    <main className="mx-auto flex max-w-lg flex-col gap-4 px-4 py-12">
      <Card>
        <div
          aria-hidden="true"
          className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-warn-soft text-warn-400"
        >
          <Lock size={22} />
        </div>
        <h1 className="text-xl font-semibold text-ink-50">Esta área não é do seu perfil</h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-400">
          {detail ??
            `Nesta frota você entra como ${label.role(user?.role)}, e esse papel não inclui a tela que você tentou abrir. Quem pode liberar é o proprietário da conta, em Equipe.`}
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => navigate(-1)}>
            Voltar
          </Button>
          <Button onClick={() => navigate(user ? homeForRole(user.role) : '/entrar')}>
            Ir para a minha tela inicial
          </Button>
        </div>
      </Card>
    </main>
  );
}

/**
 * Guarda de rota por papel.
 *
 * Existe para o usuário não cair em tela branca ou em erro cru — a negação que
 * conta continua sendo a do servidor (`requireRole`/`requirePermission`), que é
 * quem devolve 403 mesmo se alguém digitar a URL na mão.
 *
 * Empresa suspensa NÃO é barrada aqui de propósito: a leitura continua
 * liberada no servidor, e expulsar a pessoa para uma tela de aviso esconderia
 * dados que ela tem direito de ver. Quem informa a suspensão é a faixa fixa do
 * `AppLayout`, e quem recusa a escrita é a API.
 */
export function RequireRole({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { user, status } = useAuth();
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

  if (!roles.includes(user.role)) return <Forbidden />;

  return <>{children}</>;
}
