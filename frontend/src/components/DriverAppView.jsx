import React, { useState } from 'react';
import { Navigation, CheckCircle, XCircle, Clock, MapPin, Phone, ShieldCheck, AlertTriangle } from 'lucide-react';

export default function DriverAppView() {
  const [students, setStudents] = useState([
    { id: 1, name: 'João Rodrigues', school: 'Colégio Dom Pedro II', time: '06:30', status: 'BOARDED', address: 'Rua Haddock Lobo, 400', phone: '(11) 96666-4004' },
    { id: 2, name: 'Ana Rodrigues', school: 'Colégio Dom Pedro II', time: '06:32', status: 'BOARDED', address: 'Rua Haddock Lobo, 400', phone: '(11) 96666-4004' },
    { id: 3, name: 'Pedro Henrique Lima', school: 'Escola Santa Catarina', time: '06:45', status: 'PENDING', address: 'Rua Bela Cintra, 950', phone: '(11) 95555-3333' },
    { id: 4, name: 'Beatriz Santos', school: 'Colégio Dom Pedro II', time: '06:52', status: 'ABSENT', address: 'Alameda Santos, 1200', phone: '(11) 94444-2222' },
  ]);

  const handleStatusChange = (id, newStatus) => {
    setStudents(prev => prev.map(s => s.id === id ? { ...s, status: newStatus } : s));
  };

  const boardedCount = students.filter(s => s.status === 'BOARDED').length;

  return (
    <div className="max-w-md mx-auto space-y-4">
      {/* Mobile Top Bar */}
      <div className="glass-panel p-4 rounded-2xl flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center justify-center font-bold">
            CO
          </div>
          <div>
            <h2 className="font-bold text-white text-sm">Carlos Oliveira</h2>
            <p className="text-xs text-slate-400">Van 01 (Ford Transit) • Rota Manhã</p>
          </div>
        </div>
        <span className="flex items-center gap-1 text-[11px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 px-2.5 py-1 rounded-full font-semibold">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
          GPS Ativo
        </span>
      </div>

      {/* Resumo da Rota */}
      <div className="glass-card p-4 rounded-2xl space-y-2">
        <div className="flex justify-between items-center text-xs text-slate-300">
          <span>Ocupação da Van:</span>
          <span className="font-bold text-emerald-400">{boardedCount} de 15 lugares</span>
        </div>
        <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden">
          <div 
            className="bg-emerald-500 h-full transition-all duration-500" 
            style={{ width: `${(boardedCount / 15) * 100}%` }}
          ></div>
        </div>
      </div>

      {/* Lista de Alunos e Check-in */}
      <div className="space-y-3">
        <div className="flex items-center justify-between text-xs font-semibold text-slate-400 uppercase tracking-wider px-1">
          <span>Sequência da Rota ({students.length} Alunos)</span>
          <span>Check-in em 1-clique</span>
        </div>

        {students.map((student) => (
          <div key={student.id} className="glass-card p-4 rounded-2xl space-y-3">
            <div className="flex items-start justify-between">
              <div>
                <span className="text-xs font-bold text-emerald-400 flex items-center gap-1 mb-1">
                  <Clock className="w-3 h-3" /> {student.time}
                </span>
                <h3 className="font-bold text-white text-base">{student.name}</h3>
                <p className="text-xs text-slate-400">{student.school}</p>
              </div>

              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase ${
                student.status === 'BOARDED' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30' :
                student.status === 'ABSENT' ? 'bg-red-500/10 text-red-400 border border-red-500/30' :
                'bg-amber-500/10 text-amber-400 border border-amber-500/30'
              }`}>
                {student.status === 'BOARDED' ? 'Embarcou' : student.status === 'ABSENT' ? 'Faltou' : 'Pendente'}
              </span>
            </div>

            <div className="text-xs text-slate-400 flex items-center justify-between border-t border-slate-800/80 pt-2">
              <span className="flex items-center gap-1">
                <MapPin className="w-3 h-3 text-slate-500" /> {student.address}
              </span>
              <a href={`tel:${student.phone}`} className="text-emerald-400 hover:underline flex items-center gap-1 font-medium">
                <Phone className="w-3 h-3" /> Ligar
              </a>
            </div>

            {/* Ações de Check-in */}
            <div className="grid grid-cols-2 gap-2 pt-1">
              <button
                onClick={() => handleStatusChange(student.id, 'BOARDED')}
                className={`py-2 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${
                  student.status === 'BOARDED'
                    ? 'bg-emerald-600 text-white shadow-lg glow-emerald'
                    : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                }`}
              >
                <CheckCircle className="w-4 h-4" />
                Embarcou
              </button>

              <button
                onClick={() => handleStatusChange(student.id, 'ABSENT')}
                className={`py-2 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${
                  student.status === 'ABSENT'
                    ? 'bg-red-600 text-white shadow-lg'
                    : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                }`}
              >
                <XCircle className="w-4 h-4" />
                Ausente
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
