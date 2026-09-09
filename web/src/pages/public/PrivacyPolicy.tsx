import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

/**
 * Politica de Privacidade.
 *
 * Exigencia do Art. 9 da LGPD: o titular tem direito ao acesso facilitado as
 * informacoes sobre o tratamento. Texto generico de template nao cumpre isso —
 * o que esta aqui descreve o que o sistema realmente coleta, com que base legal
 * e por quanto tempo guarda.
 */

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="mt-8">
      <h2 id={id} className="text-lg font-semibold text-ink-50">
        {title}
      </h2>
      <div className="mt-3 flex flex-col gap-3 text-sm leading-relaxed text-ink-200">{children}</div>
    </section>
  );
}

const DADOS = [
  {
    grupo: 'Cadastro da empresa',
    itens: 'Razão social ou nome, CNPJ ou CPF, endereço de garagem (latitude/longitude) e plano contratado.',
  },
  {
    grupo: 'Usuários do sistema',
    itens:
      'Nome, e-mail, papel na empresa, permissões, data de troca de senha, dispositivos com sessão aberta (IP e data) e, se ativados, segredo de segundo fator e chaves de passkey.',
  },
  {
    grupo: 'Alunos (crianças e adolescentes)',
    itens:
      'Nome, escola, série, turno, endereço, data de nascimento, foto (somente com consentimento específico de imagem), valor da mensalidade e vínculo com o responsável.',
  },
  {
    grupo: 'Operação',
    itens:
      'Check-in e check-out de embarque, posição do veículo durante a rota, quilometragem, batidas de ponto dos motoristas e registros de incidente.',
  },
  {
    grupo: 'Financeiro',
    itens:
      'Mensalidades, despesas, faturas, identificador da cobrança no gateway de pagamento e CPF/CNPJ do pagador informado na emissão.',
  },
  {
    grupo: 'Trilha de auditoria',
    itens:
      'Ação realizada, autor, data, endereço IP e descrição — encadeados por hash, para que alteração retroativa seja detectável.',
  },
];

const BASES = [
  {
    base: 'Execução de contrato (Art. 7, V)',
    uso: 'Cadastro de alunos, rotas, embarque, cobrança de mensalidade e acesso dos usuários ao sistema.',
  },
  {
    base: 'Obrigação legal e regulatória (Art. 7, II)',
    uso: 'Guarda de registros fiscais e de ponto eletrônico, e a trilha de auditoria que os sustenta.',
  },
  {
    base: 'Consentimento (Art. 7, I; Art. 14 para crianças)',
    uso: 'Uso de foto do aluno em comunicação e material de divulgação. É específico, destacado e revogável a qualquer momento.',
  },
  {
    base: 'Legítimo interesse (Art. 7, IX)',
    uso: 'Segurança do sistema: bloqueio por tentativas de acesso, detecção de reuso de token de sessão e prevenção à fraude.',
  },
];

const RETENCAO = [
  ['Cadastro de aluno', 'Enquanto houver contrato ativo; depois, anonimizado mediante pedido de eliminação.'],
  ['Registros fiscais e faturas', '5 anos, por obrigação legal de guarda — prevalecem sobre o pedido de eliminação (Art. 16, I).'],
  ['Ponto eletrônico e diárias', '5 anos, como prova em eventual reclamação trabalhista.'],
  ['Trilha de auditoria', '5 anos; não é apagável por design, porque é ela que prova o que foi feito.'],
  ['Sessões e dispositivos', 'Até a expiração ou a revogação, o que vier primeiro.'],
  ['Posição do veículo em tempo real', 'Transmitida durante a rota; não é armazenada como histórico de trajeto.'],
];

