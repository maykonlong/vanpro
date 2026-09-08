const fs = require('fs');
const path = 'frontend/index.html';
let html = fs.readFileSync(path, 'utf8');

// Replace {student.status}
html = html.replace(/{student\.status}/g, "{student.status === 'BOARDED' ? 'Embarcado' : student.status === 'ABSENT' ? 'Faltou' : student.status === 'PENDING' ? 'Aguardando' : student.status}");

// Replace {o.type}
html = html.replace(/{o\.type}/g, "{o.type === 'TRAFFIC' ? 'Trânsito' : o.type === 'BREAKDOWN' ? 'Quebra' : o.type === 'ACCIDENT' ? 'Acidente' : o.type === 'BEHAVIOR' ? 'Comportamento' : o.type === 'DELAY' ? 'Atraso' : 'Outro'}");

fs.writeFileSync(path, html, 'utf8');
console.log('Translations applied!');
