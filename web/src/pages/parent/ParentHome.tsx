import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  Bus,
  Home,
  MapPin,
  MessageSquare,
  RefreshCw,
  UserRound,
  Wifi,
  WifiOff,
} from 'lucide-react';

import { api } from '../../lib/api';
import { formatDateTime, label } from '../../lib/format';
import { useResource } from '../../hooks/useResource';
import { useRealtime } from '../../hooks/useRealtime';
import { photoSrc } from '../../components/PhotoUpload';
import {
  Badge,
  Button,
  Card,
  Callout,
  EmptyState,
  ErrorState,
  PageHeader,
  SectionTitle,
  SkeletonAnswer,
  SkeletonList,
} from '../../components/ui';
import type { Note, Paginated, Student, StudentStatus } from '../../lib/types';

/**
 * Acompanhamento do responsável.
 *
 * Esta é a pessoa mais ansiosa do produto e a que menos entende de sistema.
 * Ela abre o app com UMA pergunta na cabeça — "cadê meu filho?" — e a tela
 * responde essa pergunta em uma frase, em português comum, antes de qualquer
 * outra coisa. Nada de "status: BOARDED"; a frase é "a Marina está na van".
 *
 * O que a tela NÃO faz é fingir. A API não expõe a frota ao responsável, então
 * não existe mapa aqui: em vez de um mapa parado que ele leria como "a van não
 * saiu", a tela diz exatamente o que sabe e o que não sabe.
 */

interface Situacao {
  frase: (nome: string) => string;
  explicacao: string;
  tone: 'neutral' | 'good' | 'bad' | 'warn' | 'brand';
  Icone: typeof Bus;
}

const SITUACAO: Record<StudentStatus, Situacao> = {
  PENDING: {
    frase: (nome) => `${nome} ainda não embarcou`,
    explicacao:
      'A van ainda não passou, ou o monitor ainda não marcou o embarque. Assim que marcar, esta tela muda sozinha.',
    tone: 'neutral',
    Icone: Home,
  },
  BOARDED: {
    frase: (nome) => `${nome} está na van`,
    explicacao: 'O monitor confirmou o embarque. A entrega é marcada quando a van chegar ao destino.',
    tone: 'brand',
    Icone: Bus,
  },
  DELIVERED: {
    frase: (nome) => `${nome} já foi entregue`,
    explicacao: 'A equipe confirmou a chegada ao destino desta viagem.',
    tone: 'good',
    Icone: Home,
  },
  ABSENT: {
    frase: (nome) => `${nome} foi marcado como ausente`,
    explicacao:
      'A equipe registrou que a criança não embarcou nesta viagem. Se não foi combinado, fale com a empresa de transporte.',
    tone: 'bad',
    Icone: AlertTriangle,
  },
};

/** Primeiro nome — é assim que a mãe pensa no filho, não pelo nome completo. */
function primeiroNome(nome: string): string {
  return nome.trim().split(/\s+/)[0] ?? nome;
}

