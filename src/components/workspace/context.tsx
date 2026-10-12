'use client';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { api, ApiError, rememberDataset, streamAnalysis } from '@/lib/client/api';
import type { AnalysisStage, AnalysisTurn, DatasetInfo } from '@/lib/types';

/**
 * Workspace state shared by every tab of a dataset. It lives in the dataset
 * layout, so switching between Overview, Data, Ask and SQL keeps a running
 * analysis, the conversation and the composer draft intact.
 */
export interface PendingAnalysis { question: string; stage: AnalysisStage | 'sending'; message: string; startedAt: number }
export interface FailedAnalysis { question: string; message: string; retryable: boolean }

interface WorkspaceValue {
  id: string;
  info: DatasetInfo | null;
  loadError: ApiError | null;
  turns: AnalysisTurn[];
  turnsLoaded: boolean;
  pending: PendingAnalysis | null;
  failure: FailedAnalysis | null;
  draft: string;
  setDraft: (s: string) => void;
  ask: (question: string) => Promise<void>;
  cancel: () => void;
  dismissFailure: () => void;
  clearConversation: () => Promise<void>;
}

const Ctx = createContext<WorkspaceValue | null>(null);

export function useWorkspace(): WorkspaceValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useWorkspace must be used inside WorkspaceProvider');
  return v;
}

/** Workspace that has finished loading its dataset. */
export function useDataset(): WorkspaceValue & { info: DatasetInfo } {
  const v = useWorkspace();
  if (!v.info) throw new Error('Dataset not loaded');
  return v as WorkspaceValue & { info: DatasetInfo };
}

export function WorkspaceProvider({ id, children }: { id: string; children: ReactNode }) {
  const [info, setInfo] = useState<DatasetInfo | null>(null);
  const [loadError, setLoadError] = useState<ApiError | null>(null);
  const [turns, setTurns] = useState<AnalysisTurn[]>([]);
  const [turnsLoaded, setTurnsLoaded] = useState(false);
  const [pending, setPending] = useState<PendingAnalysis | null>(null);
  const [failure, setFailure] = useState<FailedAnalysis | null>(null);
  const [draft, setDraft] = useState('');
  const controller = useRef<AbortController | null>(null);

  useEffect(() => {
    let live = true;
    api.dataset(id).then((d) => { if (!live) return; setInfo(d); rememberDataset(d); })
      .catch((e) => { if (live) setLoadError(e instanceof ApiError ? e : new ApiError('UNKNOWN', 'The dataset could not be loaded.', 0, true)); });
    api.turns(id).then(({ turns: t }) => { if (live) { setTurns(t); setTurnsLoaded(true); } }).catch(() => { if (live) setTurnsLoaded(true); });
    return () => { live = false; controller.current?.abort(); };
  }, [id]);

  const ask = useCallback(async (raw: string) => {
    const question = raw.trim();
    if (!question || controller.current) return; // one analysis at a time; repeated clicks are ignored
    const c = new AbortController();
    controller.current = c;
    setFailure(null);
    setPending({ question, stage: 'sending', message: 'Sending question', startedAt: Date.now() });
    try {
      await streamAnalysis(id, question, (e) => {
        if (e.type === 'stage') setPending((p) => (p ? { ...p, stage: e.stage, message: e.message } : p));
        else if (e.type === 'turn') setTurns((t) => [...t, e.turn]);
        else setFailure({ question, message: e.error.message, retryable: e.error.retryable });
      }, c.signal);
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) {
        setFailure({ question, message: e instanceof ApiError ? e.message : 'The analysis failed unexpectedly.', retryable: e instanceof ApiError ? e.retryable : true });
      }
    } finally {
      controller.current = null;
      setPending(null);
    }
  }, [id]);

  const cancel = useCallback(() => { controller.current?.abort(); }, []);

  const clearConversation = useCallback(async () => {
    await api.clearTurns(id);
    setTurns([]);
    setFailure(null);
  }, [id]);

  return (
    <Ctx.Provider value={{
      id, info, loadError, turns, turnsLoaded, pending, failure, draft, setDraft, ask, cancel,
      dismissFailure: () => setFailure(null), clearConversation,
    }}>
      {children}
    </Ctx.Provider>
  );
}
