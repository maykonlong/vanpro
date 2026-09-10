import { useState } from 'react';
import { Server } from 'lucide-react';

import { api } from '../../lib/api';
import { formatCents, formatDate } from '../../lib/format';
import { useAction, useResource } from '../../hooks/useResource';
import { useAuth } from '../../context/AuthContext';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  InlineError,
  Modal,
  PageHeader,
  Pagination,
  SelectInput,
  SkeletonList,
  TextArea,
} from '../../components/ui';
import type { FeatureFlags, Paginated } from '../../lib/types';

interface Readiness {
  status: string;
  checks: Record<string, 'ok' | 'down'>;
}

interface FrotaDaPlataforma {
  id: string;
  name: string;
  document: string;
  tenantStatus: string;
  trialEndsAt: string | null;
  suspendedAt: string | null;
  createdAt: string;
  plan: string;
  planPriceCents: number;
  counts: { students: number; vehicles: number; drivers: number };
}

const ESTADOS = ['TRIAL', 'ACTIVE', 'PAST_DUE', 'SUSPENDED', 'CANCELED'] as const;

const TOM: Record<string, 'good' | 'warn' | 'bad' | 'neutral'> = {
  ACTIVE: 'good',
  TRIAL: 'neutral',
  PAST_DUE: 'warn',
  SUSPENDED: 'bad',
  CANCELED: 'bad',
};

const ROTULO: Record<string, string> = {
  ACTIVE: 'Ativa',
  TRIAL: 'Em teste',
  PAST_DUE: 'Pagamento pendente',
  SUSPENDED: 'Suspensa',
  CANCELED: 'Cancelada',
};

/**
 * Painel da plataforma.
 *
 * Além das sondas do ambiente, é aqui que a assinatura de cada frota é
 * decidida. Isso existe por causa de uma incoerência de domínio: o produto
 * suspendia a empresa no fim do período de teste sem nunca ter emitido a
 * fatura do próprio plano — cortava por inadimplência de um boleto que jamais
 * chegou ao cliente. Enquanto a cobrança recorrente do SaaS não for
 * construída, o fim do teste é AVISO (`PAST_DUE`) e o corte é ato
 * administrativo: alguém decide, escreve o motivo, e fica na trilha.
 */
