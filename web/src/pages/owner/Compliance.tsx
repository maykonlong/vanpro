import { useState } from 'react';
import { FileClock, ShieldCheck, UserX } from 'lucide-react';

import { api } from '../../lib/api';
import { formatDate, formatDateTime } from '../../lib/format';
import { useAction, useResource } from '../../hooks/useResource';
import {
  Answer,
  Button,
  Callout,
  Card,
  ConfirmDialog,
  ErrorState,
  InlineError,
  PageHeader,
  Pagination,
  SectionTitle,
  SelectInput,
  SkeletonAnswer,
  SkeletonList,
  SuccessNote,
  Tabs,
  TabPanel,
} from '../../components/ui';
import type { AuditEntry, DeletionRequest, Paginated } from '../../lib/types';

/**
 * Privacidade e auditoria — a mesa do proprietário.
 *
 * Existe porque faltava a outra ponta de um fluxo que já estava pela metade: o
 * responsável conseguia PEDIR a eliminação dos dados do filho
 * (`POST /privacy/forget-me`), e o pedido ia parar numa fila que nenhuma tela
 * mostrava. Direito do titular que depende de alguém lembrar de consultar o
 * banco não é direito atendido — é um pedido perdido com aparência de
 * processo.
 *
 * A trilha de auditoria mora aqui pelo mesmo motivo: ela é verificada a cada
 * consulta, e uma verificação que ninguém lê não protege ninguém.
 */

interface ChainIntegrity {
  ok: boolean;
  checked: number;
  brokenAt?: { id: string; createdAt: string };
}

interface AuditResponse extends Paginated<AuditEntry> {
  chainIntegrity: ChainIntegrity;
}

type Aba = 'eliminacao' | 'trilha';

/**
 * As ações que a API realmente grava.
 *
 * Os valores vêm dos `audit({ action: ... })` do servidor, um a um — não de
 * uma lista plausível escrita de cabeça. Um filtro com nome inventado
 * ("LOGIN_SUCCESS" em vez de "AUTH_LOGIN_SUCCESS") não dá erro: devolve zero
 * resultados, e quem consulta conclui que o evento nunca aconteceu.
 */
const ACOES: ReadonlyArray<{ value: string; text: string }> = [
  { value: '', text: 'Todas as ações' },
  { value: 'AUTH_LOGIN_SUCCESS', text: 'Entrada na conta' },
  { value: 'AUTH_LOGIN_FAILED', text: 'Tentativa de entrada recusada' },
  { value: 'AUTH_LOCKED', text: 'Conta bloqueada por tentativas' },
  { value: 'AUTH_LOGOUT', text: 'Saída da conta' },
  { value: 'AUTH_PASSWORD_RESET', text: 'Senha redefinida' },
  { value: 'AUTH_REFRESH_REUSE_DETECTED', text: 'Reuso de sessão detectado' },
  { value: 'STUDENT_CREATED', text: 'Aluno cadastrado' },
  { value: 'STUDENT_UPDATED', text: 'Aluno alterado' },
  { value: 'STUDENT_DELETED', text: 'Aluno excluído' },
  { value: 'VEHICLE_CREATED', text: 'Veículo cadastrado' },
  { value: 'VEHICLE_UPDATED', text: 'Veículo alterado' },
  { value: 'VEHICLE_DELETED', text: 'Veículo excluído' },
  { value: 'DRIVER_CREATED', text: 'Motorista cadastrado' },
  { value: 'DRIVER_UPDATED', text: 'Motorista alterado' },
  { value: 'DRIVER_ARCHIVED', text: 'Motorista arquivado' },
  { value: 'TIMECARD_PUNCH', text: 'Batida de ponto' },
  { value: 'INVOICE_CREATED', text: 'Cobrança emitida' },
  { value: 'INVOICE_PAID', text: 'Pagamento confirmado' },
  { value: 'EXPENSE_CREATED', text: 'Despesa lançada' },
  { value: 'EXPENSE_DELETED', text: 'Despesa excluída' },
  { value: 'CHARTER_CREATED', text: 'Fretamento criado' },
  { value: 'CHARTER_ASSIGNED', text: 'Fretamento escalado' },
  { value: 'CHARTER_STATUS_CHANGED', text: 'Fretamento mudou de situação' },
  { value: 'USER_INVITED', text: 'Pessoa convidada' },
  { value: 'USER_ROLE_CHANGED', text: 'Permissões alteradas' },
  { value: 'USER_ARCHIVED', text: 'Vínculo arquivado' },
  { value: 'INCIDENT_BROADCAST', text: 'Alerta disparado à equipe' },
  { value: 'LGPD_CONSENT_UPDATE', text: 'Consentimento alterado' },
  { value: 'LGPD_DATA_EXPORT', text: 'Exportação de dados' },
  { value: 'LGPD_FORGET_REQUEST', text: 'Eliminação solicitada' },
  { value: 'LGPD_FORGET_EXECUTED', text: 'Eliminação executada' },
  { value: 'SECURITY_TENANT_VIOLATION', text: 'Tentativa de acesso a outra empresa' },
  { value: 'SECURITY_SHIELD_BLOCK', text: 'Requisição bloqueada pelo escudo' },
];

