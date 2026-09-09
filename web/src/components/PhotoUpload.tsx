import { useRef, useState } from 'react';
import { Camera } from 'lucide-react';

import { API_BASE, api, errorMessage } from '../lib/api';
import { Button, InlineError } from './ui';

interface UploadResponse {
  filename: string;
  mimeType: string;
  size: number;
  /** Caminho relativo a rota autenticada: nao existe URL publica para o arquivo. */
  url: string;
}

/** O arquivo so e servido pela rota autenticada, entao o `src` leva o prefixo. */
export function photoSrc(url: string | null | undefined): string | null {
  if (!url) return null;
  if (url.startsWith('http') || url.startsWith('data:')) return url;
  return `${API_BASE}${url.startsWith('/') ? '' : '/'}${url}`;
}

export function PhotoUpload({
  value,
  onChange,
  label: fieldLabel = 'Foto',
}: {
  value: string | null;
  onChange: (url: string | null) => void;
  label?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onFile = async (file: File) => {
    setPending(true);
    setError(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const result = await api.upload<UploadResponse>('/uploads', form);
      onChange(result.url);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  };

  const src = photoSrc(value);

  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium text-ink-200">{fieldLabel}</span>
      <div className="flex items-center gap-3">
        {src ? (
          <img
            src={src}
            alt="Foto cadastrada"
            className="h-16 w-16 rounded-full border border-ink-700 object-cover"
          />
        ) : (
          <div
            aria-hidden="true"
            className="flex h-16 w-16 items-center justify-center rounded-full border border-dashed border-ink-700 text-ink-600"
          >
            <Camera size={22} />
          </div>
        )}

        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="sr-only"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void onFile(file);
            e.target.value = '';
          }}
        />
        <Button type="button" variant="secondary" loading={pending} onClick={() => inputRef.current?.click()}>
          {value ? 'Trocar foto' : 'Enviar foto'}
        </Button>
        {value ? (
          <Button type="button" variant="ghost" onClick={() => onChange(null)}>
            Remover
          </Button>
        ) : null}
      </div>
      <p className="text-xs text-ink-400">JPEG, PNG ou WebP. O conteúdo do arquivo é conferido no servidor.</p>
      <InlineError message={error} />
    </div>
  );
}
