import { useState } from 'react';
import { Receipt } from 'lucide-react';

import { api } from '../../lib/api';
import { formatCents, formatDate, label, today } from '../../lib/format';
import { useResource } from '../../hooks/useResource';
import {
  Answer,
  Badge,
  Callout,
  Card,
  EmptyState,
  ErrorState,
  PageHeader,
  Pagination,
  SkeletonAnswer,
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
 * Mensalidades do responsável.
 *
 * A área financeira da empresa (`/financial/invoices`) é restrita à gestão — e
 * deve ser: ela expõe o faturamento inteiro. O que o responsável pode ver são
 * as cobranças dos PRÓPRIOS filhos, e o caminho legítimo para isso é a rota de
 * portabilidade da LGPD, que o servidor já escopa por `parentId`.
 *
 * A pergunta dele é "eu devo alguma coisa?" — então a tela responde isso antes
 * de listar. Somas em centavos, nunca em reais com ponto flutuante.
 */
export function ParentInvoices() {
  const [page, setPage] = useState(1);
  const hoje = today();

  const dados = useResource<ExportPayload>(
    (signal) => api.get('/privacy/export', { page, perPage: 10 }, signal),
    [page],
  );

  const alunos = dados.data?.alunos ?? [];
  const faturas = alunos.flatMap((a) => a.faturas);
  const temFatura = faturas.length > 0;

  const emAberto = faturas.filter((f) => f.status === 'PENDING' || f.status === 'OVERDUE');
  const vencidas = emAberto.filter((f) => f.status === 'OVERDUE' || f.vencimento.slice(0, 10) < hoje);
  const totalAberto = emAberto.reduce((acc, f) => acc + f.valor.cents, 0);
  const totalVencido = vencidas.reduce((acc, f) => acc + f.valor.cents, 0);

  return (
    <div>
      <PageHeader
        title="Mensalidades"
        description="Cobranças emitidas para os seus filhos, com valor, vencimento e situação."
      />

      <div className="flex flex-col gap-4">
        {dados.loading ? <SkeletonAnswer /> : null}
        {dados.error ? <ErrorState message={dados.error} onRetry={dados.reload} /> : null}

        {dados.data && temFatura ? (
          <Answer
            question="Você tem alguma mensalidade em aberto?"
            tone={totalVencido > 0 ? 'loss' : totalAberto > 0 ? 'warn' : 'good'}
            value={
              totalAberto === 0 ? 'Está tudo pago' : formatCents(totalAberto)
            }
            detail={
              totalAberto === 0
                ? 'Nenhuma cobrança em aberto entre as mensalidades listadas nesta página.'
                : totalVencido > 0
                  ? `${emAberto.length} em aberto, sendo ${vencidas.length} já vencida(s), somando ${formatCents(totalVencido)} em atraso.`
                  : `${emAberto.length} cobrança(s) aguardando pagamento, ainda dentro do prazo.`
            }
          />
        ) : null}

        {dados.data && dados.data.manifesto.totalPartes > 1 ? (
          <Callout title="Valores desta página">
            Suas cobranças estão divididas em {dados.data.manifesto.totalPartes} páginas e a soma
            acima considera apenas a página {dados.data.manifesto.parte}. Use a navegação no fim da
            lista para ver as demais.
          </Callout>
        ) : null}

        {dados.loading ? <SkeletonList rows={3} /> : null}

        {dados.data && !temFatura ? (
          <EmptyState
            icon={<Receipt size={26} />}
            title="Nenhuma mensalidade emitida"
            description="Quando a empresa de transporte gerar uma cobrança para o seu filho, ela aparece aqui com valor e vencimento. Pagamentos combinados fora do sistema podem não constar — nesse caso, confirme direto com a empresa."
          />
        ) : null}

        {dados.data && temFatura ? (
          <>
            {alunos
              .filter((a) => a.faturas.length > 0)
              .map((aluno) => (
                <Card key={aluno.id}>
                  <h2 className="text-base font-semibold text-ink-50">{aluno.name}</h2>
                  <p className="text-sm text-ink-400">{aluno.school || 'Escola não informada'}</p>
                  <ul className="mt-3 flex flex-col gap-2">
                    {aluno.faturas.map((f) => {
                      const atrasada =
                        f.status === 'OVERDUE' ||
                        (f.status === 'PENDING' && f.vencimento.slice(0, 10) < hoje);
                      return (
                        <li
                          key={f.id}
                          className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-ink-800 px-3 py-2.5"
                        >
                          <div>
                            <p
                              className={`tnum text-base font-semibold ${
                                f.status === 'RECEIVED'
                                  ? 'text-ink-50'
                                  : atrasada
                                    ? 'text-loss'
                                    : 'text-ink-50'
                              }`}
                            >
                              {f.valor.formatted}
                            </p>
                            <p className="tnum text-xs text-ink-400">
                              {atrasada ? 'Venceu em' : 'Vence em'} {formatDate(f.vencimento)}
                            </p>
                          </div>
                          <Badge
                            tone={
                              f.status === 'RECEIVED' ? 'good' : atrasada ? 'bad' : 'warn'
                            }
                          >
                            {label.invoiceStatus(atrasada && f.status === 'PENDING' ? 'OVERDUE' : f.status)}
                          </Badge>
                        </li>
                      );
                    })}
                  </ul>
                </Card>
              ))}

            <Pagination
              page={dados.data.manifesto.parte}
              totalPages={dados.data.manifesto.totalPartes}
              total={dados.data.manifesto.totalRegistros}
              onChange={setPage}
            />
          </>
        ) : null}
      </div>
    </div>
  );
}
