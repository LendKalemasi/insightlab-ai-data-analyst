'use client';
import { FileSpreadsheet, UploadCloud, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { ApiError, rememberDataset, uploadDataset } from '@/lib/client/api';
import { formatBytes } from '@/lib/format';
import { Alert, Button, cx } from '../ui';
import { useAppStatus } from '../app/chrome';

const ACCEPT = ['.csv', '.tsv', '.txt', '.xlsx'];

type State =
  | { phase: 'idle' }
  | { phase: 'uploading'; file: File; progress: number }
  | { phase: 'processing'; file: File }
  | { phase: 'error'; message: string; file?: File };

/** Drag-and-drop or browse; validates locally, uploads with progress, then opens the workspace. */
export function Dropzone() {
  const router = useRouter();
  const status = useAppStatus();
  const input = useRef<HTMLInputElement>(null);
  const abort = useRef<AbortController | null>(null);
  const [state, setState] = useState<State>({ phase: 'idle' });
  const [dragging, setDragging] = useState(false);
  const busy = state.phase === 'uploading' || state.phase === 'processing';
  const maxBytes = status?.limits.max_upload_bytes ?? 25 * 1024 * 1024;

  const start = async (file: File) => {
    const ext = /\.[^.]+$/.exec(file.name.toLowerCase())?.[0] ?? '';
    if (ext === '.xls') return setState({ phase: 'error', file, message: 'Legacy .xls workbooks are not supported. Save the file as .xlsx or CSV and try again.' });
    if (!ACCEPT.includes(ext)) return setState({ phase: 'error', file, message: `"${file.name}" is not a supported file. Upload a CSV, TSV or Excel (.xlsx) file.` });
    if (file.size === 0) return setState({ phase: 'error', file, message: 'The file is empty.' });
    if (file.size > maxBytes) return setState({ phase: 'error', file, message: `The file is ${formatBytes(file.size)}; the limit is ${formatBytes(maxBytes)}. Upload a filtered or sampled export.` });

    abort.current = new AbortController();
    setState({ phase: 'uploading', file, progress: 0 });
    try {
      const info = await uploadDataset(file, (p) => setState(p >= 1 ? { phase: 'processing', file } : { phase: 'uploading', file, progress: p }), abort.current.signal);
      rememberDataset(info);
      router.push(`/datasets/${info.id}`);
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return setState({ phase: 'idle' });
      setState({ phase: 'error', file, message: e instanceof ApiError ? e.message : 'The upload failed. Please try again.' });
    }
  };

  const onFiles = (files: FileList | null) => {
    if (!files?.length || busy) return;
    if (files.length > 1) return setState({ phase: 'error', message: 'Drop one file at a time.' });
    void start(files[0]);
  };

  return (
    <div className="card flex flex-col p-2">
      <div
        onDragOver={(e) => { e.preventDefault(); if (!busy) setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); onFiles(e.dataTransfer.files); }}
        className={cx(
          'flex min-h-[260px] flex-1 flex-col items-center justify-center rounded-md border-2 border-dashed px-6 py-10 text-center transition-colors',
          dragging ? 'border-primary bg-primary-soft' : 'border-line-strong bg-sunken/50',
        )}
      >
        {busy ? (
          <div className="w-full max-w-sm" aria-live="polite">
            <div className="flex items-center gap-3 text-left">
              <FileSpreadsheet className="h-8 w-8 shrink-0 text-primary" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{state.file.name}</p>
                <p className="text-sm text-muted">
                  {state.phase === 'uploading' ? `Uploading · ${Math.round(state.progress * 100)}% of ${formatBytes(state.file.size)}` : 'Reading rows, inferring types and profiling columns…'}
                </p>
              </div>
              {state.phase === 'uploading' && (
                <Button size="sm" variant="ghost" onClick={() => abort.current?.abort()} icon={<X className="h-4 w-4" aria-hidden />}>Cancel</Button>
              )}
            </div>
            <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-line" role="progressbar" aria-label="Import progress"
              aria-valuemin={0} aria-valuemax={100} aria-valuenow={state.phase === 'uploading' ? Math.round(state.progress * 100) : undefined}>
              <div className={cx('h-full rounded-full bg-primary transition-[width] duration-300', state.phase === 'processing' && 'w-1/3 animate-[shimmer_1.2s_linear_infinite]')}
                style={state.phase === 'uploading' ? { width: `${Math.max(4, state.progress * 100)}%` } : undefined} />
            </div>
          </div>
        ) : (
          <>
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-surface text-primary shadow-card">
              <UploadCloud className="h-6 w-6" aria-hidden />
            </div>
            <p className="mt-4 font-medium">Drop a CSV or Excel file here</p>
            <p className="mt-1 min-h-6 text-sm text-muted">
              CSV, TSV or .xlsx{status && <> · up to {formatBytes(maxBytes)} · {status.limits.max_rows.toLocaleString('en-US')} rows</>}
            </p>
            <Button variant="primary" className="mt-5" onClick={() => input.current?.click()}>Choose a file</Button>
          </>
        )}
        <input ref={input} type="file" accept={ACCEPT.join(',')} className="sr-only" tabIndex={-1} aria-hidden
          onChange={(e) => { onFiles(e.target.files); e.target.value = ''; }} />
      </div>
      {state.phase === 'error' && (
        <Alert tone="danger" className="m-2" title={state.file ? `Could not import ${state.file.name}` : 'Could not import the file'}
          action={<Button size="sm" onClick={() => setState({ phase: 'idle' })}>Dismiss</Button>}>
          {state.message}
        </Alert>
      )}
    </div>
  );
}
