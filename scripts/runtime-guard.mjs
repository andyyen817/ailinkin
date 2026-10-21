export function runtimeAllowed(role, env = process.env) {
  for (const name of ['APP_RUNTIME_ENABLED', 'WORKERS_ENABLED']) {
    if (env[name] !== undefined && !['true', 'false'].includes(env[name])) {
      throw Error('INVALID_RUNTIME_SWITCH: ' + name);
    }
  }
  return env.APP_RUNTIME_ENABLED !== 'false' &&
    (role === 'web' || env.WORKERS_ENABLED !== 'false');
}

export function requireRuntime(role, env = process.env) {
  if (!runtimeAllowed(role, env)) throw Error('RUNTIME_DISABLED: ' + role);
}
