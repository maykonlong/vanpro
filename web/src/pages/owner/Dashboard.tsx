import { Link } from 'react-router-dom';
import { AlertTriangle, Bus, TrendingDown, TrendingUp } from 'lucide-react';

import { api } from '../../lib/api';
import { firstDayOfMonth, formatCents, formatDate, label, today } from '../../lib/format';
import { useResource } from '../../hooks/useResource';
import { useAuth } from '../../context/AuthContext';
import { PermissionNotice } from '../../components/PermissionNotice';
import {
  Badge,
  Card,
  EmptyState,
  ErrorState,
  PageHeader,
  Skeleton,
  SkeletonList,
} from '../../components/ui';
import type { Dre, Incident, Paginated, Transaction, Vehicle } from '../../lib/types';

function Stat({
  title,
  value,
  hint,
  tone = 'neutral',
}: {
  title: string;
  value: string;
  hint?: string;
  tone?: 'neutral' | 'good' | 'bad';
}) {
  const color = tone === 'good' ? 'text-good-400' : tone === 'bad' ? 'text-bad-400' : 'text-ink-50';
  return (
    <Card>
      <p className="text-xs uppercase tracking-wide text-ink-400">{title}</p>
      <p className={`mt-2 text-2xl font-semibold ${color}`}>{value}</p>
      {hint ? <p className="mt-1 text-xs text-ink-400">{hint}</p> : null}
    </Card>
  );
}

