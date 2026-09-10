import { Link } from 'react-router-dom';
import { ArrowRight, Bus, Clock, ShieldCheck, Wallet } from 'lucide-react';

import { Logo } from '../../components/Logo';
import { ThemeToggle } from '../../components/ThemeToggle';

/**
 * Página pública.
 *
 * Fala com o dono da van — que não é engenheiro. Por isso cada recurso é
 * apresentado pela PERGUNTA que ele responde, e não pela técnica que usa por
 * baixo: "sobrou dinheiro este mês?" comunica; "DRE por regime de caixa" não.
 * A garantia técnica vem depois, em letra menor, para quem quiser conferir.
 */

const RESPOSTAS = [
  {
    Icone: Wallet,
    pergunta: 'Sobrou dinheiro este mês?',
    texto:
      'O painel abre com o resultado do mês em uma frase, e ao lado dele a lista de quem ainda não pagou — com nome, não com código.',
    garantia: 'Todo valor é inteiro em centavos: conciliação não erra por arredondamento.',
  },
  {
    Icone: Clock,
    pergunta: 'Que horas o motorista entrou?',
    texto:
      'Ele bate o ponto pelo próprio celular, em um botão só. A jornada é reconstruída pelas batidas — ninguém edita hora depois.',
    garantia: 'Batidas append-only com máquina de estados: entrada, pausa, retorno e saída.',
  },
  {
    Icone: Bus,
    pergunta: 'A criança embarcou?',
    texto:
      'O monitor marca embarque e entrega na lista do turno, e o pai vê a situação do filho em uma frase, sem precisar ligar para ninguém.',
    garantia: 'Cada marcação vai para a trilha de auditoria com autor e horário.',
  },
  {
    Icone: ShieldCheck,
    pergunta: 'E quando um pai pedir os dados dele?',
    texto:
      'Exportação, consentimento e pedido de eliminação são telas que ele mesmo usa — não um e-mail que alguém precisa responder.',
    garantia: 'Cada direito do Art. 18 é uma rota, com trilha encadeada por hash.',
  },
];

const PAPEIS = [
  { titulo: 'Dono da frota', texto: 'Resultado do mês, inadimplência, frota e alertas.' },
  { titulo: 'Gestor', texto: 'Só as áreas que o proprietário liberar, sem tela quebrada.' },
  { titulo: 'Motorista', texto: 'Ponto, rota do dia e os próprios ganhos, no celular.' },
  { titulo: 'Monitor', texto: 'A lista de embarque do turno, com alvo grande e uma mão só.' },
  { titulo: 'Responsável', texto: 'Onde o filho está, mensalidades e os direitos de LGPD.' },
];

