import { BoardingList } from '../driver/DriverRoute';

export function Boarding() {
  return (
    <BoardingList
      titulo="Lista de embarque"
      descricao="Marque quem embarcou, quem foi entregue e quem faltou. A mesma trilha de auditoria do motorista registra cada alteração."
    />
  );
}
