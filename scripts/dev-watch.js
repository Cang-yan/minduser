'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { execSync } = require('node:child_process')
const { spawn } = require('node:child_process')

const PROJECT_ROOT = path.resolve(__dirname, '..')
const SLEEP_BUFFER = new SharedArrayBuffer(4)
const SLEEP_ARRAY = new Int32Array(SLEEP_BUFFER)

function sleep(ms) {
  Atomics.wait(SLEEP_ARRAY, 0, 0, ms)
}

function readCwdSafe(pid) {
  try {
    return fs.readlinkSync(`/proc/${pid}/cwd`)
  } catch {
    return ''
  }
}

function processAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function readArgsSafe(pid) {
  try {
    return execSync(`ps -p ${pid} -o args=`, { encoding: 'utf8' }).trim()
  } catch {
    return ''
  }
}

function listListenPidsByPort(port) {
  if (!Number.isInteger(port) || port <= 0) return []

  try {
    const out = execSync(`lsof -tiTCP:${port} -sTCP:LISTEN -n -P`, { encoding: 'utf8' })
    return out
      .split('\n')
      .map((line) => Number.parseInt(line.trim(), 10))
      .filter((pid) => Number.isInteger(pid) && pid > 1)
  } catch {
    return []
  }
}

function listStalePids() {
  let out = ''
  try {
    out = execSync('ps -eo pid,args', { encoding: 'utf8' })
  } catch {
    return []
  }

  const result = []
  const lines = out.split('\n').slice(1)
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue

    const matched = trimmed.match(/^(\d+)\s+(.+)$/)
    if (!matched) continue

    const pid = Number.parseInt(matched[1], 10)
    const args = matched[2]

    if (!Number.isInteger(pid) || pid <= 1 || pid === process.pid) continue
    if (!args.includes('server/server.js')) continue
    if (!args.includes('node')) continue

    const cwd = readCwdSafe(pid)
    // Prefer strong match via /proc/<pid>/cwd.
    if (cwd) {
      if (cwd !== PROJECT_ROOT) continue
    } else {
      // Fallback for restricted /proc environments: only match highly specific watcher command.
      const rootMarker = `${PROJECT_ROOT.replace(/\\/g, '/')}/server/server.js`
      const looksLikeProjectWatch =
        args.includes(rootMarker) ||
        args.includes('MINDUSER_DEV_WATCH=1 node --watch server/server.js')
      if (!looksLikeProjectWatch) continue
    }

    result.push(pid)
  }

  return result
}

function killPid(pid) {
  if (!processAlive(pid)) return

  try {
    process.kill(pid, 'SIGTERM')
  } catch {
    return
  }

  const deadline = Date.now() + 600
  while (Date.now() < deadline) {
    if (!processAlive(pid)) return
    sleep(30)
  }

  try {
    process.kill(pid, 'SIGKILL')
  } catch {
    // Ignore if process already exited.
  }
}

function cleanupStaleProcesses() {
  const pids = listStalePids()
  for (const pid of pids) {
    killPid(pid)
  }
  if (pids.length > 0) {
    console.log(`[dev-watch] cleaned stale server processes: ${pids.join(', ')}`)
  }
}

function cleanupPortListener() {
  const port = Number.parseInt(process.env.PORT || '3100', 10)
  if (!Number.isInteger(port) || port <= 0) return

  const pids = listListenPidsByPort(port)
  if (pids.length === 0) return

  const killed = []
  for (const pid of pids) {
    if (pid === process.pid) continue

    const args = readArgsSafe(pid)
    if (!args.includes('server/server.js')) continue
    if (!args.includes('node')) continue

    const cwd = readCwdSafe(pid)
    if (cwd && cwd !== PROJECT_ROOT) continue

    killPid(pid)
    killed.push(pid)
  }

  if (killed.length > 0) {
    console.log(`[dev-watch] released port ${port} from stale process: ${killed.join(', ')}`)
  }
}

cleanupStaleProcesses()
cleanupPortListener()

const child = spawn(process.execPath, ['--watch', 'server/server.js'], {
  detached: true,
  stdio: 'inherit',
  env: {
    ...process.env,
    MINDUSER_DEV_WATCH: '1',
  },
})

let isShuttingDown = false

function killProcessGroup(signal = 'SIGTERM') {
  if (!child.pid) return
  try {
    // Negative PID means "process group" on POSIX.
    process.kill(-child.pid, signal)
  } catch {
    // Ignore if process already exited.
  }
}

function shutdown(signal = 'SIGTERM') {
  if (isShuttingDown) return
  isShuttingDown = true

  killProcessGroup(signal)

  const forceTimer = setTimeout(() => {
    killProcessGroup('SIGKILL')
  }, 1000)
  forceTimer.unref()

  const exitTimer = setTimeout(() => {
    process.exit(0)
  }, 1200)
  exitTimer.unref()
}

process.once('SIGINT', () => shutdown('SIGINT'))
process.once('SIGTERM', () => shutdown('SIGTERM'))

process.once('exit', () => {
  if (!isShuttingDown) {
    killProcessGroup('SIGTERM')
  }
})

child.once('error', (err) => {
  console.error('[dev-watch] failed to start watcher:', err.message)
  process.exit(1)
})

child.once('exit', (code, signal) => {
  if (!isShuttingDown) {
    isShuttingDown = true
  }
  if (typeof code === 'number') {
    process.exit(code)
  }
  process.exit(signal ? 0 : 1)
})
