import { useState } from 'react';
import { CalendarRange, Wallet } from 'lucide-react';

import { api } from '../../lib/api';
import { currentMonth, formatDate, label } from '../../lib/format';
import { useResource } from '../../hooks/useResource';
import {
  Answer,
  Badge,
  Card,
  EmptyState,
  ErrorState,
  PageHeader,
  SectionTitle,
  SkeletonAnswer,
  SkeletonList,
  Stat,
  TextInput,
} from '../../components/ui';
import type { Charter, DriverEarnings, Paginated, Timecard } from '../../lib/types';

/**
 * Holerite do próprio motorista.
 *
 * A pergunta dele é uma só: "quanto eu tenho a receber este mês?". Então é
 * isso que abre a tela, em corpo grande — e a memória de cálculo (diária ×
 * dias, mais os fretamentos) vem logo abaixo, porque ele confere.
 *
 * O id do cadastro NÃO é digitado nem lido da URL. Ele é descoberto pelas
 * listas que o servidor já devolve escopadas ao motorista logado (ponto e
 * fretamento) — a rota de motoristas é exclusiva da gestão, então pedi-la aqui
 * daria 403. Pedir o holerite de outra pessoa devolve 404 pelo servidor; esta
 * tela não é a fronteira de segurança.
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

  const carregando = perfil.loading || ganhos.loading;

  return (
    <div>
      <PageHeader
        title="Meus ganhos"
        description="Suas diárias e os fretamentos que você atendeu. O faturamento da empresa não aparece aqui."
      />

      <div className="flex flex-col gap-4">
        <Card>
          <div className="max-w-[16rem]">
            <TextInput
              label="Mês de referência"
              name="month"
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              hint="A apuração usa os cartões de ponto encerrados no mês escolhido."
            />
          </div>
        </Card>

        {carregando ? <SkeletonAnswer /> : null}
        {perfil.error ? <ErrorState message={perfil.error} onRetry={perfil.reload} /> : null}
        {ganhos.error ? <ErrorState message={ganhos.error} onRetry={ganhos.reload} /> : null}

        {!perfil.loading && !perfil.error && !driverId ? (
          <EmptyState
            icon={<Wallet size={26} />}
            title="Ainda não há como apurar seus ganhos"
            description="O holerite é montado a partir dos seus cartões de ponto e dos seus fretamentos. Registre a primeira jornada em Ponto, ou peça à gestão para vincular o seu acesso ao cadastro de motorista desta frota."
          />
        ) : null}

        {ganhos.data ? (
          <>
            <Answer
              question={`Quanto você tem a receber em ${new Date(`${month}-02T00:00:00`).toLocaleDateString(
                'pt-BR',
                { month: 'long', year: 'numeric' },
              )}`}
              tone={ganhos.data.total.cents > 0 ? 'gain' : 'neutral'}
              value={ganhos.data.total.formatted}
              detail={
                ganhos.data.total.cents === 0
                  ? 'Nenhuma jornada encerrada e nenhum fretamento concluído neste mês. O valor sobe conforme você bate a saída de cada dia.'
                  : `${ganhos.data.workedDays} ${
                      ganhos.data.workedDays === 1 ? 'dia trabalhado' : 'dias trabalhados'
                    } a ${ganhos.data.dailyRate.formatted} de diária, somando ${ganhos.data.dailies.formatted}, mais os fretamentos do período.`
              }
            />

            <div className="grid gap-3 sm:grid-cols-3">
              <Stat label="Valor da diária" value={ganhos.data.dailyRate.formatted} />
              <Stat
                label="Dias trabalhados"
                value={ganhos.data.workedDays}
                hint="Cartões de ponto encerrados no mês."
              />
              <Stat
                label="Só das diárias"
                value={ganhos.data.dailies.formatted}
                tone={ganhos.data.dailies.cents > 0 ? 'gain' : 'neutral'}
                hint="Sem os fretamentos."
              />
            </div>

            <Card>
              <SectionTitle icon={<CalendarRange size={18} />}>Fretamentos no mês</SectionTitle>
              {ganhos.data.charters.length === 0 ? (
                <p className="rounded-xl border border-dashed border-ink-700 px-4 py-6 text-center text-sm text-ink-400">
                  Nenhum fretamento atribuído a você neste mês.
                </p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {ganhos.data.charters.map((c) => (
                    <li
                      key={c.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-ink-800 px-3 py-2.5"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-ink-50">
                          {c.title}
                        </span>
                        <span className="tnum block text-xs text-ink-400">
                          {formatDate(c.startDate)} a {formatDate(c.endDate)}
                        </span>
                      </span>
                      <Badge tone={c.status === 'COMPLETED' ? 'good' : 'neutral'}>
                        {label.charterStatus(c.status)}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </>
        ) : null}

        {!carregando && !ganhos.data && driverId ? <SkeletonList rows={1} /> : null}
      </div>
    </div>
  );
}
