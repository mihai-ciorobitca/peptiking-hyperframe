export function safeLogText(value, secrets = []) {
  let text = String(value ?? '')
  for (const secret of secrets.filter(Boolean)) text = text.split(secret).join('[redacted]')
  return text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/https?:\/\/[^\s"<>]+/gi, '[url]')
    .replace(/\b(?:Bearer\s+\S+|sk-[\w-]+|eyJ[\w-]+\.[\w-]+\.[\w-]+)\b/g, '[redacted]')
    .replace(/[\x00-\x1f\x7f]/g, ' ').slice(0, 800)
}

export function createLogger(cfg, job, { now = Date.now, sink = console.log } = {}) {
  const started = now()
  let lastProgress = '', lastAt = -Infinity
  const secrets = [cfg.serviceRoleKey, cfg.flowKey]
  const clean = value => safeLogText(value, secrets)
  const emit = (status, message = '') => {
    const identity = job
      ? ` user=${JSON.stringify(clean(job.user_email || 'unknown'))} userId=${clean(job.user_id)} job=${clean(job.job_id)} operation=${clean(job.operation)} attempt=${clean(job.attempts)}`
      : ''
    sink(`${new Date(now()).toISOString()} [hyperframes-worker] worker=${clean(cfg.workerId)}${identity} status=${clean(status)} elapsed=${Math.floor((now() - started) / 1000)}s ${clean(message)}`)
  }
  return {
    emit,
    progress(stage, message, percent) {
      const key = JSON.stringify([stage, message, percent])
      if (key === lastProgress && now() - lastAt < 30000) return
      lastProgress = key
      lastAt = now()
      emit('running', `stage=${stage} progress=${percent}% ${message}`)
    },
  }
}
