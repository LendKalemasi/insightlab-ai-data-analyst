import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Points the dataset store at a fresh temporary directory. Must run before
 * any module that reads `config` is imported, so test files call it first
 * and then import the modules under test dynamically.
 */
export function useTempDataDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'insightlab-test-'));
  process.env.DATA_DIR = dir;
  process.env.LLM_PROVIDER = 'local';
  delete process.env.PYTHON_SERVICE_URL;
  return dir;
}
