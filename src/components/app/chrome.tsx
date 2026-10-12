'use client';
import { Cpu, Moon, Sparkles, Sun } from 'lucide-react';
import Link from 'next/link';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from '@/lib/client/api';
import type { AppStatus } from '@/lib/types';
import { Badge, IconButton } from '../ui';

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <Link href="/" className="flex items-center gap-2 rounded-md font-semibold tracking-tight" aria-label="InsightLab home">
      <svg viewBox="0 0 24 24" className="h-7 w-7 shrink-0" aria-hidden>
        <rect width="24" height="24" rx="6" className="fill-primary" />
        <path d="M6 16.5V12M10 16.5V8.5M14 16.5V11M18 16.5V6.5" stroke="white" strokeWidth="2" strokeLinecap="round" />
      </svg>
      {!compact && <span>InsightLab</span>}
    </Link>
  );
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<'light' | 'dark' | null>(null);
  useEffect(() => { setTheme(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'); }, []);
  const toggle = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('insightlab.theme', next); } catch { /* not persisted */ }
    setTheme(next);
  };
  return (
    <IconButton label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'} onClick={toggle} size="sm">
      {theme === 'dark' ? <Sun className="h-4 w-4" aria-hidden /> : <Moon className="h-4 w-4" aria-hidden />}
    </IconButton>
  );
}

const StatusContext = createContext<AppStatus | null>(null);

/** Loads the server's public configuration once (AI provider, limits). */
export function StatusProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AppStatus | null>(null);
  useEffect(() => { api.status().then(setStatus).catch(() => setStatus(null)); }, []);
  return <StatusContext.Provider value={status}>{children}</StatusContext.Provider>;
}

export const useAppStatus = () => useContext(StatusContext);

export function AiStatusBadge() {
  const status = useAppStatus();
  if (!status) return null;
  return status.ai.configured
    ? <Badge tone="ai" icon={<Sparkles className="h-3 w-3" aria-hidden />}><span title={`Questions are planned and explained by ${status.ai.model}`} className="sr-only sm:not-sr-only">AI · {status.ai.model}</span></Badge>
    : <Badge tone="neutral" icon={<Cpu className="h-3 w-3" aria-hidden />}><span title={status.ai.message ?? undefined} className="sr-only sm:not-sr-only">Rule-based mode</span></Badge>;
}
