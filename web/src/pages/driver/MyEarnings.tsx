import { useState } from 'react';
import { Wallet } from 'lucide-react';

import { api } from '../../lib/api';
import { currentMonth, formatDate, label } from '../../lib/format';
import { useResource } from '../../hooks/useResource';
import {
  Card,
  EmptyState,
  ErrorState,
  PageHeader,
  SkeletonList,
  TextInput,
} from '../../components/ui';
import type { Charter, DriverEarnings, Paginated, Timecard } from '../../lib/types';

/**
 * Holerite do proprio motorista.
 *
 * O id do cadastro NAO e digitado nem lido da URL. Ele e descoberto pelas
 * listas que o servidor ja devolve escopadas ao motorista logado (ponto e
 * fretamento) — a rota de motoristas e exclusiva da gestao, entao pedi-la aqui
 * daria 403. Pedir o holerite de outra pessoa devolve 404 pelo servidor; esta
 * tela nao e a fronteira de seguranca.
 */
export function MyEarnings() {
  const [month, setMonth] = useState(currentMonth());

  const perfil = useResource<string | null>(async (signal) => {
    const [pontos, fretamentos] = await Promise.all([
      api.get<Paginated<Timecard>>('/timecards', { perPage: 1 }, signal),
      api.get<Paginated<Charter>>('/charters', { perPage: 1 }, signal),
    ]);
    return pontos.items[0]?.driverId ?? fretamentos.items[0]?.driverId ?? null;
  }, []);

  const driverId = perfil.data ?? null;

  const ganhos = useResource<DriverEarnings | null>(
    async (signal) => {
      if (!driverId) return null;
      return api.get<DriverEarnings>(`/drivers/${driverId}/earnings`, { month }, signal);
    },
    [driverId, month],
  );

  return (
    <div>
      <PageHeader
        title="Meus ganhos"
        description="Diárias do mês e fretamentos que você atendeu. Faturamento da empresa não aparece aqui."
      />

      <Card className="mb-4">
        <div className="w-56">
          <TextInput
            label="Mês"
            name="month"
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
          />
        </div>
      </Card>

      {perfil.loading || ganhos.loading ? <SkeletonList rows={3} /> : null}
      {perfil.error ? <ErrorState message={perfil.error} onRetry={perfil.reload} /> : null}
      {ganhos.error ? <ErrorState message={ganhos.error} onRetry={ganhos.reload} /> : null}

      {!perfil.loading && !perfil.error && !driverId ? (
        <EmptyState
          icon={<Wallet size={30} />}
          title="Ainda não há como apurar seus ganhos"
          description="O holerite é montado a partir dos seus cartões de ponto e fretamentos. Registre a primeira jornada, ou peça à gestão para vincular seu acesso ao cadastro de motorista."
        />
      ) : null}

      {ganhos.data ? (
        <div className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <Card>
              <p className="text-xs uppercase tracking-wide text-ink-400">Diária</p>
              <p className="mt-2 text-xl font-semibold text-ink-50">{ganhos.data.dailyRate.formatted}</p>
            </Card>
            <Card>
              <p className="text-xs uppercase tracking-wide text-ink-400">Dias trabalhados</p>
              <p className="mt-2 text-xl font-semibold text-ink-50">{ganhos.data.workedDays}</p>
              <p className="mt-1 text-xs text-ink-400">Cartões de ponto encerrados no mês.</p>
            </Card>
            <Card>
              <p className="text-xs uppercase tracking-wide text-ink-400">Total do mês</p>
              <p className="mt-2 text-xl font-semibold text-good-400" data-testid="ganhos-total">
                {ganhos.data.total.formatted}
              </p>
            </Card>
          </div>

          <Card>
            <h2 className="mb-3 text-base font-semibold text-ink-50">Fretamentos no mês</h2>
            {ganhos.data.charters.length === 0 ? (
              <p className="text-sm text-ink-400">
                Nenhum fretamento atribuído a você neste mês.
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {ganhos.data.charters.map((c) => (
                  <li key={c.id} className="flex justify-between gap-3 rounded-lg bg-ink-800 px-3 py-2">
                    <span className="text-sm text-ink-50">{c.title}</span>
                    <span className="text-xs text-ink-400">
                      {formatDate(c.startDate)} · {label.charterStatus(c.status)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      ) : null}
    </div>
  );
}