function DreBlock() {
  const from = firstDayOfMonth();
  const to = today();
  const dre = useResource<Dre>((signal) => api.get('/financial/dre', { from, to }, signal), [from, to]);

  if (dre.loading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-28 w-full" />
        ))}
      </div>
    );
  }
  if (dre.error) return <ErrorState message={dre.error} onRetry={dre.reload} />;
  if (!dre.data) return null;

  const lucro = dre.data.lucroLiquido.cents;

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Stat
        title="Receita do mês"
        value={dre.data.receitas.total.formatted}
        hint={`Mensalidades ${dre.data.receitas.mensalidades.formatted} · Fretamentos ${dre.data.receitas.fretamentos.formatted}`}
        tone="good"
      />
      <Stat title="Despesas do mês" value={dre.data.despesaTotal.formatted} tone="bad" />
      <Stat
        title="Lucro líquido"
        value={dre.data.lucroLiquido.formatted}
        hint={`Margem de ${dre.data.margemPercentual}%`}
        tone={lucro >= 0 ? 'good' : 'bad'}
      />
      <Card>
        <p className="text-xs uppercase tracking-wide text-ink-400">Despesas por categoria</p>
        <ul className="mt-2 flex flex-col gap-1 text-sm">
          {dre.data.despesasPorCategoria.map((linha) => (
            <li key={linha.categoria} className="flex justify-between gap-2">
              <span className="text-ink-400">{label.expenseCategory(linha.categoria)}</span>
              <span className="text-ink-50">{linha.valor.formatted}</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

function InadimplenciaBlock() {
  const hoje = today();
  const pendentes = useResource<Paginated<Transaction>>(
    (signal) =>
      api.get('/financial/transactions', { paid: 'false', dueTo: hoje, perPage: 5 }, signal),
    [hoje],
  );

  return (
    <Card>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-ink-50">Mensalidades vencidas</h2>
        <Link to="/app/financeiro" className="inline-flex min-h-[44px] items-center px-2 text-sm text-brand-400 underline">
          Ver financeiro
        </Link>
      </div>

      {pendentes.loading ? <SkeletonList rows={3} /> : null}
      {pendentes.error ? <ErrorState message={pendentes.error} onRetry={pendentes.reload} /> : null}

      {pendentes.data && pendentes.data.items.length === 0 ? (
        <p className="text-sm text-ink-400">
          Nenhuma mensalidade vencida em aberto. Quando houver, ela aparece aqui com o vencimento.
        </p>
      ) : null}

      {pendentes.data && pendentes.data.items.length > 0 ? (
        <>
          <p className="mb-3 text-sm text-bad-400">
            {pendentes.data.meta.total} em aberto ·{' '}
            {formatCents(pendentes.data.items.reduce((acc, t) => acc + t.amount.cents, 0))} nas
            primeiras {pendentes.data.items.length}
          </p>
          <ul className="flex flex-col gap-2">
            {pendentes.data.items.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-3 rounded-lg bg-ink-800 px-3 py-2">
                <span className="text-sm text-ink-200">Venceu em {formatDate(t.dueDate)}</span>
                <span className="text-sm font-medium text-ink-50">{t.amount.formatted}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </Card>
  );
}

function FrotaBlock() {
  const frota = useResource<Paginated<Vehicle>>(
    (signal) => api.get('/vehicles', { perPage: 100 }, signal),
    [],
  );

  return (
    <Card>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-ink-50">Frota</h2>
        <Link to="/app/frota" className="inline-flex min-h-[44px] items-center px-2 text-sm text-brand-400 underline">
          Gerenciar
        </Link>
      </div>

      {frota.loading ? <SkeletonList rows={2} /> : null}
      {frota.error ? <ErrorState message={frota.error} onRetry={frota.reload} /> : null}

      {frota.data && frota.data.items.length === 0 ? (
        <EmptyState
          icon={<Bus size={28} />}
          title="Nenhum veículo cadastrado"
          description="Cadastre a primeira van para poder escalar motoristas, bater ponto e lançar despesas por veículo."
          action={
            <Link to="/app/frota" className="inline-flex min-h-[44px] items-center px-2 text-sm text-brand-400 underline">
              Cadastrar veículo
            </Link>
          }
        />
      ) : null}

      {frota.data && frota.data.items.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {frota.data.items.slice(0, 6).map((v) => (
            <li key={v.id} className="flex items-center justify-between gap-3 rounded-lg bg-ink-800 px-3 py-2">
              <span className="text-sm font-medium text-ink-50">{v.plate}</span>
              <span className="text-xs text-ink-400">{v.km.toLocaleString('pt-BR')} km</span>
              <Badge tone={v.status === 'MAINTENANCE' ? 'warn' : v.status === 'ON_ROUTE' ? 'good' : 'neutral'}>
                {label.vehicleStatus(v.status)}
              </Badge>
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}

function AlertasBlock() {
  const alertas = useResource<Paginated<Incident>>(
    (signal) => api.get('/crm/incidents', { perPage: 5 }, signal),
    [],
  );

  return (
    <Card>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-ink-50">Alertas recentes</h2>
        <Link to="/app/crm" className="inline-flex min-h-[44px] items-center px-2 text-sm text-brand-400 underline">
          Ver CRM
        </Link>
      </div>

      {alertas.loading ? <SkeletonList rows={2} /> : null}
      {alertas.error ? <ErrorState message={alertas.error} onRetry={alertas.reload} /> : null}

      {alertas.data && alertas.data.items.length === 0 ? (
        <EmptyState
          icon={<AlertTriangle size={28} />}
          title="Nenhum incidente registrado"
          description="Quando alguém disparar um alerta para a equipe, ele aparece aqui e chega em tempo real para quem estiver com o painel aberto."
        />
      ) : null}

      {alertas.data && alertas.data.items.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {alertas.data.items.map((i) => (
            <li key={i.id} className="rounded-lg bg-ink-800 px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-ink-50">{i.title}</span>
                <Badge tone={i.severity === 'CRITICAL' || i.severity === 'HIGH' ? 'bad' : 'warn'}>
                  {label.severity(i.severity)}
                </Badge>
              </div>
              <p className="mt-1 text-xs text-ink-400">{formatDate(i.createdAt)}</p>
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}

export function Dashboard() {
  const { user, hasPermission } = useAuth();
  const podeFinanceiro = hasPermission('canManageFinance');

  return (
    <div>
      <PageHeader
        title={`Painel${user?.company ? ` — ${user.company.name}` : ''}`}
        description="Resultado do mês corrente, cobranças vencidas, frota e alertas da equipe."
      />

      <div className="flex flex-col gap-4">
        {podeFinanceiro ? <DreBlock /> : <PermissionNotice area="Resultado financeiro" />}

        <div className="grid gap-4 lg:grid-cols-2">
          {podeFinanceiro ? (
            <InadimplenciaBlock />
          ) : (
            <Card>
              <h2 className="flex items-center gap-2 text-base font-semibold text-ink-50">
                <TrendingDown size={18} aria-hidden="true" /> Inadimplência
              </h2>
              <p className="mt-2 text-sm text-ink-400">
                Área financeira não habilitada para o seu vínculo.
              </p>
            </Card>
          )}
          <FrotaBlock />
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <AlertasBlock />
          <Card>
            <h2 className="flex items-center gap-2 text-base font-semibold text-ink-50">
              <TrendingUp size={18} aria-hidden="true" /> Próximos passos
            </h2>
            {/* Links dentro de frase: excecao de link inline da WCAG 2.5.8, alvo minimo nao se aplica. */}
            <ul className="mt-3 flex flex-col gap-2 text-sm text-ink-200">
              <li>
                <Link to="/app/alunos" className="text-brand-400 underline">
                  Cadastrar alunos
                </Link>{' '}
                — a base da mensalidade e da lista de embarque.
              </li>
              <li>
                <Link to="/app/frota" className="text-brand-400 underline">
                  Cadastrar veículos e motoristas
                </Link>{' '}
                — sem isso não há ponto nem escala de fretamento.
              </li>
              <li>
                <Link to="/app/equipe" className="text-brand-400 underline">
                  Convidar a equipe
                </Link>{' '}
                — cada pessoa entra com o próprio acesso e as permissões que você escolher.
              </li>
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}
