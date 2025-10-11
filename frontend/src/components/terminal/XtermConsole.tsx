'use client'

import React from 'react'
import { Terminal } from 'xterm'
import { FitAddon } from 'xterm-addon-fit'
import 'xterm/css/xterm.css'

type FileKind = 'html' | 'css' | 'js'
type FileBuf = { id: string; name: string; kind: FileKind; content: string }

type Props = {
  files: FileBuf[]
  onFilesChange: (next: FileBuf[]) => void
  activeFileId: string
  onActiveFileChange: (id: string) => void
  prompt: string
  path: string
  onPathChange: (p: string) => void
  resetNonce: number
  onExecBackend?: (command: string) => Promise<string>
}

export default function XtermConsole({ files, onFilesChange, activeFileId, onActiveFileChange, prompt, path, onPathChange, resetNonce, onExecBackend }: Props) {
  const containerRef = React.useRef<HTMLDivElement | null>(null)
  const termRef = React.useRef<Terminal | null>(null)
  const fitRef = React.useRef<FitAddon | null>(null)
  const lineRef = React.useRef<string>('')

  React.useEffect(() => {
    const term = new Terminal({
      convertEol: true,
      cursorBlink: true,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      fontSize: 12,
      theme: {
        background: '#00000000',
        foreground: '#d4d4d4',
        cursor: '#e5e5e5',
      },
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(containerRef.current!)
    fit.fit()
    termRef.current = term
    fitRef.current = fit

    const writePrompt = () => term.write(`\r\n\x1b[38;5;48m${prompt}\x1b[0m `)
    term.writeln(`xterm ready — type 'help' or 'clear'.`)
    writePrompt()

    const onResize = () => {
      try { fit.fit() } catch {}
    }
    window.addEventListener('resize', onResize)

    term.onData((data) => {
      const ch = data
      const code = ch.charCodeAt(0)
      if (code === 13) { // Enter
        const line = lineRef.current
        handleCommand(line)
        lineRef.current = ''
        writePrompt()
        return
      }
      if (code === 127) { // Backspace
        if (lineRef.current.length > 0) {
          lineRef.current = lineRef.current.slice(0, -1)
          term.write('\b \b')
        }
        return
      }
      // Printable
      if (code >= 32) {
        lineRef.current += ch
        term.write(ch)
      }
    })

    return () => {
      window.removeEventListener('resize', onResize)
      try { term.dispose() } catch {}
      termRef.current = null
    }
  }, [])

  React.useEffect(() => {
    if (!termRef.current) return
    // soft clear and show prompt
    termRef.current.clear()
    termRef.current.writeln(`xterm ready — type 'help' or 'clear'.`)
    termRef.current.write(`\r\n\x1b[38;5;48m${prompt}\x1b[0m `)
  }, [resetNonce, prompt])

  function out(s: string){ termRef.current?.writeln(s) }

  function handleCommand(line: string){
    const trimmed = line.trim()
    if (!trimmed) return
    const parts = trimmed.split(/\s+/)
    const cmd = parts[0]
    const args = parts.slice(1)
    switch (cmd) {
      case 'help':
        out('Commands: pwd, ls, cat <file>, touch <file>, rm <file>, echo, cd <path>, clear')
        break
      case 'clear':
        termRef.current?.clear()
        break
      case 'pwd':
        out(path)
        break
      case 'cd':
        onPathChange(args[0] || '~')
        out(`changed directory to ${args[0] || '~'}`)
        break
      case 'ls':
        out(files.map(f => f.name).join('  '))
        break
      case 'cat': {
        const f = files.find(f => f.name === args[0])
        out(f ? f.content : `cat: ${args[0]}: No such file`)
        break
      }
      case 'touch': {
        const name = args[0]
        if (!name) { out('touch: missing file operand'); break }
        if (files.some(f => f.name === name)) { out(''); break }
        const ext = (name.split('.').pop() || 'js') as FileKind
        const kind: FileKind = (ext === 'html' || ext === 'css' || ext === 'js') ? ext : 'js'
        const id = `f-${kind}-${Math.random().toString(36).slice(2,8)}`
        onFilesChange([...files, { id, name, kind, content: '' }])
        onActiveFileChange(id)
        break
      }
      case 'rm': {
        const name = args[0]
        const idx = files.findIndex(f => f.name === name)
        if (idx < 0) { out(`rm: ${name}: No such file`); break }
        const removed = files[idx]
        const next = files.filter((_,i)=>i!==idx)
        onFilesChange(next)
        if (removed.id === activeFileId && next.length) onActiveFileChange(next[0].id)
        break
      }
      case 'echo':
        out(args.join(' '))
        break
      case 'ping': {
        const target = args[0]
        if (!target) { out('usage: ping <host>'); break }
        if (!onExecBackend) { out('backend not connected'); break }
        onExecBackend(`ping -c 4 ${target}`).then((s)=>out(s)).catch(()=>out('ping failed'))
        break
      }
      case 'traceroute': {
        const target = args[0]
        if (!target) { out('usage: traceroute <host>'); break }
        if (!onExecBackend) { out('backend not connected'); break }
        onExecBackend(`traceroute ${target}`).then((s)=>out(s)).catch(()=>out('traceroute failed'))
        break
      }
      case 'nslookup': {
        const target = args[0]
        if (!target) { out('usage: nslookup <host>'); break }
        if (!onExecBackend) { out('backend not connected'); break }
        onExecBackend(`nslookup ${target}`).then((s)=>out(s)).catch(()=>out('nslookup failed'))
        break
      }
      default:
        out(`sh: ${cmd}: command not found`)
    }
  }

  return <div ref={containerRef} className="w-full h-full" />
}


