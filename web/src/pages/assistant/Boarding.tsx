import { BoardingList } from '../../components/BoardingList';

/**
 * Tela do monitor.
 *
 * O monitor faz a lista de embarque e nada além disso: mesma rota de check-in
 * do motorista (`PATCH /students/:id/checkin`), mesma trilha de auditoria. Não
 * há um segundo bloco aqui de propósito — no celular, com a van parando, cada
 * seção extra é uma rolagem entre ele e a criança que precisa ser marcada.
 */
export function Boarding() {
  return (
    <BoardingList
      titulo="Embarque"
      descricao="Marque quem embarcou, quem foi entregue e quem faltou. Cada alteração é registrada com o seu nome."
    />
  );
}
