import { useState } from 'react';
import type { FormEvent } from 'react';
import { Cake, MessageSquare, Megaphone } from 'lucide-react';

import { api, ApiError } from '../../lib/api';
import { formatDate, formatDateTime, label } from '../../lib/format';
import { useAction, useResource } from '../../hooks/useResource';
import { useFeatures } from '../../context/FeaturesContext';
import { useRealtime } from '../../hooks/useRealtime';
import { FeatureDisabledNotice } from '../../components/PermissionNotice';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  InlineError,
  PageHeader,
  Pagination,
  SelectInput,
  SkeletonList,
  TextArea,
  TextInput,
} from '../../components/ui';
import type {
  AiPost,
  Birthday,
  Campaign,
  Incident,
  Paginated,
  Severity,
  TeamMessage,
} from '../../lib/types';

type Aba = 'chat' | 'incidentes' | 'campanhas' | 'aniversarios';

function Chat() {
  const [page, setPage] = useState(1);
  const [content, setContent] = useState('');
  const list = useResource<Paginated<TeamMessage>>(
    (signal) => api.get('/crm/chat/messages', { page, perPage: 30 }, signal),
    [page],
  );
  const send = useAction();

  const onSend = async (event: FormEvent) => {
    event.preventDefault();
    if (!content.trim()) return;
    const done = await send.run(async () => {
      await api.post('/crm/chat/messages', { content: content.trim() });
      return true;
    });
    if (done) {
      setContent('');
      list.reload();
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {list.loading ? <SkeletonList rows={4} /> : null}
      {list.error ? <ErrorState message={list.error} onRetry={list.reload} /> : null}

      {list.data && list.data.items.length === 0 ? (
        <EmptyState
          icon={<MessageSquare size={28} />}
          title="Nenhuma mensagem ainda"
          description="Este é o canal interno da equipe. A assinatura vem do cadastro, não do que se digita: ninguém publica em nome de outra pessoa."
        />
      ) : null}

      {list.data && list.data.items.length > 0 ? (
        <>
          <ul className="flex flex-col gap-2">
            {list.data.items.map((m) => (
              <li key={m.id} className="rounded-lg bg-ink-800 px-3 py-2">
                <p className="text-sm text-ink-50">{m.content}</p>
                <p className="mt-1 text-xs text-ink-400">
                  {m.senderName} · {formatDateTime(m.createdAt)}
                </p>
              </li>
            ))}
          </ul>
          <Pagination
            page={list.data.meta.page}
            totalPages={list.data.meta.totalPages}
            total={list.data.meta.total}
            onChange={setPage}
          />
        </>
      ) : null}

      <Card>
        <form className="flex flex-col gap-3" onSubmit={onSend} noValidate>
          <InlineError message={send.error} />
          <TextArea
            label="Nova mensagem"
            name="content"
            required
            value={content}
            onChange={(e) => setContent(e.target.value)}
            error={send.fieldErrors.content}
          />
          <div className="flex justify-end">
            <Button type="submit" loading={send.pending}>
              Enviar
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}

function Incidentes() {
  const [page, setPage] = useState(1);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [severity, setSeverity] = useState<Severity>('MEDIUM');

  const list = useResource<Paginated<Incident>>(
    (signal) => api.get('/crm/incidents', { page, perPage: 20 }, signal),
    [page],
  );
  const broadcast = useAction();
  // Incidente disparado por outra pessoa chega por socket sem recarregar a tela.
  const { incidents: aoVivo, connected } = useRealtime([]);

  const onBroadcast = async (event: FormEvent) => {
    event.preventDefault();
    const done = await broadcast.run(async () => {
      await api.post('/crm/incidents/broadcast', {
        title: title.trim(),
        description: description.trim(),
        severity,
      });
      return true;
    });
    if (done) {
      setTitle('');
      setDescription('');
      list.reload();
    }
  };

  const vistos = new Set(list.data?.items.map((i) => i.id) ?? []);
  const novos = aoVivo.filter((i) => !vistos.has(i.id));

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <form className="flex flex-col gap-3" onSubmit={onBroadcast} noValidate>
          <h2 className="text-base font-semibold text-ink-50">Disparar alerta para a equipe</h2>
          <InlineError message={broadcast.error} />
          <TextInput
            label="Título"
            name="title"
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            error={broadcast.fieldErrors.title}
          />
          <TextArea
            label="Descrição"
            name="description"
            required
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            error={broadcast.fieldErrors.description}
          />
          <SelectInput
            label="Gravidade"
            name="severity"
            value={severity}
            onChange={(e) => setSeverity(e.target.value as Severity)}
          >
            <option value="LOW">Baixa</option>
            <option value="MEDIUM">Média</option>
            <option value="HIGH">Alta</option>
            <option value="CRITICAL">Crítica</option>
          </SelectInput>
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-ink-400">
              {connected ? 'Conectado em tempo real' : 'Tempo real desconectado — a lista ainda atualiza ao recarregar'}
            </span>
            <Button type="submit" loading={broadcast.pending}>
              Disparar alerta
            </Button>
          </div>
        </form>
      </Card>

      {novos.length > 0 ? (
        <Card>
          <h2 className="mb-2 text-sm font-semibold text-brand-600">Chegou agora</h2>
          <ul className="flex flex-col gap-2">
            {novos.map((i) => (
              <li key={i.id} className="rounded-lg bg-ink-800 px-3 py-2 text-sm text-ink-50">
                {i.title} — {label.severity(i.severity)}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {list.loading ? <SkeletonList rows={3} /> : null}
      {list.error ? <ErrorState message={list.error} onRetry={list.reload} /> : null}

      {list.data && list.data.items.length === 0 ? (
        <EmptyState
          icon={<Megaphone size={28} />}
          title="Nenhum incidente registrado"
          description="Alertas ficam restritos à sala da própria empresa: rota, veículo e horário não vazam para outra frota."
        />
      ) : null}

      {list.data && list.data.items.length > 0 ? (
        <>
          <ul className="flex flex-col gap-2">
            {list.data.items.map((i) => (
              <li key={i.id}>
                <Card>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-ink-50">{i.title}</p>
                      <p className="mt-1 text-sm text-ink-200">{i.description}</p>
                      <p className="mt-1 text-xs text-ink-400">{formatDateTime(i.createdAt)}</p>
                    </div>
                    <Badge tone={i.severity === 'CRITICAL' || i.severity === 'HIGH' ? 'bad' : 'warn'}>
                      {label.severity(i.severity)}
                    </Badge>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
          <Pagination
            page={list.data.meta.page}
            totalPages={list.data.meta.totalPages}
            total={list.data.meta.total}
            onChange={setPage}
          />
        </>
      ) : null}
    </div>
  );
}

function Campanhas() {
  const [page, setPage] = useState(1);
  const [name, setName] = useState('');
  const [template, setTemplate] = useState('');
  const [channel, setChannel] = useState<'WHATSAPP' | 'INSTAGRAM' | 'EMAIL'>('WHATSAPP');
  const [target, setTarget] = useState<'ALL_STUDENTS' | 'ALL_PARENTS' | 'SPECIFIC'>('ALL_PARENTS');
  const [iaIndisponivel, setIaIndisponivel] = useState<string | null>(null);

  const list = useResource<Paginated<Campaign>>(
    (signal) => api.get('/ai/campaigns', { page, perPage: 20 }, signal),
    [page],
  );
  const posts = useResource<Paginated<AiPost>>(
    (signal) => api.get('/ai/posts', { perPage: 10 }, signal),
    [],
  );

  const create = useAction();
  const toggle = useAction();
  const gerar = useAction();
  // Aprovar, recusar e publicar são rotas que já existiam na API e não tinham
  // botão nenhum na tela: o rascunho ficava listado sem que ninguém pudesse
  // fazer nada com ele. Uma tela que só renderiza não é uma tela.
  const moderar = useAction();
  const { enabled, loading: flagsCarregando } = useFeatures();

  const onModerar = async (post: AiPost, acao: 'approve' | 'reject' | 'publish') => {
    const done = await moderar.run(async () => {
      await api.post(`/ai/posts/${post.id}/${acao}`, acao === 'reject' ? { reason: '' } : undefined);
      return true;
    });
    if (done) posts.reload();
  };

  /**
   * O canal precisa de credencial para a publicação SAIR de fato.
   *
   * WhatsApp é o único canal cuja configuração a sonda `/health/features`
   * expõe. Nos demais o botão continua disponível e a API decide — o que não
   * pode acontecer é marcar como publicado algo que nunca foi enviado.
   */
  const canalPronto = (canal: AiPost['channel']) =>
    canal === 'WHATSAPP' ? !flagsCarregando && enabled('whatsapp') : true;

  const onCreate = async (event: FormEvent) => {
    event.preventDefault();
    const done = await create.run(async () => {
      await api.post('/ai/campaigns', {
        name: name.trim(),
        template: template.trim(),
        channel,
        target,
        isActive: true,
      });
      return true;
    });
    if (done) {
      setName('');
      setTemplate('');
      list.reload();
    }
  };

  const onToggle = async (campaign: Campaign) => {
    const done = await toggle.run(async () => {
      await api.patch(`/ai/campaigns/${campaign.id}`, { isActive: !campaign.isActive });
      return true;
    });
    if (done) list.reload();
  };

  const onGerar = async () => {
    setIaIndisponivel(null);
    await gerar.run(async () => {
      try {
        await api.post('/ai/posts/generate', {
          channel,
          prompt: 'Rascunho de comunicado para os responsáveis.',
          quantity: 1,
        });
      } catch (err) {
        if (err instanceof ApiError && err.code === 'FEATURE_DISABLED') {
          setIaIndisponivel(err.message);
          return true;
        }
        throw err;
      }
      posts.reload();
      return true;
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <form className="flex flex-col gap-3" onSubmit={onCreate} noValidate>
          <h2 className="text-base font-semibold text-ink-50">Nova campanha</h2>
          <InlineError message={create.error} />
          <TextInput
            label="Nome"
            name="name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            error={create.fieldErrors.name}
          />
          <TextArea
            label="Modelo da mensagem"
            name="template"
            required
            value={template}
            onChange={(e) => setTemplate(e.target.value)}
            error={create.fieldErrors.template}
          />
          <SelectInput
            label="Canal"
            name="channel"
            value={channel}
            onChange={(e) => setChannel(e.target.value as 'WHATSAPP' | 'INSTAGRAM' | 'EMAIL')}
          >
            <option value="WHATSAPP">WhatsApp</option>
            <option value="INSTAGRAM">Instagram</option>
            <option value="EMAIL">E-mail</option>
          </SelectInput>
          <SelectInput
            label="Público"
            name="target"
            value={target}
            onChange={(e) => setTarget(e.target.value as 'ALL_STUDENTS' | 'ALL_PARENTS' | 'SPECIFIC')}
          >
            <option value="ALL_PARENTS">Todos os responsáveis</option>
            <option value="ALL_STUDENTS">Todos os alunos</option>
            <option value="SPECIFIC">Específico</option>
          </SelectInput>
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="secondary" loading={gerar.pending} onClick={() => void onGerar()}>
              Gerar rascunho com IA
            </Button>
            <Button type="submit" loading={create.pending}>
              Criar campanha
            </Button>
          </div>
        </form>
      </Card>

      {iaIndisponivel ? (
        <FeatureDisabledNotice feature="Assistente de IA" detail={iaIndisponivel} />
      ) : null}

      {list.loading ? <SkeletonList rows={3} /> : null}
      {list.error ? <ErrorState message={list.error} onRetry={list.reload} /> : null}

      {list.data && list.data.items.length === 0 ? (
        <EmptyState
          icon={<Megaphone size={28} />}
          title="Nenhuma campanha criada"
          description="Campanhas guardam o modelo da mensagem e o canal. A publicação só acontece com credencial real do canal — nada é marcado como enviado sem ter saído."
        />
      ) : null}

      {list.data && list.data.items.length > 0 ? (
        <>
          <ul className="flex flex-col gap-2">
            {list.data.items.map((c) => (
              <li key={c.id}>
                <Card className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-semibold text-ink-50">{c.name}</p>
                    <p className="text-xs text-ink-400">
                      {label.channel(c.channel)} · criada em {formatDate(c.createdAt)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone={c.isActive ? 'good' : 'neutral'}>
                      {c.isActive ? 'Ativa' : 'Pausada'}
                    </Badge>
                    <Button variant="secondary" loading={toggle.pending} onClick={() => void onToggle(c)}>
                      {c.isActive ? 'Pausar' : 'Ativar'}
                    </Button>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
          <Pagination
            page={list.data.meta.page}
            totalPages={list.data.meta.totalPages}
            total={list.data.meta.total}
            onChange={setPage}
          />
        </>
      ) : null}

      <Card>
        <h2 className="mb-3 text-base font-semibold text-ink-50">Publicações</h2>
        {posts.loading ? <SkeletonList rows={2} /> : null}
        {posts.error ? <ErrorState message={posts.error} onRetry={posts.reload} /> : null}
        {posts.data && posts.data.items.length === 0 ? (
          <p className="text-sm text-ink-400">
            Nenhuma publicação. O gerador de rascunho exige provedor de IA configurado; sem ele a
            rota responde 503 em vez de inventar um texto e chamar de gerado.
          </p>
        ) : null}
        <InlineError message={moderar.error} />

        {posts.data && posts.data.items.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {posts.data.items.map((p) => (
              <li key={p.id} className="rounded-xl bg-ink-800 px-3 py-3">
                <p className="text-sm text-ink-50">{p.content}</p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Badge
                    tone={
                      p.status === 'PUBLISHED'
                        ? 'good'
                        : p.status === 'REJECTED'
                          ? 'bad'
                          : p.status === 'APPROVED'
                            ? 'brand'
                            : 'neutral'
                    }
                  >
                    {label.aiPostStatus(p.status)}
                  </Badge>
                  <span className="text-xs text-ink-400">{label.channel(p.channel)}</span>

                  {p.status === 'DRAFT' ? (
                    <>
                      <Button
                        variant="primary"
                        loading={moderar.pending}
                        onClick={() => void onModerar(p, 'approve')}
                      >
                        Aprovar
                      </Button>
                      <Button
                        variant="secondary"
                        loading={moderar.pending}
                        onClick={() => void onModerar(p, 'reject')}
                      >
                        Recusar
                      </Button>
                    </>
                  ) : null}

                  {p.status === 'APPROVED' ? (
                    canalPronto(p.channel) ? (
                      <Button
                        variant="primary"
                        loading={moderar.pending}
                        onClick={() => void onModerar(p, 'publish')}
                      >
                        Publicar agora
                      </Button>
                    ) : (
                      <span className="text-xs text-warn-400">
                        {label.channel(p.channel)} sem credencial neste ambiente — a publicação seria
                        recusada, então o botão não é oferecido.
                      </span>
                    )
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        ) : null}
      </Card>
    </div>
  );
}

function Aniversarios() {
  const [days, setDays] = useState('7');
  const list = useResource<Paginated<Birthday>>(
    (signal) => api.get('/ai/birthdays', { days: Number(days), perPage: 50 }, signal),
    [days],
  );

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <div className="w-48">
          <SelectInput label="Janela" name="days" value={days} onChange={(e) => setDays(e.target.value)}>
            <option value="7">Próximos 7 dias</option>
            <option value="15">Próximos 15 dias</option>
            <option value="30">Próximos 30 dias</option>
          </SelectInput>
        </div>
        <p className="mt-2 text-xs text-ink-400">
          Somente alunos com consentimento de imagem aparecem: sem ele a criança não pode entrar em
          material de divulgação.
        </p>
      </Card>

      {list.loading ? <SkeletonList rows={3} /> : null}
      {list.error ? <ErrorState message={list.error} onRetry={list.reload} /> : null}

      {list.data && list.data.items.length === 0 ? (
        <EmptyState
          icon={<Cake size={28} />}
          title="Nenhum aniversário na janela"
          description="Alunos sem data de nascimento ou sem consentimento de imagem não entram nesta lista, por decisão de projeto."
        />
      ) : null}

      {list.data && list.data.items.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {list.data.items.map((b) => (
            <li key={b.id}>
              <Card className="flex items-center justify-between gap-3">
                <span className="text-sm font-medium text-ink-50">{b.name}</span>
                <span className="text-xs text-ink-400">
                  {formatDate(b.dateOfBirth)} · em {b.emDias} dia(s)
                </span>
              </Card>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function CrmAi() {
  const [aba, setAba] = useState<Aba>('chat');

  const abas: Array<{ id: Aba; texto: string }> = [
    { id: 'chat', texto: 'Chat da equipe' },
    { id: 'incidentes', texto: 'Incidentes' },
    { id: 'campanhas', texto: 'Campanhas' },
    { id: 'aniversarios', texto: 'Aniversários' },
  ];

  return (
    <div>
      <PageHeader
        title="CRM e IA"
        description="Canal interno, alertas em tempo real, campanhas e aniversariantes."
      />

      <div role="tablist" aria-label="Áreas do CRM" className="mb-4 flex flex-wrap gap-2">
        {abas.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={aba === item.id}
            onClick={() => setAba(item.id)}
            className={`min-h-[44px] rounded-lg px-4 text-sm ${
              aba === item.id ? 'bg-brand-500 font-semibold text-on-brand' : 'bg-ink-800 text-ink-200'
            }`}
          >
            {item.texto}
          </button>
        ))}
      </div>

      {aba === 'chat' ? <Chat /> : null}
      {aba === 'incidentes' ? <Incidentes /> : null}
      {aba === 'campanhas' ? <Campanhas /> : null}
      {aba === 'aniversarios' ? <Aniversarios /> : null}
    </div>
  );
}
