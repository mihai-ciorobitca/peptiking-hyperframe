import path from 'node:path'
import { createRequire } from 'node:module'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { childEnvironment, run, serviceDir } from './runtime.mjs'

const require = createRequire(import.meta.url)
export const codexCli = require.resolve('@openai/codex/bin/codex.js')

// Reuse the laptop's login through the official CLI. Never read/copy auth tokens.
export function codexEnvironment(cfg, env = process.env) {
  return { ...childEnvironment(env), ...(cfg.codexHome ? { CODEX_HOME: cfg.codexHome } : {}) }
}

export async function verifyCodexLogin(cfg, signal) {
  const status = await run(process.execPath, [codexCli, 'login', 'status'], { env: codexEnvironment(cfg), signal })
  if (!/Logged in using ChatGPT/i.test(status)) throw new Error('Sign Codex into your ChatGPT account on this laptop: npm run login. API-key login is not used by this worker.')
}

export function codexArguments(cfg, directory, imagePaths = []) {
  return ['exec', '--ignore-user-config', '--ephemeral', '--skip-git-repo-check', '--sandbox', 'read-only',
    '--model', cfg.model, '-c', `model_reasoning_effort="${cfg.effort}"`,
    '-c', 'forced_login_method="chatgpt"', '-c', 'approval_policy="never"', '-c', 'web_search="disabled"',
    '-c', 'project_doc_max_bytes=0', '-c', 'features.shell_tool=false', '-c', 'features.apps=false',
    '-c', 'features.plugins=false', '-c', 'features.hooks=false', '-c', 'features.multi_agent=false',
    '--cd', directory, '--output-schema', path.join(directory, 'schema.json'),
    '--output-last-message', path.join(directory, 'plan.json'), '--color', 'never',
    ...imagePaths.flatMap(file => ['--image', file]), '-']
}

export async function runCodexPlan({ prompt, images = [], schema, directory }, cfg, signal) {
  await verifyCodexLogin(cfg, signal)
  await mkdir(directory, { recursive: true })
  await writeFile(path.join(directory, 'schema.json'), JSON.stringify(schema))
  const imagePaths = []
  for (const [index, image] of images.entries()) {
    if (!/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(image.url)) throw new Error('Invalid planner thumbnail.')
    const file = path.join(directory, `image-${index}.jpg`)
    await writeFile(file, Buffer.from(image.url.split(',')[1], 'base64'))
    imagePaths.push(file)
  }
  await run(process.execPath, [codexCli, ...codexArguments(cfg, directory, imagePaths)], {
    cwd: directory, signal, env: codexEnvironment(cfg), input: prompt,
  })
  return JSON.parse(await readFile(path.join(directory, 'plan.json'), 'utf8'))
}

// npm run login uses the same CLI/auth location as the worker, without altering user config.
if (process.argv[2] === 'login') {
  const cfg = { codexHome: process.env.HYPERFRAMES_CODEX_HOME || process.env.CODEX_HOME }
  const { spawn } = await import('node:child_process')
  const child = spawn(process.execPath, [codexCli, 'login'], { cwd: serviceDir, env: codexEnvironment(cfg), stdio: 'inherit', windowsHide: true })
  child.on('error', error => { console.error(error.message); process.exitCode = 1 })
  child.on('close', code => { process.exitCode = code ?? 1 })
}
