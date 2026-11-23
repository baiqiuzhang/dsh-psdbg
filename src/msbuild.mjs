import { spawnSync } from 'node:child_process';

export const MSBUILD = 'C:\\Program Files (x86)\\Microsoft Visual Studio\\2022\\BuildTools\\MSBuild\\Current\\Bin\\MSBuild.exe';

/**
 * Windows environment variables are case-insensitive, but Node exposes both
 * `HTTPS_PROXY` and `https_proxy` when the parent process does. MSBuild's
 * ProcessStartInfo throws "duplicate key" on such a block, so collapse them.
 */
export function cleanEnv(env = process.env) {
  const seen = new Map();
  for (const [key, value] of Object.entries(env)) {
    const lower = key.toLowerCase();
    if (!seen.has(lower)) seen.set(lower, { key, value });
  }
  const out = {};
  for (const { key, value } of seen.values()) out[key] = value;
  return out;
}

export function runMsbuild(opts = {}) {
  const project = opts.project;
  if (!project) throw new Error('project path is required');
  const args = [project, '/nologo', '/v:minimal'];
  if (opts.targets) args.push(`/t:${opts.targets}`);
  const props = {
    Configuration: opts.configuration || 'Debug',
    Platform: opts.platform || 'x64',
    ...(opts.properties || {}),
  };
  for (const [k, v] of Object.entries(props)) {
    if (v !== undefined && v !== null && v !== '') args.push(`/p:${k}=${v}`);
  }
  if (opts.extraArgs) args.push(...opts.extraArgs);

  const env = cleanEnv(opts.env);
  if (opts.includeDirs?.length) {
    env.INCLUDE = [...opts.includeDirs, env.INCLUDE].filter(Boolean).join(';');
  }
  const t0 = Date.now();
  const r = spawnSync(MSBUILD, args, {
    cwd: opts.cwd,
    env,
    encoding: 'utf8',
    timeout: opts.timeoutMs ?? 10 * 60 * 1000,
    windowsHide: true,
    maxBuffer: 32 * 1024 * 1024,
  });
  const output = `${r.stdout || ''}\n${r.stderr || ''}`.trim();
  const errors = [];
  const warnings = [];
  for (const line of output.split(/\r?\n/)) {
    if (/\berror\s+[A-Z]+\d+/.test(line) || /\berror MSB\d+/.test(line)) errors.push(line.trim());
    else if (/\bwarning\s+[A-Z]+\d+/.test(line) || /\bwarning MSB\d+/.test(line)) warnings.push(line.trim());
  }
  return {
    ok: r.status === 0,
    exitCode: r.status,
    signal: r.signal || null,
    elapsedMs: Date.now() - t0,
    command: [MSBUILD, ...args],
    errors: errors.slice(0, 80),
    warnings: warnings.slice(0, 80),
    output: output.slice(-12000),
  };
}
