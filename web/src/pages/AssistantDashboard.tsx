import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { UserCheck, UserMinus, ShieldAlert, Users } from 'lucide-react';

const mockStudents = [
  { id: '1', name: 'João Rodrigues', status: 'PENDING' },
  { id: '2', name: 'Ana Rodrigues', status: 'BOARDED' },
  { id: '3', name: 'Pedro Lima', status: 'ABSENT' },
];

const AssistantDashboard: React.FC = () => {
  const { user } = useAuth();
  const [students, setStudents] = useState(mockStudents);

  const handleStatusChange = (id: string, newStatus: string) => {
    setStudents(prev => 
      prev.map(s => s.id === id ? { ...s, status: newStatus } : s)
    );
  };

  return (
    <div className="max-w-md mx-auto space-y-6 pb-20">
      <div className="bg-slate-900 border border-slate-800 p-6 rounded-3xl space-y-6">
        <div className="text-center">
          <div className="mx-auto w-12 h-12 bg-purple-500/20 text-purple-400 rounded-full flex items-center justify-center mb-4">
            <Users className="w-6 h-6" />
          </div>
          <h1 className="text-xl font-extrabold text-white">App Auxiliar de Van</h1>
          <p className="text-slate-400 font-medium text-sm">Bem-vindo, {user?.name}</p>
        </div>

        <div className="space-y-4">
          <h2 className="text-sm font-bold text-white flex items-center gap-2">
            <UserCheck className="w-5 h-5 text-emerald-400" /> Lista de Passageiros (Ida)
          </h2>
          
          <div className="space-y-3">
            {students.map(student => (
              <div key={student.id} className="bg-slate-950 border border-slate-800 p-4 rounded-xl flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-slate-200">{student.name}</h3>
                  <p className="text-xs text-slate-500">
                    {student.status === 'PENDING' ? 'Aguardando embarque' : 
                     student.status === 'BOARDED' ? 'Embarcado' : 'Ausente'}
                  </p>
                </div>
                
                <div className="flex gap-2">
                  <button 
                    onClick={() => handleStatusChange(student.id, 'BOARDED')}
                    className={`w-10 h-10 rounded-lg flex items-center justify-center transition-colors ${
                      student.status === 'BOARDED' ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-emerald-900 hover:text-emerald-500'
                    }`}
                  >
                    <UserCheck className="w-5 h-5" />
                  </button>
                  <button 
                    onClick={() => handleStatusChange(student.id, 'ABSENT')}
                    className={`w-10 h-10 rounded-lg flex items-center justify-center transition-colors ${
                      student.status === 'ABSENT' ? 'bg-red-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-red-900 hover:text-red-500'
                    }`}
                  >
                    <UserMinus className="w-5 h-5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="pt-4 border-t border-slate-800">
          <button className="w-full bg-slate-800 hover:bg-slate-700 text-white p-4 rounded-2xl flex items-center justify-center gap-3 font-bold shadow-lg">
            <ShieldAlert className="w-5 h-5 text-amber-400" /> Registrar Ocorrência
          </button>
        </div>
      </div>
    </div>
  );
};

export default AssistantDashboard;