// ---------------------------------------------------------------------------
// Pedidos de eliminação
// ---------------------------------------------------------------------------

function Eliminacao() {
  const [page, setPage] = useState(1);
  const [aprovando, setAprovando] = useState<DeletionRequest | null>(null);
  const [feito, setFeito] = useState<string | null>(null);

  const fila = useResource<Paginated<DeletionRequest>>(
    (signal) => api.get('/privacy/deletion-requests', { page, perPage: 20 }, signal),
    [page],
  );
  const aprovar = useAction();

  const onAprovar = async () => {
    if (!aprovando) return;
    const nome = aprovando.name;
    const ok = await aprovar.run(async () => {
      await api.post(`/privacy/deletion-requests/${aprovando.id}/approve`);
      return true;
    });
    if (ok) {
      setAprovando(null);
      setFeito(
        `Dados pessoais de ${nome} anonimizados. O histórico financeiro foi preservado, como a obrigação fiscal de guarda exige.`,
      );
      fila.reload();
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {fila.loading ? <SkeletonAnswer /> : null}
      {fila.error ? <ErrorState message={fila.error} onRetry={fila.reload} /> : null}

      {fila.data ? (
        <Answer
          question="Há pedidos de eliminação esperando você?"
          tone={fila.data.meta.total > 0 ? 'warn' : 'good'}
          value={
            fila.data.meta.total === 0
              ? 'Nenhum pedido pendente'
              : `${fila.data.meta.total} ${fila.data.meta.total === 1 ? 'pedido aguardando' : 'pedidos aguardando'}`
          }
          detail={
            fila.data.meta.total === 0
              ? 'Quando um responsável pedir a eliminação dos dados do filho, o pedido aparece aqui para a sua avaliação — e só executa depois que você aprovar.'
              : 'Cada pedido é um direito do titular (LGPD, Art. 18, VI). Avalie as obrigações legais de guarda antes de aprovar: mensalidade em aberto impede a eliminação, e a própria API recusa nesse caso.'
          }
        />
      ) : null}

      <SuccessNote message={feito} />
      <InlineError message={aprovar.error} />

      {fila.data && fila.data.items.length > 0 ? (
        <>
          <ul className="flex flex-col gap-2">
            {fila.data.items.map((pedido) => (
              <Card as="li" key={pedido.id} className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-base font-semibold text-ink-50">{pedido.name}</p>
                  <p className="truncate text-sm text-ink-400">
                    {pedido.school || 'Escola não informada'} · pedido feito em{' '}
                    {formatDate(pedido.updatedAt)}
                  </p>
                </div>
                <Button variant="danger" onClick={() => setAprovando(pedido)}>
                  <UserX aria-hidden="true" size={18} />
                  Aprovar eliminação
                </Button>
              </Card>
            ))}
          </ul>

          <Pagination
            page={fila.data.meta.page}
            totalPages={fila.data.meta.totalPages}
            total={fila.data.meta.total}
            onChange={setPage}
          />
        </>
      ) : null}

      <Callout tone="neutral" title="O que a aprovação faz, exatamente">
        O cadastro não é apagado: nome, endereço, foto e data de nascimento são substituídos por um
        marcador, e o vínculo com o responsável é desfeito. As faturas já emitidas continuam
        existindo sem apontar para ninguém — apagar a linha derrubaria o histórico financeiro e a
        própria prova de que a eliminação aconteceu. A ação é irreversível.
      </Callout>

      <ConfirmDialog
        open={aprovando !== null}
        title="Aprovar a eliminação dos dados?"
        message={
          aprovando
            ? `Os dados pessoais de ${aprovando.name}${aprovando.school ? ` (${aprovando.school})` : ''} serão anonimizados agora e não há como desfazer. O histórico financeiro permanece, sem identificar a criança.`
            : ''
        }
        confirmLabel="Anonimizar definitivamente"
        loading={aprovar.pending}
        onConfirm={() => void onAprovar()}
        onCancel={() => setAprovando(null)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Trilha de auditoria
// ---------------------------------------------------------------------------

function Trilha() {
  const [page, setPage] = useState(1);
  const [acao, setAcao] = useState('');

  const trilha = useResource<AuditResponse>(
    (signal) => api.get('/privacy/audit-trail', { page, perPage: 25, action: acao }, signal),
    [page, acao],
  );

  return (
    <div className="flex flex-col gap-4">
      {trilha.loading ? <SkeletonAnswer /> : null}
      {trilha.error ? <ErrorState message={trilha.error} onRetry={trilha.reload} /> : null}

      {trilha.data ? (
        <Answer
          question="A trilha de auditoria está íntegra?"
          tone={trilha.data.chainIntegrity.ok ? 'good' : 'bad'}
          value={
            trilha.data.chainIntegrity.ok
              ? 'Sim, cadeia íntegra'
              : 'Não — a cadeia foi rompida'
          }
          detail={
            trilha.data.chainIntegrity.ok
              ? `${trilha.data.chainIntegrity.checked.toLocaleString('pt-BR')} registros conferidos agora, um a um: cada linha guarda o hash da anterior, então alterar qualquer uma quebraria todas as seguintes.`
              : `A verificação encontrou um ponto de ruptura${
                  trilha.data.chainIntegrity.brokenAt
                    ? ` em ${formatDateTime(trilha.data.chainIntegrity.brokenAt.createdAt)}`
                    : ''
                }. Registros a partir dali não servem como prova. Avise o responsável técnico do ambiente antes de usar este conteúdo em qualquer decisão.`
          }
        />
      ) : null}

      <Card>
        <SectionTitle hint="A conferência roda a cada consulta — não é um selo guardado.">
          Registros
        </SectionTitle>

        <div className="max-w-sm">
          <SelectInput
            label="Filtrar por ação"
            name="action"
            value={acao}
            onChange={(e) => {
              setAcao(e.target.value);
              setPage(1);
            }}
          >
            {ACOES.map((a) => (
              <option key={a.value} value={a.value}>
                {a.text}
              </option>
            ))}
          </SelectInput>
        </div>

        {trilha.loading ? (
          <div className="mt-4">
            <SkeletonList rows={4} />
          </div>
        ) : null}

        {trilha.data && trilha.data.items.length === 0 ? (
          <p className="mt-4 rounded-xl border border-dashed border-ink-700 px-4 py-6 text-center text-sm text-ink-400">
            Nenhum registro para este filtro. Troque a ação acima para ver os demais.
          </p>
        ) : null}

        {trilha.data && trilha.data.items.length > 0 ? (
          <>
            <ol className="mt-4 flex flex-col gap-2">
              {trilha.data.items.map((entrada) => (
                <li key={entrada.id} className="rounded-xl bg-ink-800 px-3 py-2.5">
                  <p className="text-sm text-ink-200">{entrada.description}</p>
                  <p className="tnum mt-1 text-xs text-ink-400">
                    {formatDateTime(entrada.createdAt)}
                    {entrada.ipAddress ? ` · IP ${entrada.ipAddress}` : ''}
                    {` · ${entrada.action}`}
                  </p>
                </li>
              ))}
            </ol>

            <Pagination
              page={trilha.data.meta.page}
              totalPages={trilha.data.meta.totalPages}
              total={trilha.data.meta.total}
              onChange={setPage}
            />
          </>
        ) : null}
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------

export function Compliance() {
  const [aba, setAba] = useState<Aba>('eliminacao');

  return (
    <div>
      <PageHeader
        title="Privacidade e auditoria"
        description="Os pedidos de eliminação que dependem da sua aprovação e o registro de tudo que aconteceu nesta frota."
      />

      <Tabs
        label="Seções de privacidade"
        value={aba}
        onChange={setAba}
        tabs={[
          { value: 'eliminacao', text: 'Pedidos de eliminação', icon: <ShieldCheck size={16} /> },
          { value: 'trilha', text: 'Trilha de auditoria', icon: <FileClock size={16} /> },
        ]}
      />

      <TabPanel value={aba}>{aba === 'eliminacao' ? <Eliminacao /> : <Trilha />}</TabPanel>
    </div>
  );
}
