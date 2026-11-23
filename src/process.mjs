import { spawnSync } from 'node:child_process';

export function photoshopProcesses() {
  const script = `
    $p = @(Get-Process Photoshop -ErrorAction SilentlyContinue | Select-Object Id,MainWindowTitle,MainWindowHandle)
    if ($p.Count -eq 0) { '[]' } else { $p | ConvertTo-Json -Compress }
  `;
  const r = spawnSync('powershell.exe', ['-NoProfile', '-Command', script], {
    encoding: 'utf8',
    timeout: 15000,
    windowsHide: true,
  });
  if (r.status !== 0) return [];
  try {
    const raw = (r.stdout || '').trim();
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [];
  }
}

export function photoshopPid() {
  const p = photoshopProcesses().find((x) => Number(x.MainWindowHandle) !== 0);
  return p ? Number(p.Id) : null;
}
