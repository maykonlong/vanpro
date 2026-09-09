import { Link } from 'react-router-dom';
import { Bus, Clock, ShieldCheck, Wallet } from 'lucide-react';

const RECURSOS = [
  {
    icon: Bus,
    titulo: 'Frota e rotas',
    texto:
      'Cadastro de veículos com odômetro monotônico, escala de motorista e detecção de conflito de agenda no fretamento.',
  },
  {
    icon: Clock,
    titulo: 'Ponto eletrônico',
    texto:
      'Batidas append-only com máquina de estados: entrada, pausa, retorno e saída. A jornada é reconstruída pelas batidas, nunca editada.',
  },
  {
    icon: Wallet,
    titulo: 'Financeiro em centavos',
    texto:
      'DRE por regime de caixa, despesas por categoria e ROI por veículo. Todo valor é inteiro em centavos — conciliação não erra por arredondamento.',
  },
  {
    icon: ShieldCheck,
    titulo: 'LGPD com endereço',
    texto:
      'Exportação, consentimento, pedido de eliminação e trilha de auditoria encadeada por hash. Cada direito do Art. 18 é uma rota, não um e-mail.',
  },
];

export function Landing() {
  return (
    <div className="min-h-screen bg-ink-950">
      <a className="skip-link" href="#conteudo">
        Pular para o conteúdo
      </a>

      <header className="border-b border-ink-800">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
          <span className="text-lg font-semibold text-brand-400">VanPro</span>
          <nav aria-label="Acesso" className="flex items-center gap-2">
            <Link
              to="/entrar"
              className="flex min-h-[44px] items-center rounded-lg px-4 text-sm text-ink-200 hover:bg-ink-800"
            >
              Entrar
            </Link>
            <Link
              to="/cadastro"
              className="flex min-h-[44px] items-center rounded-lg bg-brand-500 px-4 text-sm font-semibold text-ink-950 hover:bg-brand-400"
            >
              Criar conta
            </Link>
          </nav>
        </div>
      </header>

      <main id="conteudo">
        <section className="mx-auto max-w-6xl px-4 py-14 sm:py-20">
          <h1 className="max-w-3xl text-3xl font-bold leading-tight text-ink-50 sm:text-5xl">
            Gestão de transporte escolar sem planilha e sem achismo.
          </h1>
          <p className="mt-5 max-w-2xl text-base text-ink-200 sm:text-lg">
            Alunos, frota, ponto dos motoristas, fretamentos e o financeiro da van no mesmo lugar —
            com trilha de auditoria e os direitos de LGPD implementados de verdade.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link
              to="/cadastro"
              className="flex min-h-[44px] items-center justify-center rounded-lg bg-brand-500 px-6 text-sm font-semibold text-ink-950 hover:bg-brand-400"
            >
              Começar teste de 7 dias
            </Link>
            <Link
              to="/entrar"
              className="flex min-h-[44px] items-center justify-center rounded-lg border border-ink-700 px-6 text-sm text-ink-200 hover:bg-ink-800"
            >
              Já tenho conta
            </Link>
          </div>
        </section>

        <section aria-labelledby="recursos" className="mx-auto max-w-6xl px-4 pb-16">
          <h2 id="recursos" className="mb-6 text-xl font-semibold text-ink-50">
            O que está pronto
          </h2>
          <ul className="grid gap-4 sm:grid-cols-2">
            {RECURSOS.map((r) => (
              <li key={r.titulo} className="rounded-xl border border-ink-800 bg-ink-900 p-5">
                <r.icon aria-hidden="true" className="text-brand-400" size={24} />
                <h3 className="mt-3 text-base font-semibold text-ink-50">{r.titulo}</h3>
                <p className="mt-2 text-sm text-ink-400">{r.texto}</p>
              </li>
            ))}
          </ul>
        </section>
      </main>

      <footer className="border-t border-ink-800">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-6 text-sm text-ink-400 sm:flex-row sm:justify-between">
          <p>VanPro — gestão de transporte escolar.</p>
          <Link to="/privacidade" className="inline-flex min-h-[44px] items-center text-brand-400 underline">
            Política de Privacidade
          </Link>
        </div>
      </footer>
    </div>
  );
}
