import { execFile } from 'child_process'
import path from 'path'
import fs from 'fs'

export type CodeSearchArgs = {
  pattern: string
  path?: string
  glob?: string
  maxResults?: number
  caseInsensitive?: boolean
  regex?: boolean
}

export type CodeSearchResult = {
  file: string
  line: number
  text: string
}

const DEFAULT_IGNORES = [
  'node_modules', '.git', '.next', 'dist', 'build', 'uploads', 'backups',
]
const DEFAULT_DENY_FILE_PATTERNS = [/^\.env(\..*)?$/, /\.pem$/i, /\.key$/i, /\.secret$/i, /\.token$/i]

function isBinaryFile(filePath: string): boolean {
  try {
    const stat = fs.statSync(filePath)
    if (stat.size === 0) return false
    const fd = fs.openSync(filePath, 'r')
    const buf = Buffer.alloc(512)
    const bytes = fs.readSync(fd, buf, 0, 512, 0)
    fs.closeSync(fd)
    for (let i = 0; i < bytes; i++) {
      const c = buf[i]
      if (c === 0) return true
    }
    return false
  } catch {
    return false
  }
}

function withinRoot(root: string, target: string): boolean {
  const rel = path.relative(root, target)
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel)
}

export async function codeSearch(args: CodeSearchArgs): Promise<{ results: CodeSearchResult[]; used: 'rg'|'grep'|'none' }>{
  const pattern = String(args.pattern || '').trim()
  if (!pattern) throw new Error('pattern is required')

  // Resolve repo root as two levels up from compiled dist file location at runtime
  // Here at source, assume runtime __dirname will be backend/dist/tools
  const repoRoot = path.resolve(__dirname, '../../..')
  const searchRoot = args.path ? path.resolve(repoRoot, args.path) : repoRoot
  if (!withinRoot(repoRoot, searchRoot)) throw new Error('path outside allowed root')

  const maxResults = Math.max(1, Math.min(1000, Number(args.maxResults ?? 200)))
  const caseInsensitive = !!args.caseInsensitive
  const useRegex = !!args.regex
  const glob = String(args.glob || '')

  // Helper to filter/secure results
  const filterLine = (file: string, line: number, text: string): boolean => {
    const base = path.basename(file)
    if (DEFAULT_DENY_FILE_PATTERNS.some((re) => re.test(base))) return false
    if (isBinaryFile(file)) return false
    return true
  }

  const results: CodeSearchResult[] = []
  // Try ripgrep first
  const rgArgs = [
    '--no-require-git',
    '--line-number',
    '--color=never',
    '--hidden',
    ...DEFAULT_IGNORES.flatMap((d) => ['-g', `!**/${d}/**`]),
  ]
  if (caseInsensitive) rgArgs.push('-i')
  if (!useRegex) rgArgs.push('--fixed-strings')
  if (glob) rgArgs.push('-g', glob)
  rgArgs.push(pattern, '.')

  const ran = await new Promise<'rg'|'grep'|'none'>(resolve => {
    const child = execFile('rg', rgArgs, { cwd: searchRoot, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (!err && stdout) {
        const lines = stdout.split(/\r?\n/)
        for (const line of lines) {
          if (!line) continue
          // Format: file:line:match
          const m = line.match(/^(.*?):(\d+):(.*)$/)
          if (!m) continue
          const file = path.resolve(searchRoot, m[1])
          const ln = Number(m[2])
          const text = m[3]
          if (!withinRoot(repoRoot, file)) continue
          if (!filterLine(file, ln, text)) continue
          results.push({ file: path.relative(repoRoot, file), line: ln, text })
          if (results.length >= maxResults) break
        }
        resolve('rg')
      } else {
        resolve('none')
      }
    })
    // Safety: if rg not found quickly, fallback will run
    setTimeout(() => resolve('none'), 1500)
  })

  if (ran === 'rg') {
    return { results, used: 'rg' }
  }

  // Fallback to grep -R
  const grepArgs = [
    '-R',
    '-n',
    ...(caseInsensitive ? ['-i'] : []),
    ...(useRegex ? [] : ['-F']),
    pattern,
    '.',
  ]

  await new Promise<void>((resolve) => {
    execFile('grep', grepArgs, { cwd: searchRoot, maxBuffer: 10 * 1024 * 1024 }, (err, stdout) => {
      if (!err && stdout) {
        const lines = stdout.split(/\r?\n/)
        for (const line of lines) {
          if (!line) continue
          const m = line.match(/^(.*?):(\d+):(.*)$/)
          if (!m) continue
          const fileAbs = path.resolve(searchRoot, m[1])
          const ln = Number(m[2])
          const text = m[3]
          if (!withinRoot(repoRoot, fileAbs)) continue
          if (DEFAULT_IGNORES.some((d) => fileAbs.includes(`/${d}/`))) continue
          if (!filterLine(fileAbs, ln, text)) continue
          results.push({ file: path.relative(repoRoot, fileAbs), line: ln, text })
          if (results.length >= maxResults) break
        }
      }
      resolve()
    })
  })

  return { results, used: 'grep' }
}


