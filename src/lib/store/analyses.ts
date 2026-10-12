import 'server-only';
import fs from 'node:fs';
import path from 'node:path';
import type { AnalysisTurn } from '../types';
import { datasetDir } from './datasets';

/**
 * The analysis conversation for a dataset, stored next to it on disk so it
 * survives page reloads and server restarts, and is deleted with the dataset.
 */
const MAX_TURNS = 200;

function file(id: string): string {
  return path.join(datasetDir(id), 'analyses.json');
}

export function listTurns(id: string): AnalysisTurn[] {
  try {
    return JSON.parse(fs.readFileSync(file(id), 'utf8')) as AnalysisTurn[];
  } catch {
    return [];
  }
}

export function appendTurn(id: string, turn: AnalysisTurn): void {
  const turns = [...listTurns(id), turn].slice(-MAX_TURNS);
  const target = file(id);
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(turns));
  fs.renameSync(tmp, target);
}

export function clearTurns(id: string): void {
  fs.rmSync(file(id), { force: true });
}