export function PlatformPanel() {
  const { user } = useAuth();

  const [page, setPage] = useState(1);
  const [emEdicao, setEmEdicao] = useState<FrotaDaPlataforma | null>(null);
  const [novoEstado, setNovoEstado] = useState<string>('SUSPENDED');
  const [motivo, setMotivo] = useState('');

  const flags = useResource<FeatureFlags>((signal) => api.get('/health/features', undefined, signal), []);
  const ready = useResource<Readiness>((signal) => api.get('/health/ready', undefined, signal), []);
  const frotas = useResource<Paginated<FrotaDaPlataforma>>(
    (signal) => api.get('/platform/companies', { page, perPage: 20 }, signal),
    [page],
  );
  const mudanca = useAction();

  const abrir = (frota: FrotaDaPlataforma) => {
    setEmEdicao(frota);
    setNovoEstado(frota.tenantStatus === 'SUSPENDED' ? 'ACTIVE' : 'SUSPENDED');
    setMotivo('');
  };

  const confirmar = async () => {
    if (!emEdicao) return;
    const feito = await mudanca.run(async () => {
      await api.patch(`/platform/companies/${emEdicao.id}/status`, {
        status: novoEstado,
        reason: motivo,
      });
      return true;
    });
    if (feito) {
      setEmEdicao(null);
      frotas.reload();
    }
  };

  return (
    <div>
      <PageHeader
        title="Plataforma"
        description={`Sessão de ${user?.name ?? ''} com papel de administrador da plataforma.`}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="flex items-center gap-2 text-base font-semibold text-ink-50">
            <Server aria-hidden="true" size={18} /> Dependências
          </h2>
          {ready.loading ? <SkeletonList rows={1} /> : null}
          {ready.error ? <ErrorState message={ready.error} onRetry={ready.reload} /> : null}
          {ready.data ? (
            <>
              <p className="mt-2 text-sm text-ink-400">
                Situação geral: <span className="text-ink-50">{ready.data.status}</span>
              </p>
              <ul className="mt-3 flex flex-wrap gap-2">
                {Object.entries(ready.data.checks).map(([nome, estado]) => (
                  <li key={nome}>
                    <Badge tone={estado === 'ok' ? 'good' : 'bad'}>
                      {nome}: {estado === 'ok' ? 'no ar' : 'fora'}
                    </Badge>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-xs text-ink-400">
                Banco fora significa "não pronto"; cache fora significa degradado, não parado — o
                limitador cai para memória local e o produto continua de pé.
              </p>
            </>
          ) : null}
        </Card>

        <Card>
          <h2 className="text-base font-semibold text-ink-50">Integrações do ambiente</h2>
          {flags.loading ? <SkeletonList rows={1} /> : null}
          {flags.error ? <ErrorState message={flags.error} onRetry={flags.reload} /> : null}
          {flags.data ? (
            <ul className="mt-3 flex flex-wrap gap-2">
              {(
                [
                  ['Cobrança', flags.data.billing],
                  ['WhatsApp', flags.data.whatsapp],
                ] as const
              ).map(([nome, ligado]) => (
                <li key={nome}>
                  <Badge tone={ligado ? 'good' : 'neutral'}>
                    {nome}: {ligado ? 'configurada' : 'não configurada'}
                  </Badge>
                </li>
              ))}
            </ul>
          ) : null}
        </Card>

        <Card className="lg:col-span-2">
          <h2 className="text-base font-semibold text-ink-50">Frotas na plataforma</h2>
          <p className="mt-2 text-sm text-ink-400">
            Suspender mantém a leitura e as operações essenciais — ponto e check-in continuam,
            porque a van já está na rua com criança dentro quando o boleto vence. Cancelar encerra
            as sessões abertas. Toda mudança exige motivo e fica na trilha da frota afetada.
          </p>

          {frotas.loading ? <SkeletonList rows={4} /> : null}
          {frotas.error ? <ErrorState message={frotas.error} onRetry={frotas.reload} /> : null}

          {frotas.data && frotas.data.items.length === 0 ? (
            <EmptyState
              icon={<Server aria-hidden="true" size={28} />}
              title="Nenhuma frota cadastrada"
              description="Assim que a primeira empresa se cadastrar, ela aparece aqui."
            />
          ) : null}

          {frotas.data && frotas.data.items.length > 0 ? (
            <>
              {/* A tabela é larga: rola dentro do próprio contêiner, sem arrastar a página. */}
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[720px] text-left text-sm">
                  <thead className="text-xs uppercase tracking-wide text-ink-400">
                    <tr>
                      <th scope="col" className="py-2 pr-4">
                        Frota
                      </th>
                      <th scope="col" className="py-2 pr-4">
                        Assinatura
                      </th>
                      <th scope="col" className="py-2 pr-4">
                        Plano
                      </th>
                      <th scope="col" className="py-2 pr-4">
                        Tamanho
                      </th>
                      <th scope="col" className="py-2 pr-4">
                        Desde
                      </th>
                      <th scope="col" className="py-2">
                        <span className="sr-only">Ações</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {frotas.data.items.map((f) => (
                      <tr key={f.id} className="border-t border-ink-800">
                        <td className="py-3 pr-4">
                          <span className="font-medium text-ink-50">{f.name}</span>
                          <span className="block text-xs text-ink-400">{f.document}</span>
                        </td>
                        <td className="py-3 pr-4">
                          <Badge tone={TOM[f.tenantStatus] ?? 'neutral'}>
                            {ROTULO[f.tenantStatus] ?? f.tenantStatus}
                          </Badge>
                        </td>
                        <td className="py-3 pr-4 text-ink-200">
                          {f.plan}
                          <span className="block text-xs text-ink-400">
                            {f.planPriceCents > 0 ? `${formatCents(f.planPriceCents)}/mês` : 'sem custo'}
                          </span>
                        </td>
                        <td className="py-3 pr-4 text-ink-200">
                          {f.counts.students} alunos · {f.counts.vehicles} vans
                        </td>
                        <td className="py-3 pr-4 text-ink-400">{formatDate(f.createdAt)}</td>
                        <td className="py-3">
                          <Button
                            variant="secondary"
                            onClick={() => abrir(f)}
                            aria-label={`Alterar assinatura de ${f.name}`}
                          >
                            Alterar
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <Pagination
                page={frotas.data.meta.page}
                totalPages={frotas.data.meta.totalPages}
                total={frotas.data.meta.total}
                onChange={setPage}
              />
            </>
          ) : null}
        </Card>

        <Modal
          open={Boolean(emEdicao)}
          title={`Assinatura de ${emEdicao?.name ?? ''}`}
          onClose={() => setEmEdicao(null)}
        >
          <div className="flex flex-col gap-3">
            <InlineError message={mudanca.error} />
            <SelectInput
              label="Novo estado"
              name="status"
              value={novoEstado}
              onChange={(e) => setNovoEstado(e.target.value)}
            >
              {ESTADOS.filter((e) => e !== emEdicao?.tenantStatus).map((e) => (
                <option key={e} value={e}>
                  {ROTULO[e]}
                </option>
              ))}
            </SelectInput>
            <TextArea
              label="Motivo"
              name="reason"
              required
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              error={mudanca.fieldErrors.reason}
              hint="Fica registrado na trilha da frota e é o que se lê quando o cliente perguntar."
            />
            <div className="mt-2 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="secondary" onClick={() => setEmEdicao(null)}>
                Cancelar
              </Button>
              <Button
                variant={novoEstado === 'SUSPENDED' || novoEstado === 'CANCELED' ? 'danger' : 'primary'}
                loading={mudanca.pending}
                onClick={() => void confirmar()}
              >
                Aplicar
              </Button>
            </div>
          </div>
        </Modal>
      </div>
    </div>
  );
}
