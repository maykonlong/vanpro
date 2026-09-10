import { Link } from 'react-router-dom';
import { CalendarRange, Clock, LogIn } from 'lucide-react';

import { api } from '../../lib/api';
import { formatDate, formatTime, label } from '../../lib/format';
import { useResource } from '../../hooks/useResource';
import { BoardingList } from '../../components/BoardingList';
import {
  Badge,
  Button,
  Card,
  ErrorState,
  SectionTitle,
  Skeleton,
  SkeletonList,
} from '../../components/ui';
import type { Charter, Paginated, Punch, Timecard } from '../../lib/types';

/**
 * Rota do dia — a primeira tela do motorista.
 *
 * A ordem segue o dia dele: primeiro o ponto (é a ação das 6h), depois a lista
 * de embarque (o trabalho em si), e por último os fretamentos (o que vem
 * depois). Fretamento em cima da lista de embarque seria uma rolagem a mais
 * entre ele e a criança esperando na calçada.
 */

function pausaAberta(punches: Punch[]): boolean {
  const inicios = punches.filter((p) => p.type === 'BREAK_START').length;
  const fins = punches.filter((p) => p.type === 'BREAK_END').length;
  return inicios > fins;
}

/**
 * Faixa do ponto.
 *
 * Não duplica a tela de ponto: só diz onde ele está e leva até lá. Um segundo
 * botão de "bater entrada" aqui criaria duas verdades sobre o mesmo cartão.
 */
function FaixaDoPonto() {
  const cartoes = useResource<Paginated<Timecard>>(
    (signal) => api.get('/timecards', { perPage: 5, status: 'IN_PROGRESS' }, signal),
    [],
  );

  if (cartoes.loading) return <Skeleton className="h-[88px] w-full" />;
  // Erro aqui não vira alarme: a lista de embarque abaixo é o que importa, e a
  // tela de ponto continua alcançável pelo menu.
  if (cartoes.error || !cartoes.data) return null;

  const aberto = cartoes.data.items[0];
  const entrada = aberto?.punches.find((p) => p.type === 'CLOCK_IN');
  const emPausa = aberto ? pausaAberta(aberto.punches) : false;

  return (
    <Card className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="flex items-center gap-2 text-sm font-medium text-ink-400">
          <Clock aria-hidden="true" size={16} />
          Seu ponto
        </p>
        <p className="mt-1 text-lg font-semibold text-ink-50">
          {!aberto ? 'Você ainda não bateu a entrada' : emPausa ? 'Você está em pausa' : 'Turno aberto'}
        </p>
        {entrada && !emPausa ? (
          <p className="tnum mt-0.5 text-sm text-ink-400">
            Entrada registrada às {formatTime(entrada.createdAt)}.
          </p>
        ) : null}
      </div>
      <Link to="/app/ponto" className="shrink-0">
        <Button variant={aberto ? 'secondary' : 'primary'}>
          {!aberto ? <LogIn aria-hidden="true" size={18} /> : null}
          {aberto ? 'Ver meu ponto' : 'Bater entrada'}
        </Button>
      </Link>
    </Card>
  );
}

/** Fretamentos escalados para este motorista — a API já filtra pelo perfil dele. */
function MeusFretamentos() {
  const fretamentos = useResource<Paginated<Charter>>(
    (signal) => api.get('/charters', { perPage: 10 }, signal),
    [],
  );

  const proximos = (fretamentos.data?.items ?? []).filter(
    (c) => c.status === 'PENDING' || c.status === 'IN_PROGRESS',
  );

  return (
    <Card>
      <SectionTitle
        icon={<CalendarRange size={18} />}
        hint="Somente os contratos em que você foi escalado."
      >
        Meus fretamentos
      </SectionTitle>

      {fretamentos.loading ? <SkeletonList rows={2} /> : null}
      {fretamentos.error ? (
        <ErrorState message={fretamentos.error} onRetry={fretamentos.reload} />
      ) : null}

      {fretamentos.data && proximos.length === 0 ? (
        <p className="rounded-xl border border-dashed border-ink-700 px-4 py-6 text-center text-sm text-ink-400">
          Nenhum fretamento agendado para você. Quando a gestão escalar o seu nome em um contrato,
          ele aparece aqui com data e horário.
        </p>
      ) : null}

      {proximos.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {proximos.map((c) => (
            <li key={c.id} className="rounded-xl bg-ink-800 px-3 py-2.5">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-semibold text-ink-50">{c.title}</p>
                <Badge tone={c.status === 'IN_PROGRESS' ? 'good' : 'neutral'}>
                  {label.charterStatus(c.status)}
                </Badge>
              </div>
              <p className="tnum mt-1 text-xs text-ink-400">
                {formatDate(c.startDate)} às {formatTime(c.startDate)} · até {formatDate(c.endDate)}{' '}
                às {formatTime(c.endDate)}
              </p>
              <p className="mt-0.5 text-xs text-ink-400">Contratante: {c.contractor}</p>
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}

export function DriverRoute() {
  return (
    <div className="flex flex-col gap-4">
      <FaixaDoPonto />

      <BoardingList
        titulo="Rota do dia"
        descricao="Marque o embarque e a entrega de cada criança. Cada toque vira um registro com o seu nome e o horário."
      />

      <MeusFretamentos />
    </div>
  );
}
