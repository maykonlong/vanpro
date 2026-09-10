import { useMemo, useState } from 'react';
import { CheckCircle2, CircleSlash, Home, UserRound, Users } from 'lucide-react';

import { api } from '../lib/api';
import { label } from '../lib/format';
import { useAction, useResource } from '../hooks/useResource';
import { photoSrc } from './PhotoUpload';
import {
  Answer,
  Badge,
  Button,
  Callout,
  Card,
  EmptyState,
  ErrorState,
  InlineError,
  PageHeader,
  Segmented,
  SkeletonAnswer,
  SkeletonList,
} from './ui';
import type { Paginated, Shift, Student, StudentStatus } from '../lib/types';

/**
 * Lista de embarque — a tela do motorista e do monitor.
 *
 * As duas pessoas usam isto no celular, com pressa, em pé, uma mão só. As
 * decisões de desenho vêm todas daí:
 *
 * - a resposta vem primeiro: "faltam 6 dos 18", e não uma tabela de 18 linhas
 *   que obriga a contar;
 * - cada aluno tem no máximo duas ações, ambas com alvo grande;
 * - o filtro é botão, não `<select>`: um toque em vez de três;
 * - a lista inteira do turno vem de uma vez e o filtro é local, porque trocar
 *   de aba no meio da rua não pode depender de rede;
 * - a marcação é otimista: o cartão muda na hora e volta atrás se o servidor
 *   recusar. Esperar o servidor com a van andando é como perder a batida.
 */

/** O próximo passo de cada estado. Espelha o que a API aceita em `/checkin`. */
const PROXIMO: Record<StudentStatus, Array<{ status: StudentStatus; texto: string }>> = {
  PENDING: [
    { status: 'BOARDED', texto: 'Embarcou' },
    { status: 'ABSENT', texto: 'Faltou' },
  ],
  BOARDED: [
    { status: 'DELIVERED', texto: 'Entreguei' },
    { status: 'PENDING', texto: 'Desfazer' },
  ],
  DELIVERED: [{ status: 'PENDING', texto: 'Desfazer' }],
  ABSENT: [{ status: 'PENDING', texto: 'Desfazer' }],
};

const TOM: Record<StudentStatus, 'neutral' | 'good' | 'bad' | 'warn'> = {
  PENDING: 'neutral',
  BOARDED: 'warn',
  DELIVERED: 'good',
  ABSENT: 'bad',
};

type Aba = 'TODOS' | StudentStatus;
type TurnoFiltro = '' | Shift;

const TURNOS: ReadonlyArray<{ value: TurnoFiltro; text: string }> = [
  { value: '', text: 'Todos' },
  { value: 'MORNING', text: 'Manhã' },
  { value: 'AFTERNOON', text: 'Tarde' },
  { value: 'FULL', text: 'Integral' },
];

const LIMITE = 100;

