import React, { useState } from 'react';
import { UserPlus, Save, ArrowLeft } from 'lucide-react';
import { ImageUpload } from '../../components/ImageUpload';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

export const AddStudent: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  
  const [formData, setFormData] = useState({
    name: '',
    school: '',
    shift: 'MORNING',
    monthlyFee: '',
    photoUrl: ''
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.photoUrl) return alert("A foto é obrigatória para segurança!");

    try {
      const res = await fetch('http://localhost:3000/api/v1/students', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'omit', // ou 'include' com cookie
        body: JSON.stringify(formData)
      });

      if (res.ok) {
        alert("Aluno cadastrado com sucesso!");
        navigate('/owner'); // Voltar ao dashboard
      } else {
        alert("Falha ao salvar aluno.");
      }
    } catch (err) {
      alert("Erro na conexão com API.");
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-4 text-white mb-8">
        <button onClick={() => navigate(-1)} className="p-2 bg-slate-800 rounded-full hover:bg-slate-700">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <UserPlus className="text-blue-400" /> Cadastrar Aluno
        </h1>
      </div>

      <form onSubmit={handleSubmit} className="bg-slate-900 border border-slate-800 p-6 rounded-3xl space-y-6">
        <ImageUpload 
          label="Foto da Criança (Obrigatório para identificação)" 
          onUpload={(url) => setFormData(f => ({...f, photoUrl: url}))} 
        />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1">
            <label className="text-sm font-medium text-slate-300">Nome Completo</label>
            <input 
              required
              type="text" 
              className="w-full bg-slate-950 border border-slate-800 text-white p-3 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
              value={formData.name}
              onChange={e => setFormData(f => ({...f, name: e.target.value}))}
            />
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium text-slate-300">Escola</label>
            <input 
              required
              type="text" 
              className="w-full bg-slate-950 border border-slate-800 text-white p-3 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
              value={formData.school}
              onChange={e => setFormData(f => ({...f, school: e.target.value}))}
            />
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium text-slate-300">Turno</label>
            <select 
              className="w-full bg-slate-950 border border-slate-800 text-white p-3 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
              value={formData.shift}
              onChange={e => setFormData(f => ({...f, shift: e.target.value}))}
            >
              <option value="MORNING">Manhã</option>
              <option value="AFTERNOON">Tarde</option>
              <option value="NIGHT">Noite</option>
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium text-slate-300">Mensalidade (R$)</label>
            <input 
              required
              type="number" 
              className="w-full bg-slate-950 border border-slate-800 text-white p-3 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
              value={formData.monthlyFee}
              onChange={e => setFormData(f => ({...f, monthlyFee: e.target.value}))}
            />
          </div>
        </div>

        <button type="submit" className="w-full bg-blue-600 hover:bg-blue-500 text-white p-4 rounded-xl font-bold flex items-center justify-center gap-2 shadow-lg">
          <Save className="w-5 h-5" /> Salvar Cadastro
        </button>
      </form>
    </div>
  );
};

export default AddStudent;