const DIREITOS = [
  ['Confirmação e acesso (I e II)', 'Tela "Meus dados (LGPD)" e a rota /privacy/my-data.'],
  ['Correção (III)', 'Edição no cadastro do aluno pela empresa, a pedido do responsável.'],
  ['Anonimização, bloqueio ou eliminação (IV)', 'Botão "Solicitar exclusão" na central de privacidade.'],
  ['Portabilidade (V)', 'Exportação em JSON estruturado, baixável pela própria tela.'],
  ['Eliminação dos dados tratados com consentimento (VI)', 'Revogação do consentimento na central de privacidade.'],
  ['Informação sobre compartilhamento (VII)', 'Seção "Com quem compartilhamos", abaixo.'],
  ['Informação sobre a possibilidade de não consentir (VIII)', 'O consentimento de imagem é opcional: negar não impede o uso do transporte.'],
  ['Revogação do consentimento (IX)', 'Um clique na central de privacidade, com data registrada.'],
];

export function PrivacyPolicy() {
  return (
    <div className="min-h-screen bg-ink-950">
      <a className="skip-link" href="#conteudo">
        Pular para o conteúdo
      </a>
      <header className="border-b border-ink-800">
        <div className="mx-auto max-w-3xl px-4 py-4">
          <Link to="/" className="inline-flex min-h-[44px] items-center text-lg font-semibold text-brand-400">
            VanPro
          </Link>
        </div>
      </header>

      <main id="conteudo" className="mx-auto max-w-3xl px-4 py-10">
        <h1 className="text-2xl font-semibold text-ink-50 sm:text-3xl">Política de Privacidade</h1>
        <p className="mt-3 text-sm text-ink-400">
          Elaborada conforme a Lei 13.709/2018 (LGPD). Descreve o tratamento de dados pessoais
          realizado pelo VanPro, incluindo dados de crianças e adolescentes.
        </p>

        <Section id="papeis" title="1. Quem trata os dados">
          <p>
            A <strong>empresa de transporte contratante</strong> e a <strong>controladora</strong>:
            é ela quem decide quais alunos cadastrar, por quanto tempo manter os registros e a quem
            dar acesso. O VanPro atua como <strong>operador</strong>, tratando os dados em nome dela
            e segundo suas instruções.
          </p>
          <p>
            Pedidos de titular dirigidos ao VanPro são encaminhados à empresa controladora
            correspondente, que é quem pode decidir sobre eles.
          </p>
        </Section>

        <Section id="dados" title="2. Dados que coletamos">
          <ul className="flex flex-col gap-3">
            {DADOS.map((d) => (
              <li key={d.grupo}>
                <strong className="text-ink-50">{d.grupo}:</strong> {d.itens}
              </li>
            ))}
          </ul>
          <p>
            Não coletamos dados sensíveis (origem racial, convicção religiosa, opinião política,
            saúde, biometria) e não usamos cookies de análise, publicidade ou rastreamento de
            terceiros. Os únicos cookies do sistema são os de sessão e o de proteção contra CSRF,
            estritamente necessários para o login funcionar.
          </p>
        </Section>

        <Section id="finalidade" title="3. Para que usamos">
          <p>
            Operar o transporte contratado: montar rotas, registrar embarque e desembarque, permitir
            que o responsável acompanhe o trajeto do filho, apurar a jornada dos motoristas, emitir e
            conciliar cobranças e produzir os relatórios financeiros da empresa. Não vendemos dados,
            não os usamos para publicidade e não os cedemos para terceiros fora dos casos descritos
            abaixo.
          </p>
        </Section>

        <Section id="base-legal" title="4. Base legal de cada uso">
          <ul className="flex flex-col gap-3">
            {BASES.map((b) => (
              <li key={b.base}>
                <strong className="text-ink-50">{b.base}:</strong> {b.uso}
              </li>
            ))}
          </ul>
          <p>
            Para dados de crianças e adolescentes, o tratamento observa o Art. 14: é feito no melhor
            interesse do menor, e o uso de imagem exige consentimento específico e destacado de pelo
            menos um dos pais ou do responsável legal.
          </p>
        </Section>

        <Section id="retencao" title="5. Por quanto tempo guardamos">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-left text-sm">
              <caption className="sr-only">Prazos de retenção por tipo de dado</caption>
              <thead>
                <tr className="border-b border-ink-700 text-ink-400">
                  <th scope="col" className="py-2 pr-4 font-medium">
                    Dado
                  </th>
                  <th scope="col" className="py-2 font-medium">
                    Prazo
                  </th>
                </tr>
              </thead>
              <tbody>
                {RETENCAO.map(([dado, prazo]) => (
                  <tr key={dado} className="border-b border-ink-800 align-top">
                    <th scope="row" className="py-2 pr-4 font-normal text-ink-50">
                      {dado}
                    </th>
                    <td className="py-2 text-ink-200">{prazo}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            Ao fim do prazo, o registro do aluno é <strong>anonimizado</strong>, e não apagado: o
            histórico financeiro e a trilha de auditoria continuam existindo sem nada que identifique
            a criança.
          </p>
        </Section>

        <Section id="compartilhamento" title="6. Com quem compartilhamos">
          <ul className="flex list-disc flex-col gap-2 pl-5">
            <li>
              <strong className="text-ink-50">Gateway de pagamento:</strong> quando a empresa emite
              uma cobrança, enviamos nome e CPF/CNPJ do pagador, valor e vencimento. Sem credencial
              configurada, a função fica indisponível — nenhuma cobrança é simulada.
            </li>
            <li>
              <strong className="text-ink-50">Provedor de infraestrutura:</strong> hospedagem e banco
              de dados, com acesso restrito e registrado.
            </li>
            <li>
              <strong className="text-ink-50">Autoridades:</strong> mediante requisição legal válida.
            </li>
          </ul>
          <p>
            Não há transferência internacional de dados fora do necessário para a operação dos
            serviços acima. Havendo, ela é amparada por cláusulas contratuais padrão, conforme
            exigido pela ANPD.
          </p>
        </Section>

        <Section id="seguranca" title="7. Como protegemos">
          <p>
            Senhas são guardadas apenas como hash; segredos de segundo fator e campos pessoais
            sensíveis são cifrados em repouso; a sessão viaja em cookie <code>httpOnly</code>, fora do
            alcance de scripts. O acesso é segmentado por empresa no próprio banco, com papel e
            permissão conferidos a cada requisição, e toda escrita relevante entra numa trilha
            encadeada por hash.
          </p>
          <p>
            Em caso de incidente de segurança com risco relevante, a ANPD e os titulares afetados são
            comunicados em até 3 dias úteis, conforme o Art. 48 e a regulamentação da ANPD.
          </p>
        </Section>

        <Section id="direitos" title="8. Seus direitos (Art. 18)">
          <ul className="flex flex-col gap-2">
            {DIREITOS.map(([direito, onde]) => (
              <li key={direito}>
                <strong className="text-ink-50">{direito}:</strong> {onde}
              </li>
            ))}
          </ul>
          <p>
            Responsáveis com acesso ao sistema exercem esses direitos diretamente na central de
            privacidade, após o login. Quem não tem acesso pode acionar o canal do encarregado
            abaixo; a resposta é enviada em até 15 dias.
          </p>
        </Section>

        <Section id="encarregado" title="9. Canal do encarregado (DPO)">
          <p>
            Encarregado pelo tratamento de dados pessoais, conforme o Art. 41:
            <br />
            <a className="text-brand-400 underline" href="mailto:privacidade@vanpro.com.br">
              privacidade@vanpro.com.br
            </a>
          </p>
          <p>
            Para pedidos sobre dados de um aluno específico, o canal correto é a{' '}
            <strong>empresa de transporte contratada pela família</strong>, que é a controladora
            desses dados. Se você não souber a quem se dirigir, escreva ao endereço acima e faremos o
            encaminhamento.
          </p>
        </Section>

        <Section id="alteracoes" title="10. Alterações desta política">
          <p>
            Mudanças materiais são comunicadas dentro do sistema antes de entrarem em vigor. A versão
            vigente é sempre a publicada nesta página.
          </p>
        </Section>

        <p className="mt-10 text-sm text-ink-400">
          <Link to="/" className="inline-flex min-h-[44px] items-center text-brand-400 underline">
            Voltar para a página inicial
          </Link>
        </p>
      </main>
    </div>
  );
}