export function BoardingList({ titulo, descricao }: { titulo: string; descricao: string }) {
  const [turno, setTurno] = useState<TurnoFiltro>('');
  const [aba, setAba] = useState<Aba>('TODOS');

  const lista = useResource<Paginated<Student>>(
    (signal) => api.get('/students', { perPage: LIMITE, shift: turno }, signal),
    [turno],
  );
  const checkin = useAction();

  // Memorizado junto com o resultado: sem isto o array novo a cada render
  // invalidaria a contagem abaixo em toda passagem.
  const itens = useMemo(() => lista.data?.items ?? [], [lista.data]);

  const contagem = useMemo(() => {
    const base: Record<StudentStatus, number> = {
      PENDING: 0,
      BOARDED: 0,
      DELIVERED: 0,
      ABSENT: 0,
    };
    for (const aluno of itens) base[aluno.status] += 1;
    return base;
  }, [itens]);

  const visiveis = aba === 'TODOS' ? itens : itens.filter((a) => a.status === aba);

  const onCheckin = async (aluno: Student, status: StudentStatus) => {
    const anterior = lista.data;
    if (!anterior) return;

    // Otimista: o cartão muda na hora. Se o servidor recusar, volta ao estado
    // anterior e o erro aparece — em vez de a tela ficar parada esperando.
    lista.setData({
      ...anterior,
      items: anterior.items.map((a) => (a.id === aluno.id ? { ...a, status } : a)),
    });

    const atualizado = await checkin.run(() =>
      api.patch<Student>(`/students/${aluno.id}/checkin`, { status }),
    );

    if (!atualizado) {
      lista.setData(anterior);
      return;
    }
    // Reconcilia com o que o servidor devolveu: ele é a fonte da verdade, e o
    // otimismo acima foi só um adiantamento visual.
    lista.setData({
      ...anterior,
      items: anterior.items.map((a) => (a.id === aluno.id ? atualizado : a)),
    });
  };

  const total = itens.length;
  const resolvidos = contagem.DELIVERED + contagem.ABSENT;
  const faltam = total - resolvidos;

  return (
    <div>
      <PageHeader title={titulo} description={descricao} />

      <div className="flex flex-col gap-4">
        {lista.loading ? <SkeletonAnswer /> : null}
        {lista.error ? <ErrorState message={lista.error} onRetry={lista.reload} /> : null}

        {lista.data && total > 0 ? (
          <Answer
            question={
              turno === '' ? 'Como está a rota de hoje' : `Como está o turno da ${TURNOS.find((t) => t.value === turno)?.text.toLowerCase()}`
            }
            tone={faltam === 0 ? 'good' : 'neutral'}
            value={
              faltam === 0
                ? 'Rota concluída'
                : `Faltam ${faltam} de ${total}`
            }
            detail={
              faltam === 0
                ? `Todos os ${total} alunos deste turno já foram entregues ou marcados como ausentes.`
                : `${contagem.DELIVERED} entregues · ${contagem.BOARDED} dentro da van · ${contagem.ABSENT} faltaram · ${contagem.PENDING} ainda não embarcaram.`
            }
            footer={
              <div
                aria-hidden="true"
                className="flex h-2 overflow-hidden rounded-full bg-ink-800"
                title={`${resolvidos} de ${total} resolvidos`}
              >
                <div
                  className="bg-good-400"
                  style={{ width: `${(contagem.DELIVERED / total) * 100}%` }}
                />
                <div
                  className="bg-brand-500"
                  style={{ width: `${(contagem.BOARDED / total) * 100}%` }}
                />
                <div
                  className="bg-danger-strong"
                  style={{ width: `${(contagem.ABSENT / total) * 100}%` }}
                />
              </div>
            }
          />
        ) : null}

        {lista.data && lista.data.meta.total > LIMITE ? (
          <Callout title="Lista parcial">
            Esta frota tem {lista.data.meta.total} alunos e a tela mostra os {LIMITE} primeiros.
            Filtre por turno para trabalhar com a lista da sua rota.
          </Callout>
        ) : null}

        {lista.data && total > 0 ? (
          <Card className="flex flex-col gap-3">
            <Segmented label="Filtrar por turno" value={turno} options={TURNOS} onChange={setTurno} />
            <Segmented
              label="Filtrar por situação"
              value={aba}
              onChange={setAba}
              options={[
                { value: 'TODOS', text: 'Todos', count: total },
                { value: 'PENDING', text: 'A embarcar', count: contagem.PENDING },
                { value: 'BOARDED', text: 'Na van', count: contagem.BOARDED },
                { value: 'DELIVERED', text: 'Entregues', count: contagem.DELIVERED },
                { value: 'ABSENT', text: 'Faltaram', count: contagem.ABSENT },
              ]}
            />
          </Card>
        ) : null}

        <InlineError message={checkin.error} />

        {lista.loading ? <SkeletonList rows={4} /> : null}

        {lista.data && total === 0 ? (
          <EmptyState
            icon={<Users size={26} />}
            title="Nenhum aluno neste turno"
            description="Quando a gestão cadastrar alunos com este turno, eles aparecem aqui para você marcar embarque e entrega."
            action={
              turno !== '' ? (
                <Button variant="secondary" onClick={() => setTurno('')}>
                  Ver todos os turnos
                </Button>
              ) : undefined
            }
          />
        ) : null}

        {lista.data && total > 0 && visiveis.length === 0 ? (
          <EmptyState
            icon={<CheckCircle2 size={26} />}
            title="Nada nesta situação"
            description="Nenhum aluno do turno está nesta etapa agora. Troque o filtro acima para ver os demais."
            action={
              <Button variant="secondary" onClick={() => setAba('TODOS')}>
                Ver todos
              </Button>
            }
          />
        ) : null}

        {visiveis.length > 0 ? (
          <ul className="flex flex-col gap-2.5">
            {visiveis.map((aluno) => (
              <Card as="li" key={aluno.id} className="flex flex-col gap-3">
                <div className="flex items-center gap-3">
                  {photoSrc(aluno.photoUrl) ? (
                    <img
                      src={photoSrc(aluno.photoUrl) ?? ''}
                      alt={`Foto de ${aluno.name}`}
                      className="h-12 w-12 shrink-0 rounded-full border border-ink-700 object-cover"
                    />
                  ) : (
                    <span
                      aria-hidden="true"
                      className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-ink-800 text-ink-400"
                    >
                      <UserRound size={22} />
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-base font-semibold text-ink-50">{aluno.name}</p>
                    <p className="truncate text-sm text-ink-400">
                      {aluno.school || 'Escola não informada'} · {label.shift(aluno.shift)}
                    </p>
                  </div>
                  <Badge tone={TOM[aluno.status]}>
                    {aluno.status === 'DELIVERED' ? <Home aria-hidden="true" size={12} /> : null}
                    {aluno.status === 'ABSENT' ? (
                      <CircleSlash aria-hidden="true" size={12} />
                    ) : null}
                    {label.studentStatus(aluno.status)}
                  </Badge>
                </div>

                <div className="flex gap-2">
                  {PROXIMO[aluno.status].map((acao, indice) => (
                    <Button
                      key={acao.status}
                      variant={
                        acao.texto === 'Desfazer'
                          ? 'ghost'
                          : acao.status === 'ABSENT'
                            ? 'secondary'
                            : 'primary'
                      }
                      size={indice === 0 && acao.texto !== 'Desfazer' ? 'lg' : 'md'}
                      block={indice === 0}
                      disabled={checkin.pending}
                      onClick={() => void onCheckin(aluno, acao.status)}
                    >
                      {acao.texto}
                      <span className="sr-only"> — {aluno.name}</span>
                    </Button>
                  ))}
                </div>
              </Card>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