export function Landing() {
  return (
    <div className="min-h-dvh bg-ink-950">
      <a className="skip-link" href="#conteudo">
        Pular para o conteúdo
      </a>

      <header className="sticky top-0 z-20 border-b border-ink-700 bg-ink-900/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-2.5">
          <Logo to="/" />
          <nav aria-label="Acesso" className="flex items-center gap-1.5">
            <ThemeToggle />
            <Link
              to="/entrar"
              className="flex min-h-[44px] items-center rounded-xl px-4 text-sm font-medium text-ink-200 transition-colors hover:bg-ink-800"
            >
              Entrar
            </Link>
            <Link
              to="/cadastro"
              className="flex min-h-[44px] items-center rounded-xl bg-brand-500 px-4 text-sm font-semibold text-on-brand shadow-raised transition-colors hover:bg-brand-400"
            >
              Criar conta
            </Link>
          </nav>
        </div>
      </header>

      <main id="conteudo">
        <section className="mx-auto max-w-6xl px-4 py-14 sm:py-24">
          <p className="text-sm font-semibold uppercase tracking-wider text-brand-600">
            Transporte escolar e fretamento
          </p>
          <h1 className="mt-3 max-w-3xl text-[2.25rem] font-bold leading-[1.1] text-ink-50 sm:text-6xl">
            A van inteira em um lugar só — inclusive a parte que dá dinheiro.
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-relaxed text-ink-200 sm:text-lg">
            Alunos, frota, ponto dos motoristas, fretamentos e financeiro. Cada pessoa entra pela
            tela que ela realmente usa, e o sistema responde perguntas em vez de despejar tabelas.
          </p>
          <div className="mt-9 flex flex-col gap-3 sm:flex-row">
            <Link
              to="/cadastro"
              className="flex min-h-[52px] items-center justify-center gap-2 rounded-2xl bg-brand-500 px-7 text-base font-semibold text-on-brand shadow-raised transition-colors hover:bg-brand-400"
            >
              Começar teste de 7 dias
              <ArrowRight aria-hidden="true" size={18} />
            </Link>
            <Link
              to="/entrar"
              className="flex min-h-[52px] items-center justify-center rounded-2xl border border-ink-700 bg-ink-900 px-7 text-base font-medium text-ink-200 transition-colors hover:bg-ink-800"
            >
              Já tenho conta
            </Link>
          </div>
          <p className="mt-4 text-sm text-ink-400">
            Sem cartão para testar. Sete dias com o produto completo.
          </p>
        </section>

        <section aria-labelledby="respostas" className="border-y border-ink-700 bg-ink-900">
          <div className="mx-auto max-w-6xl px-4 py-14 sm:py-20">
            <h2 id="respostas" className="text-2xl font-semibold text-ink-50 sm:text-3xl">
              As perguntas que o sistema responde
            </h2>
            <ul className="mt-8 grid gap-5 md:grid-cols-2">
              {RESPOSTAS.map((r) => (
                <li
                  key={r.pergunta}
                  className="rounded-card border border-ink-700 bg-ink-950 p-5 sm:p-6"
                >
                  <span
                    aria-hidden="true"
                    className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-soft text-brand-600"
                  >
                    <r.Icone size={22} />
                  </span>
                  <h3 className="mt-4 text-lg font-semibold text-ink-50">{r.pergunta}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-ink-200">{r.texto}</p>
                  <p className="mt-3 border-t border-ink-700 pt-3 text-xs leading-relaxed text-ink-400">
                    {r.garantia}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section aria-labelledby="papeis" className="mx-auto max-w-6xl px-4 py-14 sm:py-20">
          <h2 id="papeis" className="text-2xl font-semibold text-ink-50 sm:text-3xl">
            Cinco pessoas, cinco telas diferentes
          </h2>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-ink-400">
            Ninguém recebe um painel genérico com tudo desligado. Cada acesso abre no que aquela
            pessoa faz no dia dela — e o que ela não pode ver, o sistema explica em vez de esconder.
          </p>
          <ul className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {PAPEIS.map((p) => (
              <li key={p.titulo} className="rounded-card border border-ink-700 bg-ink-900 p-4">
                <h3 className="text-sm font-semibold text-ink-50">{p.titulo}</h3>
                <p className="mt-1.5 text-sm text-ink-400">{p.texto}</p>
              </li>
            ))}
          </ul>

          <div className="mt-10 flex flex-col items-start gap-3 rounded-card border border-brand-500/40 bg-brand-soft p-6 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-base font-medium text-ink-50">
              Comece com a sua frota hoje — leva menos de cinco minutos.
            </p>
            <Link
              to="/cadastro"
              className="flex min-h-[48px] shrink-0 items-center justify-center gap-2 rounded-2xl bg-brand-500 px-6 text-sm font-semibold text-on-brand shadow-raised transition-colors hover:bg-brand-400"
            >
              Criar minha conta
              <ArrowRight aria-hidden="true" size={16} />
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-ink-700 bg-ink-900">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-6 text-sm text-ink-400 sm:flex-row sm:items-center sm:justify-between">
          <p>VanPro — gestão de transporte escolar e fretamento.</p>
          <Link
            to="/privacidade"
            className="inline-flex min-h-[44px] items-center rounded-xl text-brand-600 underline"
          >
            Política de Privacidade
          </Link>
        </div>
      </footer>
    </div>
  );
}
