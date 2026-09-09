import { useState } from 'react';
import { Receipt } from 'lucide-react';

import { api } from '../../lib/api';
import { formatDate, label } from '../../lib/format';
import { useResource } from '../../hooks/useResource';
import {
  Badge,
  Card,
  EmptyState,
  ErrorState,
  PageHeader,
  Pagination,
  SkeletonList,
} from '../../components/ui';
import type { Money } from '../../lib/types';

interface Fatura {
  id: string;
  valor: Money;
  status: string;
  vencimento: string;
  criadaEm: string;
}

interface AlunoExportado {
  id: string;
  name: string;
  school: string;
  faturas: Fatura[];
}

interface ExportPayload {
  manifesto: { parte: number; totalPartes: number; totalRegistros: number };
  alunos: AlunoExportado[];
}

/**
 * Faturas do responsavel.
 *
 * A area financeira da empresa (`/financial/invoices`) e restrita a gestao — e
 * deve ser: ela expoe o faturamento inteiro. O que o responsavel pode ver sao
 * as cobrancas dos PROPRIOS filhos, e o caminho legitimo para isso e a rota de
 * portabilidade da LGPD, que o servidor ja escopa por `parentId`.
 */
export function ParentInvoices() {
  const [page, setPage] = useState(1);

  const dados = useResource<ExportPayload>(
    (signal) => api.get('/privacy/export', { page, perPage: 10 }, signal),
    [page],
  );

  const alunos = dados.data?.alunos ?? [];
  const temFatura = alunos.some((a) => a.faturas.length > 0);

  return (
    <div>
      <PageHeader
        title="Faturas"
        description="Cobranças emitidas para os seus filhos, com valor, vencimento e situação."
      />

      {dados.loading ? <SkeletonList rows={4} /> : null}
      {dados.error ? <ErrorState message={dados.error} onRetry={dados.reload} /> : null}

      {dados.data && !temFatura ? (
        <EmptyState
          icon={<Receipt size={30} />}
          title="Nenhuma fatura emitida"
          description="Quando a empresa gerar uma cobrança para o seu filho, ela aparece aqui com valor e vencimento. Pagamentos feitos fora do sistema podem não constar."
        />
      ) : null}

      {dados.data && temFatura ? (
        <>
          <div className="flex flex-col gap-4">
            {alunos
              .filter((a) => a.faturas.length > 0)
              .map((aluno) => (
                <Card key={aluno.id}>
                  <h2 className="text-base font-semibold text-ink-50">{aluno.name}</h2>
                  <p className="text-xs text-ink-400">{aluno.school}</p>
                  <ul className="mt-3 flex flex-col gap-2">
                    {aluno.faturas.map((f) => (
                      <li
                        key={f.id}
                        className="flex items-center justify-between gap-3 rounded-lg bg-ink-800 px-3 py-2"
                      >
                        <div>
                          <p className="text-sm font-medium text-ink-50">{f.valor.formatted}</p>
                          <p className="text-xs text-ink-400">Vencimento {formatDate(f.vencimento)}</p>
                        </div>
                        <Badge
                          tone={
                            f.status === 'RECEIVED' ? 'good' : f.status === 'OVERDUE' ? 'bad' : 'warn'
                          }
                        >
                          {label.invoiceStatus(f.status)}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                </Card>
              ))}
          </div>

          <Pagination
            page={dados.data.manifesto.parte}
            totalPages={dados.data.manifesto.totalPartes}
            total={dados.data.manifesto.totalRegistros}
            onChange={setPage}
          />
        </>
      ) : null}
    </div>
  );
}
