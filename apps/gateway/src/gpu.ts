import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { GpuDeviceInfo, GpuStatus } from '@local-ai-voice/shared';

const execFileAsync = promisify(execFile);

function num(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const cleaned = value.replace(/MiB|%|C/g, '').trim();
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseGpuLine(line: string): GpuDeviceInfo | null {
  const parts = line.split(',').map((part) => part.trim());
  if (parts.length < 8) return null;
  return {
    index: num(parts[0]) ?? 0,
    name: parts[1] ?? 'Unknown NVIDIA GPU',
    driverVersion: parts[2],
    memoryTotalMiB: num(parts[3]),
    memoryUsedMiB: num(parts[4]),
    memoryFreeMiB: num(parts[5]),
    utilizationGpuPercent: num(parts[6]),
    temperatureC: num(parts[7])
  };
}

export async function getGpuStatus(): Promise<GpuStatus> {
  const checkedAt = new Date().toISOString();
  try {
    const { stdout } = await execFileAsync(
      'nvidia-smi',
      [
        '--query-gpu=index,name,driver_version,memory.total,memory.used,memory.free,utilization.gpu,temperature.gpu',
        '--format=csv,noheader,nounits'
      ],
      { timeout: 5000 }
    );
    const devices = stdout
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map(parseGpuLine)
      .filter((device): device is GpuDeviceInfo => device !== null);

    return { available: devices.length > 0, checkedAt, devices };
  } catch (error) {
    return {
      available: false,
      checkedAt,
      devices: [],
      error: error instanceof Error ? error.message : String(error)
    };
  }
}
