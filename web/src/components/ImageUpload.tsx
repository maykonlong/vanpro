import React, { useState } from 'react';
import { UploadCloud, CheckCircle2 } from 'lucide-react';

interface ImageUploadProps {
  label: string;
  onUpload: (url: string) => void;
}

export const ImageUpload: React.FC<ImageUploadProps> = ({ label, onUpload }) => {
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    
    // Mostra preview local rápido
    const reader = new FileReader();
    reader.onloadend = () => setPreview(reader.result as string);
    reader.readAsDataURL(file);

    const formData = new FormData();
    formData.append('photo', file);

    try {
      // Usar a rota recém-criada
      const res = await fetch('http://localhost:3000/api/v1/uploads', {
        method: 'POST',
        body: formData
      });
      const data = await res.json();
      
      if (res.ok && data.url) {
        onUpload(data.url);
      } else {
        alert(data.error || 'Erro no upload');
        setPreview(null);
      }
    } catch (error) {
      alert('Erro de conexão no upload');
      setPreview(null);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <label className="text-sm font-medium text-slate-300">{label}</label>
      <div className="relative group rounded-xl border-2 border-dashed border-slate-700 bg-slate-900/50 hover:bg-slate-800 transition-colors flex items-center justify-center h-32 overflow-hidden">
        {preview ? (
          <img src={preview} alt="Preview" className="w-full h-full object-cover opacity-80" />
        ) : (
          <div className="flex flex-col items-center gap-2 text-slate-500 group-hover:text-emerald-400 transition-colors">
            {uploading ? <span className="animate-spin text-xl">⏳</span> : <UploadCloud className="w-8 h-8" />}
            <span className="text-xs">{uploading ? 'Enviando...' : 'Clique para Enviar'}</span>
          </div>
        )}
        
        {preview && !uploading && (
          <div className="absolute top-2 right-2 bg-emerald-500 rounded-full text-slate-900 p-1 shadow-lg shadow-emerald-500/20">
            <CheckCircle2 className="w-4 h-4" />
          </div>
        )}
        
        <input 
          type="file" 
          accept="image/*" 
          onChange={handleFileChange} 
          disabled={uploading}
          className="absolute inset-0 opacity-0 cursor-pointer disabled:cursor-not-allowed" 
        />
      </div>
    </div>
  );
};
