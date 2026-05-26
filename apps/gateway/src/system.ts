import { execFile } from 'node:child_process';
import os from 'node:os';
import { promisify } from 'node:util';
import type { AppConfig } from './config.js';

const execFileAsync = promisify(execFile);

export interface DiskStatus {
  path: string;
  filesystem?: string;
  totalKiB?: number;
  usedKiB?: number;
  availableKiB?: number;
  percentUsed?: number;
  error?: string;
}

async function diskForPath(target: string): Promise<DiskStatus> {
  try {
    const { stdout } = await execFileAsync('df', ['-Pk', target], { timeout: 5000 });
    const lines = stdout.trim().split('\n');
    const row = lines[1]?.split(/\s+/);
    if (!row || row.length < 6) return { path: target, error: 'Unexpected df output' };
    return {
      path: target,
      filesystem: row[0],
      totalKiB: Number(row[1]),
      usedKiB: Number(row[2]),
      availableKiB: Number(row[3]),
      percentUsed: Number(row[4]?.replace('%', ''))
    };
  } catch (error) {
    return { path: target, error: error instanceof Error ? error.message : String(error) };
  }
}

async function portListening(port: number): Promise<boolean | string> {
  try {
    const { stdout } = await execFileAsync('ss', ['-ltn'], { timeout: 5000 });
    return stdout.includes(`:${port} `) || stdout.includes(`:${port}\n`);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

export async function systemOverview(config: AppConfig): Promise<Record<string, unknown>> {
  const disks = await Promise.all(
    [config.baseDir, config.modelDir, config.cacheDir, config.voiceDir, config.uploadDir, config.outputDir].map(
      diskForPath
    )
  );

  return {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    uptimeSeconds: Math.round(process.uptime()),
    hostUptimeSeconds: Math.round(os.uptime()),
    loadAverage: os.loadavg(),
    memory: {
      totalBytes: os.totalmem(),
      freeBytes: os.freemem()
    },
    paths: {
      baseDir: config.baseDir,
      modelDir: config.modelDir,
      cacheDir: config.cacheDir,
      voiceDir: config.voiceDir,
      uploadDir: config.uploadDir,
      outputDir: config.outputDir,
      logDir: config.logDir
    },
    ports: {
      public: { host: config.publicHost, port: config.publicPort, listening: await portListening(config.publicPort) },
      sttWorker: { url: config.sttWorkerUrl },
      ttsWorker: { url: config.ttsWorkerUrl }
    },
    disks
  };
}
