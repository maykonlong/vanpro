import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowRight,
  Bus,
  CalendarClock,
  Rocket,
  Users,
  Wrench,
} from 'lucide-react';

import { api } from '../../lib/api';
import { firstDayOfMonth, formatCents, formatDate, label, today } from '../../lib/format';
import { useResource } from '../../hooks/useResource';
import { useAuth } from '../../context/AuthContext';
import { PermissionNotice } from '../../components/PermissionNotice';
import {
  Answer,
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  PageHeader,
  SectionTitle,
  Skeleton,
  SkeletonAnswer,
  SkeletonList,
  Stat,
} from '../../components/ui';
import type { Dre, Incident, Paginated, Student, Transaction, Vehicle } from '../../lib/types';

/**
 * Painel do dono da frota.
 *
 * A pergunta dele não é "quantos registros eu tenho": é "estou ganhando ou
 * perdendo?" e, no meio do mês, "quem não me pagou?". Por isso a tela abre com
 * DUAS respostas em corpo grande — o resultado do mês e o valor atrasado — e só
 * depois oferece os números de apoio. Seis cartões iguais no topo obrigariam
 * ele a fazer a conta de cabeça para descobrir o que a tela já sabe.
 */

const MESES = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
];

/** Link de navegação com alvo de toque cheio, e não texto sublinhado solto. */
function LinkAcao({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <Link
      to={to}
      className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl px-3 text-sm font-medium text-brand-600 transition-colors hover:bg-brand-soft"
    >
      {children}
      <ArrowRight aria-hidden="true" size={16} />
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Resposta 1 — o resultado do mês
// ---------------------------------------------------------------------------

function ResultadoDoMes() {
  const from = firstDayOfMonth();
  const to = today();
  const dre = useResource<Dre>(
    (signal) => api.get('/financial/dre', { from, to }, signal),
    [from, to],
  );

  const mes = MESES[new Date().getMonth()];

  if (dre.loading) {
    return (
      <div className="flex flex-col gap-4">
        <SkeletonAnswer />
        <div className="grid gap-3 sm:grid-cols-3">
          <Skeleton className="h-[86px]" />
          <Skeleton className="h-[86px]" />
          <Skeleton className="h-[86px]" />
        </div>
      </div>
    );
  }
  if (dre.error) return <ErrorState message={dre.error} onRetry={dre.reload} />;
  if (!dre.data) return null;

  const { receitas, despesaTotal, lucroLiquido, despesasPorCategoria, margemPercentual } = dre.data;
  const lucro = lucroLiquido.cents;
  const positivo = lucro >= 0;
  const semMovimento = receitas.total.cents === 0 && despesaTotal.cents === 0;

  // A maior despesa é o que o dono consegue de fato atacar; a lista inteira
  // vira ruído no topo da tela.
  const maiorDespesa = [...despesasPorCategoria].sort((a, b) => b.valor.cents - a.valor.cents)[0];
  const maiorFatia =
    despesaTotal.cents > 0 && maiorDespesa
      ? Math.round((maiorDespesa.valor.cents / despesaTotal.cents) * 100)
      : 0;

  return (
    <div className="flex flex-col gap-4">
      <Answer
        question={`Como está ${mes}, do dia 1º até hoje`}
        tone={semMovimento ? 'neutral' : positivo ? 'gain' : 'loss'}
        value={
          semMovimento
            ? 'Sem movimento ainda'
            : `${positivo ? 'Sobrou' : 'Faltou'} ${formatCents(Math.abs(lucro))}`
        }
        detail={
          semMovimento
            ? 'Nenhuma mensalidade recebida e nenhuma despesa lançada neste mês. Assim que houver baixa de pagamento ou lançamento de custo, o resultado aparece aqui.'
            : `Entrou ${receitas.total.formatted} e saiu ${despesaTotal.formatted}. ${
                positivo
                  ? `Isso é uma margem de ${margemPercentual}% sobre o que entrou.`
                  : 'As despesas do período passaram o que foi recebido.'
              }`
        }
        footer={<LinkAcao to="/app/financeiro">Abrir o financeiro</LinkAcao>}
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat
          label="Mensalidades recebidas"
          value={receitas.mensalidades.formatted}
          tone={receitas.mensalidades.cents > 0 ? 'gain' : 'neutral'}
          hint="Somente as com baixa confirmada."
        />
        <Stat
          label="Fretamentos concluídos"
          value={receitas.fretamentos.formatted}
          tone={receitas.fretamentos.cents > 0 ? 'gain' : 'neutral'}
          hint="Contratos encerrados no período."
        />
        <Stat
          label="Maior despesa"
          value={maiorDespesa ? maiorDespesa.valor.formatted : formatCents(0)}
          tone={despesaTotal.cents > 0 ? 'loss' : 'neutral'}
          hint={
            maiorDespesa && despesaTotal.cents > 0
              ? `${label.expenseCategory(maiorDespesa.categoria)} — ${maiorFatia}% do total gasto.`
              : 'Nenhuma despesa lançada no período.'
          }
        />
      </div>

      {despesaTotal.cents > 0 ? (
        <Card>
          <SectionTitle hint="Para onde foi o dinheiro que saiu neste mês.">
            Composição das despesas
          </SectionTitle>
          <ul className="flex flex-col gap-2.5">
            {despesasPorCategoria
              .filter((linha) => linha.valor.cents > 0)
              .sort((a, b) => b.valor.cents - a.valor.cents)
              .map((linha) => {
                const fatia = Math.round((linha.valor.cents / despesaTotal.cents) * 100);
                return (
                  <li key={linha.categoria}>
                    <div className="flex items-baseline justify-between gap-3 text-sm">
                      <span className="text-ink-200">{label.expenseCategory(linha.categoria)}</span>
                      <span className="tnum shrink-0 font-medium text-ink-50">
                        {linha.valor.formatted}
                        <span className="ml-2 text-xs font-normal text-ink-400">{fatia}%</span>
                      </span>
                    </div>
                    {/* A barra é decorativa: o número ao lado já diz tudo para
                        quem usa leitor de tela. */}
                    <div aria-hidden="true" className="mt-1.5 h-1.5 rounded-full bg-ink-800">
                      <div
                        className="h-1.5 rounded-full bg-loss"
                        style={{ width: `${Math.max(fatia, 2)}%` }}
                      />
                    </div>
                  </li>
                );
              })}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Resposta 2 — quem não pagou
// ---------------------------------------------------------------------------

const LIMITE_ATRASO = 100;

function QuemNaoPagou() {
  const hoje = today();

  const atrasadas = useResource<Paginated<Transaction>>(
    (signal) =>
      api.get(
        '/financial/transactions',
        { paid: 'false', dueTo: hoje, perPage: LIMITE_ATRASO },
        signal,
      ),
    [hoje],
  );
  // A mensalidade guarda o `studentId`, não o nome. Sem este cruzamento a tela
  // mostraria um UUID — e "quem não pagou" viraria "qual identificador não pagou".
  const alunos = useResource<Paginated<Student>>(
    (signal) => api.get('/students', { perPage: 100 }, signal),
    [],
  );

  if (atrasadas.loading) return <SkeletonAnswer />;
  if (atrasadas.error) return <ErrorState message={atrasadas.error} onRetry={atrasadas.reload} />;
  if (!atrasadas.data) return null;

  const { items, meta } = atrasadas.data;
  const totalCents = items.reduce((acc, t) => acc + t.amount.cents, 0);
  const parcial = meta.total > items.length;
  const nomes = new Map((alunos.data?.items ?? []).map((s) => [s.id, s.name]));

  if (meta.total === 0) {
    return (
      <Answer
        question="Quanto está atrasado"
        tone="good"
        value="Ninguém em atraso"
        detail="Todas as mensalidades com vencimento até hoje estão quitadas. Quando alguma vencer sem baixa, ela aparece aqui com nome e valor."
      />
    );
  }

  return (
    <Answer
      question="Quanto está atrasado"
      tone="loss"
      value={formatCents(totalCents)}
      detail={
        parcial
          ? `${meta.total} mensalidades venceram sem pagamento. O valor acima soma as ${items.length} primeiras — abra o financeiro para o total completo.`
          : `${meta.total} ${meta.total === 1 ? 'mensalidade venceu' : 'mensalidades venceram'} sem pagamento.`
      }
      footer={
        <div className="flex flex-col gap-3">
          <ul className="flex flex-col gap-2">
            {items.slice(0, 5).map((t) => (
              <li
                key={t.id}
                className="flex items-center justify-between gap-3 rounded-xl bg-ink-800 px-3 py-2.5"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-ink-50">
                    {nomes.get(t.studentId) ?? 'Aluno não identificado'}
                  </span>
                  <span className="block text-xs text-ink-400">
                    Venceu em {formatDate(t.dueDate)}
                  </span>
                </span>
                <span className="tnum shrink-0 text-sm font-semibold text-loss">
                  {t.amount.formatted}
                </span>
              </li>
            ))}
          </ul>
          <LinkAcao to="/app/financeiro">Ver todas e dar baixa</LinkAcao>
        </div>
      }
    />
  );
}

// ---------------------------------------------------------------------------
// Blocos de apoio
// ---------------------------------------------------------------------------

function Frota() {
  const frota = useResource<Paginated<Vehicle>>(
    (signal) => api.get('/vehicles', { perPage: 100 }, signal),
    [],
  );

  return (
    <Card>
      <SectionTitle icon={<Bus size={18} />} action={<LinkAcao to="/app/frota">Gerenciar</LinkAcao>}>
        Frota
      </SectionTitle>

      {frota.loading ? <SkeletonList rows={2} /> : null}
      {frota.error ? <ErrorState message={frota.error} onRetry={frota.reload} /> : null}

      {frota.data && frota.data.items.length === 0 ? (
        <EmptyState
          icon={<Bus size={26} />}
          title="Nenhum veículo cadastrado"
          description="Cadastre a primeira van para poder escalar motoristas, bater ponto e lançar despesas por veículo."
          action={
            <Link to="/app/frota">
              <Button>Cadastrar veículo</Button>
            </Link>
          }
        />
      ) : null}

      {frota.data && frota.data.items.length > 0 ? (
        <>
          {(() => {
            const emRota = frota.data.items.filter((v) => v.status === 'ON_ROUTE').length;
            const manutencao = frota.data.items.filter((v) => v.status === 'MAINTENANCE').length;
            return (
              <p className="mb-3 text-sm text-ink-400">
                <strong className="tnum text-ink-50">{frota.data.meta.total}</strong>{' '}
                {frota.data.meta.total === 1 ? 'veículo' : 'veículos'} · {emRota} em rota agora
                {manutencao > 0 ? (
                  <>
                    {' '}
                    ·{' '}
                    <span className="font-medium text-warn-400">
                      {manutencao} parado{manutencao > 1 ? 's' : ''} em manutenção
                    </span>
                  </>
                ) : null}
              </p>
            );
          })()}
          <ul className="flex flex-col gap-2">
            {frota.data.items.slice(0, 5).map((v) => (
              <li
                key={v.id}
                className="flex items-center justify-between gap-3 rounded-xl bg-ink-800 px-3 py-2.5"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-ink-50">{v.plate}</span>
                  <span className="tnum block text-xs text-ink-400">
                    {v.km.toLocaleString('pt-BR')} km
                    {v.model ? ` · ${v.model}` : ''}
                  </span>
                </span>
                <Badge
                  tone={
                    v.status === 'MAINTENANCE' ? 'warn' : v.status === 'ON_ROUTE' ? 'good' : 'neutral'
                  }
                >
                  {v.status === 'MAINTENANCE' ? <Wrench aria-hidden="true" size={12} /> : null}
                  {label.vehicleStatus(v.status)}
                </Badge>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </Card>
  );
}

function Alertas() {
  const alertas = useResource<Paginated<Incident>>(
    (signal) => api.get('/crm/incidents', { perPage: 5 }, signal),
    [],
  );

  return (
    <Card>
      <SectionTitle
        icon={<AlertTriangle size={18} />}
        action={<LinkAcao to="/app/crm">Ver tudo</LinkAcao>}
      >
        Alertas da equipe
      </SectionTitle>

      {alertas.loading ? <SkeletonList rows={2} /> : null}
      {alertas.error ? <ErrorState message={alertas.error} onRetry={alertas.reload} /> : null}

      {alertas.data && alertas.data.items.length === 0 ? (
        <p className="rounded-xl border border-dashed border-ink-700 px-4 py-6 text-center text-sm text-ink-400">
          Nenhum incidente registrado. Quando alguém disparar um alerta, ele aparece aqui e chega em
          tempo real para quem estiver com o painel aberto.
        </p>
      ) : null}

      {alertas.data && alertas.data.items.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {alertas.data.items.map((i) => (
            <li key={i.id} className="rounded-xl bg-ink-800 px-3 py-2.5">
              <div className="flex items-start justify-between gap-2">
                <span className="text-sm font-medium text-ink-50">{i.title}</span>
                <Badge tone={i.severity === 'CRITICAL' || i.severity === 'HIGH' ? 'bad' : 'warn'}>
                  {label.severity(i.severity)}
                </Badge>
              </div>
              <p className="mt-1 line-clamp-2 text-xs text-ink-400">{i.description}</p>
              <p className="mt-1 text-xs text-ink-400">{formatDate(i.createdAt)}</p>
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}

/**
 * Primeiros passos.
 *
 * Só aparece enquanto a frota está de fato vazia. Um checklist eterno no painel
 * de quem já opera há dois anos é ruído; aqui ele se aposenta sozinho.
 */
function PrimeirosPassos() {
  const alunos = useResource<Paginated<Student>>(
    (signal) => api.get('/students', { perPage: 1 }, signal),
    [],
  );
  const veiculos = useResource<Paginated<Vehicle>>(
    (signal) => api.get('/vehicles', { perPage: 1 }, signal),
    [],
  );

  if (alunos.loading || veiculos.loading) return null;
  const semAlunos = alunos.data?.meta.total === 0;
  const semVeiculos = veiculos.data?.meta.total === 0;
  if (!semAlunos && !semVeiculos) return null;

  return (
    <Card className="border-brand-500/40 bg-brand-soft">
      <SectionTitle
        icon={<Rocket size={18} />}
        hint="Três cadastros e o VanPro começa a responder as suas perguntas com dado real."
      >
        Comece por aqui
      </SectionTitle>
      <ul className="flex flex-col gap-2">
        {semVeiculos ? (
          <li className="flex items-center justify-between gap-3 rounded-xl bg-ink-900 px-3 py-2.5">
            <span className="flex items-center gap-2.5 text-sm text-ink-200">
              <Bus aria-hidden="true" size={18} className="shrink-0 text-brand-600" />
              Cadastre a primeira van
            </span>
            <LinkAcao to="/app/frota">Frota</LinkAcao>
          </li>
        ) : null}
        {semAlunos ? (
          <li className="flex items-center justify-between gap-3 rounded-xl bg-ink-900 px-3 py-2.5">
            <span className="flex items-center gap-2.5 text-sm text-ink-200">
              <Users aria-hidden="true" size={18} className="shrink-0 text-brand-600" />
              Cadastre os alunos e a mensalidade de cada um
            </span>
            <LinkAcao to="/app/alunos">Alunos</LinkAcao>
          </li>
        ) : null}
        <li className="flex items-center justify-between gap-3 rounded-xl bg-ink-900 px-3 py-2.5">
          <span className="flex items-center gap-2.5 text-sm text-ink-200">
            <CalendarClock aria-hidden="true" size={18} className="shrink-0 text-brand-600" />
            Convide motorista e monitor com o acesso de cada um
          </span>
          <LinkAcao to="/app/equipe">Equipe</LinkAcao>
        </li>
      </ul>
    </Card>
  );
}

// ---------------------------------------------------------------------------

export function Dashboard() {
  const { user, hasPermission } = useAuth();
  const podeFinanceiro = hasPermission('canManageFinance');
  const primeiroNome = user?.name?.split(' ')[0] ?? '';

  return (
    <div>
      <PageHeader
        title={primeiroNome ? `Olá, ${primeiroNome}` : 'Painel'}
        description={
          user?.company
            ? `Situação da ${user.company.name} hoje, ${formatDate(new Date())}.`
            : `Situação da frota hoje, ${formatDate(new Date())}.`
        }
      />

      <div className="flex flex-col gap-4">
        <PrimeirosPassos />

        {podeFinanceiro ? (
          <>
            <div className="grid items-start gap-4 xl:grid-cols-2">
              <ResultadoDoMes />
              <QuemNaoPagou />
            </div>
          </>
        ) : (
          <PermissionNotice area="O resultado financeiro" flag="canManageFinance" variante="oculta" />
        )}

        <div className="grid items-start gap-4 lg:grid-cols-2">
          <Frota />
          <Alertas />
        </div>
      </div>
    </div>
  );
}
