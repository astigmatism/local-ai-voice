import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { AppConfig } from './config.js';

export interface LogEntry {
  file: string;
  line: string;
}

export async function recentLogs(config: AppConfig, limit = 200): Promise<LogEntry[]> {
  try {
    const entries = await fs.readdir(config.logDir, { withFileTypes: true });
    const files = entries
      .filter((entry) => entry.isFile() && /\.(log|txt|jsonl)$/.test(entry.name))
      .map((entry) => path.join(config.logDir, entry.name));
    const lines: LogEntry[] = [];
    for (const file of files.slice(0, 10)) {
      const raw = await fs.readFile(file, 'utf8').catch(() => '');
      const fileLines = raw
        .split('\n')
        .filter(Boolean)
        .slice(-Math.ceil(limit / Math.max(files.length, 1)))
        .map((line) => ({ file: path.basename(file), line }));
      lines.push(...fileLines);
    }
    return lines.slice(-limit);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}
