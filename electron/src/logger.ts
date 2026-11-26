import { app } from 'electron';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const MAX_LOG_BYTES = 1_500_000;

const SECRET_PATTERNS: RegExp[] = [
  /\b(gh[pousr]_[A-Za-z0-9_]{8,})\b/g,
  /\b(github_pat_[A-Za-z0-9_]{16,})\b/g,
  /\b(sk-[A-Za-z0-9_-]{12,})\b/g,
  /\b(gsk_[A-Za-z0-9_-]{12,})\b/g,
  /(Bearer\s+)[A-Za-z0-9._-]{8,}/gi,
  /(https?:\/\/)([^:/\s@]+):([^@/\s]+)@/gi,
];

export function redactElectronSecrets(raw: string): string {
  let out = raw;
  out = out.replace(SECRET_PATTERNS[0], '[REDACTED]');
  out = out.replace(SECRET_PATTERNS[1], '[REDACTED]');
  out = out.replace(SECRET_PATTERNS[2], '[REDACTED]');
  out = out.replace(SECRET_PATTERNS[3], '[REDACTED]');
  out = out.replace(SECRET_PATTERNS[4], '$1[REDACTED]');
  out = out.replace(SECRET_PATTERNS[5], '$1$2:[REDACTED]@');
  return out;
}

function getLogFilePath(): string {
  try {
    if (app.isReady()) {
      return path.join(app.getPath('logs'), 'vega-electron.log');
    }
  } catch {
    // Fallback before app ready
  }
  return path.join(os.tmpdir(), 'vega-studio-electron.log');
}

function appendRotatingLine(line: string): void {
  try {
    const filePath = getLogFilePath();
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    try {
      const st = fs.statSync(filePath);
      if (st.size >= MAX_LOG_BYTES) {
        const backup = `${filePath}.1`;
        try {
          fs.rmSync(backup, { force: true });
        } catch {
          // ignore
        }
        fs.renameSync(filePath, backup);
      }
    } catch {
      // File may not exist yet
    }
    fs.appendFileSync(filePath, `${line}\n`, { encoding: 'utf8' });
  } catch {
    // Never crash the app over log writes
  }
}

export function logInfo(scope: string, message: string): void {
  const clean = redactElectronSecrets(message);
  const line = `${new Date().toISOString()} [INFO] [${scope}] ${clean}`;
  console.log(line);
  appendRotatingLine(line);
}

export function logWarn(scope: string, message: string): void {
  const clean = redactElectronSecrets(message);
  const line = `${new Date().toISOString()} [WARN] [${scope}] ${clean}`;
  console.warn(line);
  appendRotatingLine(line);
}

export function logError(scope: string, message: string): void {
  const clean = redactElectronSecrets(message);
  const line = `${new Date().toISOString()} [ERROR] [${scope}] ${clean}`;
  console.error(line);
  appendRotatingLine(line);
}