/** Observações que a equipe deixou sobre a criança. Notas sigilosas nunca vêm. */
function Observacoes({ studentId, nome }: { studentId: string; nome: string }) {
  const notas = useResource<Paginated<Note>>(
    (signal) => api.get(`/crm/students/${studentId}/notes`, { perPage: 5 }, signal),
    [studentId],
  );

  if (notas.loading) return <SkeletonList rows={1} />;
  // Falha aqui não vira alarme: o recado principal (onde a criança está) já foi
  // dado acima, e um erro vermelho assustaria sem motivo.
  if (notas.error || !notas.data || notas.data.items.length === 0) return null;

  return (
    <div className="mt-4 border-t border-ink-700 pt-4">
      <p className="flex items-center gap-2 text-sm font-medium text-ink-200">
        <MessageSquare aria-hidden="true" size={16} className="text-brand-600" />
        Recados da equipe sobre {nome}
      </p>
      <ul className="mt-2 flex flex-col gap-2">
        {notas.data.items.map((nota) => (
          <li key={nota.id} className="rounded-xl bg-ink-800 px-3 py-2.5">
            <p className="text-sm text-ink-200">{nota.content}</p>
            <p className="mt-1 text-xs text-ink-400">{formatDateTime(nota.createdAt)}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ParentHome() {
  const [atualizadoEm, setAtualizadoEm] = useState(() => new Date());

  const filhos = useResource<Paginated<Student>>(
    (signal) => api.get('/students', { perPage: 20 }, signal),
    [],
  );

  // O responsável não enxerga a frota (`/vehicles` é restrito à operação), então
  // não há id de veículo para assinar. A conexão existe para receber os avisos
  // da empresa, que valem para todo mundo.
  const { connected, incidents } = useRealtime([]);

  const recarregar = () => {
    filhos.reload();
    setAtualizadoEm(new Date());
  };

  const itens = filhos.data?.items ?? [];

  return (
    <div>
      <PageHeader
        title="Acompanhar"
        description="Onde cada criança está agora, segundo o que a equipe da van registrou."
        actions={
          <Button variant="secondary" onClick={recarregar} disabled={filhos.loading}>
            <RefreshCw aria-hidden="true" size={16} />
            Atualizar
          </Button>
        }
      />

      <div className="flex flex-col gap-4">
        {incidents.length > 0 ? (
          <Callout tone="bad" title="Aviso da empresa de transporte">
            <ul className="mt-1 flex flex-col gap-2">
              {incidents.map((i) => (
                <li key={i.id}>
                  <p className="font-medium">{i.title}</p>
                  <p className="opacity-90">{i.description}</p>
                </li>
              ))}
            </ul>
          </Callout>
        ) : null}

        {filhos.loading ? <SkeletonAnswer /> : null}
        {filhos.error ? <ErrorState message={filhos.error} onRetry={recarregar} /> : null}

        {filhos.data && itens.length === 0 ? (
          <EmptyState
            icon={<UserRound size={26} />}
            title="Nenhuma criança vinculada ao seu acesso"
            description="A empresa de transporte precisa vincular o cadastro do seu filho ao seu usuário. Enquanto isso não for feito, não há o que acompanhar aqui. Peça esse vínculo a quem cuida do cadastro na empresa."
          />
        ) : null}

        {itens.map((aluno) => {
          const nome = primeiroNome(aluno.name);
          const situacao = SITUACAO[aluno.status];
          return (
            <Card key={aluno.id}>
              <div className="flex items-start gap-4">
                {photoSrc(aluno.photoUrl) ? (
                  <img
                    src={photoSrc(aluno.photoUrl) ?? ''}
                    alt={`Foto de ${aluno.name}`}
                    className="h-16 w-16 shrink-0 rounded-2xl border border-ink-700 object-cover"
                  />
                ) : (
                  <span
                    aria-hidden="true"
                    className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-ink-800 text-ink-400"
                  >
                    <UserRound size={28} />
                  </span>
                )}

                <div className="min-w-0 flex-1">
                  <p className="text-sm text-ink-400">
                    {aluno.school || 'Escola não informada'} · {label.shift(aluno.shift)}
                  </p>
                  <h2
                    className={`mt-1 text-xl font-semibold sm:text-2xl ${
                      situacao.tone === 'good'
                        ? 'text-good-400'
                        : situacao.tone === 'bad'
                          ? 'text-bad-400'
                          : situacao.tone === 'brand'
                            ? 'text-brand-600'
                            : 'text-ink-50'
                    }`}
                  >
                    {situacao.frase(nome)}
                  </h2>
                  <p className="mt-1.5 text-sm leading-relaxed text-ink-400">
                    {situacao.explicacao}
                  </p>
                  <div className="mt-3">
                    <Badge tone={situacao.tone}>
                      <situacao.Icone aria-hidden="true" size={12} />
                      {label.studentStatus(aluno.status)}
                    </Badge>
                  </div>
                </div>
              </div>

              <Observacoes studentId={aluno.id} nome={nome} />
            </Card>
          );
        })}

        {itens.length > 0 ? (
          <Card>
            <SectionTitle icon={<MapPin size={18} />}>Por que não há mapa aqui</SectionTitle>
            <p className="text-sm leading-relaxed text-ink-400">
              A localização da van é enviada em tempo real dentro da empresa de transporte, mas o
              seu acesso não inclui a lista de veículos — então não há como saber qual van é a do
              seu filho. Preferimos dizer isso a mostrar um mapa que nunca se move: você leria o
              mapa parado como "a van não saiu", e não é isso que ele significaria.
            </p>
            <p
              className="mt-3 flex items-center gap-2 text-xs text-ink-400"
              aria-live="polite"
            >
              {connected ? (
                <>
                  <Wifi aria-hidden="true" size={14} className="text-good-400" />
                  Conectado — avisos urgentes da empresa chegam nesta tela na hora.
                </>
              ) : (
                <>
                  <WifiOff aria-hidden="true" size={14} />
                  Sem conexão em tempo real. A situação acima é a do último carregamento, às{' '}
                  {atualizadoEm.toLocaleTimeString('pt-BR', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                  .
                </>
              )}
            </p>
          </Card>
        ) : null}

        <Card>
          <SectionTitle>Outras coisas suas</SectionTitle>
          <ul className="flex flex-col gap-2">
            <li>
              <Link
                to="/app/faturas"
                className="flex min-h-[52px] items-center justify-between gap-3 rounded-xl bg-ink-800 px-3 py-2.5 text-sm text-ink-200 transition-colors hover:bg-ink-700"
              >
                Mensalidades e comprovantes
                <span aria-hidden="true" className="text-brand-600">
                  →
                </span>
              </Link>
            </li>
            <li>
              <Link
                to="/app/privacidade"
                className="flex min-h-[52px] items-center justify-between gap-3 rounded-xl bg-ink-800 px-3 py-2.5 text-sm text-ink-200 transition-colors hover:bg-ink-700"
              >
                Meus dados e os do meu filho (LGPD)
                <span aria-hidden="true" className="text-brand-600">
                  →
                </span>
              </Link>
            </li>
          </ul>
        </Card>
      </div>
    </div>
  );
}
