'use client'

import React, { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { BookOpen, Inbox, Code2, Maximize2, Minimize2, Trash2, Terminal as TerminalIcon } from 'lucide-react'
import dynamic from 'next/dynamic'
const XtermConsole = dynamic(() => import('@/components/terminal/XtermConsole'), { ssr: false })
import { resolveWsUrl, WSClient } from '@/lib/chat'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger, DropdownMenuCheckboxItem } from '@/components/ui/dropdown-menu'
import { Allotment } from 'allotment'
import 'allotment/dist/style.css'

// Minimal, self-contained VIM/EMACS-style coding surface.
// - Left: buffers sidebar + tabbed editors for HTML/CSS/JS
// - Center: sandboxed preview (iframe srcDoc)
// - Right: agent stub panel (model/mode + chat log)
// - Draggable dividers for flexible layout
// - Console becomes interactive terminal with JS eval into iframe

function buildSrcDoc(html: string, css: string, js: string): string {
  const esc = (s: string) => s.replace(/<\/(script)/gi, '<' + '/$1')
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      html, body { margin: 0; padding: 0; height: 100%; }
      ${css}
    </style>
  </head>
  <body>
${html}
    <script>
      try {
        const __originalLog = console.log.bind(console);
        console.log = function(...args){ __originalLog(...args); try { parent.postMessage({ type: 'goosecode:log', args }, '*') } catch(_){} };
        window.onerror = function(msg, src, line, col, err){ try { parent.postMessage({ type: 'goosecode:error', msg: String(msg), src, line, col }, '*') } catch(_){} };
        // Eval bridge: receive code from parent and evaluate in iframe context
        window.addEventListener('message', function(ev){
          const d = ev && ev.data || {};
          if (!d || d.type !== 'goosecode:eval') return;
          const code = String(d.code || '');
          try {
            const value = eval(code);
            if (value && typeof value.then === 'function') {
              Promise.resolve(value).then(function(v){
                try { parent.postMessage({ type: 'goosecode:eval:result', ok: true, value: v }, '*') } catch(_){}
              }).catch(function(e){
                try { parent.postMessage({ type: 'goosecode:eval:result', ok: false, error: String(e && (e.stack || e.message) || e) }, '*') } catch(_){}
              });
            } else {
              try { parent.postMessage({ type: 'goosecode:eval:result', ok: true, value }, '*') } catch(_){}
            }
          } catch (e) {
            try { parent.postMessage({ type: 'goosecode:eval:result', ok: false, error: String(e && (e.stack || e.message) || e) }, '*') } catch(_){}
          }
        });
      } catch(_) {}
    </script>
    <script>${esc(js)}</script>
  </body>
</html>`
}

type FileKind = 'html' | 'css' | 'js'
type FileBuf = { id: string; name: string; kind: FileKind; content: string }

export default function GooseCodePage() {
  const [files, setFiles] = useState<FileBuf[]>([
    {
      id: 'f-html-1',
      name: 'index.html',
      kind: 'html',
      content: `<main style="height:100%;display:grid;place-items:center;">
  <canvas id="c" width="480" height="320" style="border:1px solid #444;border-radius:8px;background:#111"></canvas>
  <p style="position:fixed;bottom:10px;left:10px;color:#999;font:12px/1.2 system-ui">Tip: :run to refresh • :w to save (stub)</p>
</main>`
    },
    {
      id: 'f-css-1',
      name: 'styles.css',
      kind: 'css',
      content: `*{box-sizing:border-box}
:root{color-scheme:dark}
body{font:14px/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;background:#0a0a0a;color:#e5e5e5}
button{cursor:pointer}
`
    },
    {
      id: 'f-js-1',
      name: 'app.js',
      kind: 'js',
      content: `(function(){
  const ctx = document.getElementById('c').getContext('2d');
  let t = 0;
  function frame(){
    t += 0.02;
    const w = ctx.canvas.width, h = ctx.canvas.height;
    ctx.clearRect(0,0,w,h);
    for(let i=0;i<64;i++){
      const x = w/2 + Math.cos(t+i/4)*80;
      const y = h/2 + Math.sin(t+i/3)*80;
      ctx.fillStyle = 'hsl(' + ((t*60+i*6)%360) + ' 70% 60%)';
      ctx.beginPath(); ctx.arc(x,y,6,0,Math.PI*2); ctx.fill();
    }
    requestAnimationFrame(frame);
  }
  frame();
})();`
    }
  ])
  const [activeFileId, setActiveFileId] = useState<string>('f-html-1')

  const [autorun, setAutorun] = useState<boolean>(true)
  const [runNonce, setRunNonce] = useState<number>(0)
  const [logs, setLogs] = useState<string[]>([])
  const [agentModel, setAgentModel] = useState<string>('gpt-5-code')
  const [agentMode, setAgentMode] = useState<string>('edit') // edit | explain | test
  const [agentInput, setAgentInput] = useState<string>('')
  const [agentMessages, setAgentMessages] = useState<Array<{role:'user'|'assistant'; text:string}>>([])

  const [fullscreenPane, setFullscreenPane] = useState<'left' | 'center' | 'right' | null>(null)
  const [terminalInput, setTerminalInput] = useState<string>('')
  const [terminalHistory, setTerminalHistory] = useState<string[]>([])
  const [terminalHistoryIndex, setTerminalHistoryIndex] = useState<number>(-1)
  const [consoleMax, setConsoleMax] = useState<boolean>(false)
  const [terminalUser] = useState<string>('gc')
  const [terminalHost] = useState<string>('goosecode')
  const [terminalPath, setTerminalPath] = useState<string>('~')

  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const previewContainerRef = useRef<HTMLDivElement | null>(null)
  const centerRowsRef = useRef<HTMLDivElement | null>(null)
  const wsClientRef = useRef<WSClient | null>(null)
  const [roomId] = useState<string>('goosecode')
  const rafRef = useRef<number | null>(null)
  const [rootSizes, setRootSizes] = useState<number[]>([12, 60, 28])
  const [centerSizes, setCenterSizes] = useState<number[]>([60, 40])
  const [editorSizes, setEditorSizes] = useState<number[]>([55, 45])
  const [showLeft, setShowLeft] = useState<boolean>(true)
  const [showRight, setShowRight] = useState<boolean>(true)
  const [showConsole, setShowConsole] = useState<boolean>(true)
  const [agentOnLeft, setAgentOnLeft] = useState<boolean>(false)

  useEffect(() => {
    try {
      const wsUrl = (resolveWsUrl as any)?.() || process.env.NEXT_PUBLIC_WS_URL || ''
      if (!wsUrl) return
      const client = new WSClient({
        wsUrl,
        getParticipants: () => [],
        getDefaults: () => ({})
      })
      wsClientRef.current = client
      client.connect()?.catch(()=>{})
      client.joinRoom?.(roomId)
    } catch {}
  }, [roomId])

  const activeFile = files.find(f => f.id === activeFileId) || files[0]
  function updateActiveFileContent(next: string){
    setFiles(prev => prev.map(f => f.id === activeFileId ? { ...f, content: next } : f))
  }
  function addFile(kind: FileKind){
    const id = `f-${kind}-${Math.random().toString(36).slice(2,8)}`
    const nameBase = kind === 'html' ? 'index' : (kind === 'css' ? 'styles' : 'app')
    const ext = kind
    const count = files.filter(f => f.kind === kind).length
    const name = count === 0 ? `${nameBase}.${ext}` : `${nameBase}-${count+1}.${ext}`
    const template = kind === 'html' ? '<div id="app"></div>' : (kind === 'css' ? '/* new stylesheet */' : '// new script')
    const file: FileBuf = { id, name, kind, content: template }
    setFiles(prev => [...prev, file])
    setActiveFileId(id)
  }

  const srcDoc = useMemo(() => {
    const htmlFiles = files.filter(f => f.kind === 'html').map(f => f.content).join('\n')
    const cssFiles = files.filter(f => f.kind === 'css').map(f => f.content).join('\n')
    const jsFiles = files.filter(f => f.kind === 'js').map(f => f.content).join('\n')
    return buildSrcDoc(htmlFiles, cssFiles, jsFiles)
  }, [files, runNonce])

  // Restore persisted sizes (once on mount)
  useEffect(() => {
    try {
      const r = JSON.parse(localStorage.getItem('gc:sizes:root') || '[]')
      const c = JSON.parse(localStorage.getItem('gc:sizes:center') || '[]')
      const e = JSON.parse(localStorage.getItem('gc:sizes:editor') || '[]')
      if (Array.isArray(r) && r.length === 3) setRootSizes(r.map((n: any)=>Number(n)))
      if (Array.isArray(c) && c.length === 2) setCenterSizes(c.map((n: any)=>Number(n)))
      if (Array.isArray(e) && e.length === 2) setEditorSizes(e.map((n: any)=>Number(n)))
      const vis = JSON.parse(localStorage.getItem('gc:visibility') || '{}')
      if (vis && typeof vis === 'object') {
        if (typeof vis.left === 'boolean') setShowLeft(vis.left)
        if (typeof vis.right === 'boolean') setShowRight(vis.right)
        if (typeof vis.console === 'boolean') setShowConsole(vis.console)
        if (typeof vis.agentOnLeft === 'boolean') setAgentOnLeft(vis.agentOnLeft)
      }
    } catch {}
  }, [])

  // (Optional) persist sizes can be added with Allotment onChange

  const terminalPrompt = useMemo(() => `${terminalUser}@${terminalHost}:${terminalPath}$`, [terminalUser, terminalHost, terminalPath])

  // Layout presets
  function applyPreset(name: 'balanced'|'editor'|'preview'|'console'|'clean'){
    if (name === 'clean') {
      setShowLeft(false); setShowRight(false); setShowConsole(false)
      setRootSizes([0, 100, 0]); setCenterSizes([100, 0]); setEditorSizes([60, 40])
    } else if (name === 'editor') {
      setShowLeft(true); setShowRight(false); setShowConsole(false)
      setRootSizes([12, 88, 0]); setCenterSizes([100, 0]); setEditorSizes([80, 20])
    } else if (name === 'preview') {
      setShowLeft(false); setShowRight(true); setShowConsole(false)
      setRootSizes([0, 75, 25]); setCenterSizes([100, 0]); setEditorSizes([30, 70])
    } else if (name === 'console') {
      setShowLeft(false); setShowRight(false); setShowConsole(true)
      setRootSizes([0, 100, 0]); setCenterSizes([40, 60]); setEditorSizes([70, 30])
    } else {
      setShowLeft(true); setShowRight(true); setShowConsole(true)
      setRootSizes([12, 60, 28]); setCenterSizes([60, 40]); setEditorSizes([55, 45])
    }
    try { localStorage.setItem('gc:visibility', JSON.stringify({ left: showLeft, right: showRight, console: showConsole })) } catch {}
  }

  useEffect(() => {
    function onMsg(ev: MessageEvent){
      const d: any = ev.data || {}
      if (d && d.type === 'goosecode:log') {
        setLogs(prev => [
          ...prev,
          d.args.map((x: any) => (typeof x === 'object' ? JSON.stringify(x) : String(x))).join(' ')
        ].slice(-200))
      } else if (d && d.type === 'goosecode:error') {
        const where = d.src ? ` @ ${d.src}:${d.line || '?'}:${d.col || '?'}` : ''
        setLogs(prev => [...prev, `Error: ${d.msg}${where}`].slice(-200))
      } else if (d && d.type === 'goosecode:eval:result') {
        const formatted = d.ok ? formatDisplayValue(d.value) : `Error: ${String(d.error || 'unknown error')}`
        setLogs(prev => [...prev, formatted].slice(-200))
      }
    }
    try { window.addEventListener('message', onMsg as EventListener) } catch {}
    return () => { try { window.removeEventListener('message', onMsg as EventListener) } catch {} }
  }, [])

  useEffect(() => {
    if (!autorun) return
    const id = setTimeout(() => setRunNonce(n => n + 1), 300)
    return () => clearTimeout(id)
  }, [autorun, files])

  // xterm handles its own scroll; no manual autoscroll needed

  // All custom drag handlers removed in favor of Allotment

  function toggleFullscreen(which: 'left' | 'center' | 'right'){
    setFullscreenPane(prev => (prev === which ? null : which))
  }

  function runOnce(){ setRunNonce(n => n + 1) }
  function clearLogs(){ setLogs([]) }

  function formatDisplayValue(v: any): string {
    try {
      if (v === null) return 'null'
      if (v === undefined) return 'undefined'
      const t = typeof v
      if (t === 'string') return v
      if (t === 'number' || t === 'boolean' || t === 'bigint') return String(v)
      if (t === 'function') return v.toString()
      return JSON.stringify(v, (_k, value) => (typeof value === 'bigint' ? String(value) + 'n' : value), 2)
    } catch {
      try { return String(v) } catch { return '[unserializable]' }
    }
  }

  function submitTerminal(codeRaw?: string){
    const code = (codeRaw ?? terminalInput).trim()
    if (!code) return
    setLogs(prev => [...prev, `› ${code}`].slice(-200))
    // Command mode (":" prefix)
    if (code.startsWith(':')){
      const cmd = code.slice(1).trim()
      if (cmd === 'clear') {
        clearLogs()
      } else if (cmd === 'run') {
        runOnce()
      } else if (cmd === 'help') {
        setLogs(prev => [...prev, 'Commands: :run, :clear, :help'].slice(-200))
      } else if (cmd.startsWith('cd')) {
        const p = cmd.slice(2).trim() || '~'
        setTerminalPath(p)
        setLogs(prev => [...prev, `changed directory to ${p}`].slice(-200))
      } else if (cmd === 'cls') {
        clearLogs()
      } else {
        setLogs(prev => [...prev, `unknown command :${cmd}`].slice(-200))
      }
    } else if (code.startsWith('!')) {
      // Linux-like shell stub mapped to our in-memory files
      const parts = code.slice(1).trim().split(/\s+/)
      const cmd = parts[0] || ''
      const args = parts.slice(1)
      const print = (s: string) => setLogs(prev => [...prev, s].slice(-200))
      if (cmd === 'pwd') {
        print(terminalPath)
      } else if (cmd === 'ls') {
        const list = files.map(f => f.name).join('  ')
        print(list || '')
      } else if (cmd === 'cat') {
        const name = args[0]
        const f = files.find(x => x.name === name)
        print(f ? f.content : `cat: ${name}: No such file`)
      } else if (cmd === 'touch') {
        const name = args[0]
        if (!name) { print('touch: missing file operand'); }
        else if (files.some(f => f.name === name)) { print('') }
        else {
          const ext = name.split('.').pop() as FileKind | undefined
          const kind: FileKind = (ext === 'html' || ext === 'css' || ext === 'js') ? ext : 'js'
          const id = `f-${kind}-${Math.random().toString(36).slice(2,8)}`
          setFiles(prev => [...prev, { id, name, kind, content: '' }])
          setActiveFileId(id)
        }
      } else if (cmd === 'rm') {
        const name = args[0]
        const idx = files.findIndex(f => f.name === name)
        if (idx < 0) print(`rm: ${name}: No such file`)
        else {
          const removed = files[idx]
          const next = files.filter((_,i)=>i!==idx)
          setFiles(next)
          if (removed.id === activeFileId && next.length) setActiveFileId(next[0].id)
        }
      } else if (cmd === 'echo') {
        print(args.join(' '))
      } else {
        print(`sh: ${cmd}: command not found`)
      }
    } else {
      try {
        iframeRef.current?.contentWindow?.postMessage({ type: 'goosecode:eval', code }, '*')
      } catch {
        setLogs(prev => [...prev, 'Error: failed to send to preview'].slice(-200))
      }
    }
    setTerminalHistory(prev => [...prev, code].slice(-100))
    setTerminalHistoryIndex(-1)
    setTerminalInput('')
  }

  function onTerminalKeyDown(e: React.KeyboardEvent<HTMLInputElement>){
    if (e.key === 'Enter'){
      e.preventDefault()
      submitTerminal()
      return
    }
    if (e.ctrlKey && (e.key === 'l' || e.key === 'L')){
      e.preventDefault()
      clearLogs()
      return
    }
    if (e.key === 'ArrowUp'){
      e.preventDefault()
      setTerminalHistoryIndex(prev => {
        const next = prev < 0 ? terminalHistory.length - 1 : Math.max(0, prev - 1)
        const value = terminalHistory[next] ?? ''
        setTerminalInput(value)
        return next
      })
      return
    }
    if (e.key === 'ArrowDown'){
      e.preventDefault()
      setTerminalHistoryIndex(prev => {
        const next = prev < 0 ? -1 : Math.min(terminalHistory.length - 1, prev + 1)
        const value = next === -1 ? '' : (terminalHistory[next] ?? '')
        setTerminalInput(value)
        return next
      })
    }
  }

  function onAgentSend(){
    const text = agentInput.trim()
    if (!text) return
    setAgentMessages(prev => [...prev, { role: 'user', text }])
    setAgentInput('')
    // Stub assistant echo with mode/model hint
    const reply = `[${agentModel} • ${agentMode}] Ack: ${text}`
    setTimeout(() => setAgentMessages(prev => [...prev, { role: 'assistant', text: reply }]), 150)
  }

  return (
    <div className="flex flex-col h-[100dvh] w-full bg-[#0a0a0a] text-zinc-200">
      <header className="flex items-center justify-between px-3 h-10 border-b border-zinc-800/80 select-none">
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded-md bg-white text-black flex items-center justify-center">
            <GooseMark className="w-3.5 h-3.5" />
          </div>
          <div className="text-xs tracking-wide uppercase text-zinc-400">GooseCode (VIM/EMACS prototype)</div>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <label className="inline-flex items-center gap-2 cursor-pointer">
            <input type="checkbox" className="accent-zinc-400" checked={autorun} onChange={(e)=>setAutorun(e.target.checked)} />
            Auto-run
          </label>
          <button className="px-2 py-1 rounded border border-zinc-800 hover:bg-zinc-800" onClick={runOnce}>Run</button>
          <button className="px-2 py-1 rounded border border-zinc-800 hover:bg-zinc-800" onClick={clearLogs}>Clear Console</button>
        </div>
      </header>

      <div className="flex-1 relative overflow-hidden">
        <div className="absolute inset-0 flex" style={{ userSelect: 'none' }}>
          {/* Collapsed app rail */}
          {fullscreenPane === null && (
          <div className="h-full w-12 bg-sidebar text-sidebar-foreground border-r border-zinc-800/80 flex flex-col items-center py-2 gap-2">
            <div className="mt-0.5 mb-2 w-8 h-8 rounded-lg bg-sidebar-primary text-sidebar-primary-foreground flex items-center justify-center">
              <GooseMark className="w-4 h-4" />
            </div>
            <Link href="/feed" className="size-8 rounded-md flex items-center justify-center text-inherit hover:bg-sidebar-accent hover:text-sidebar-accent-foreground" title="Feed">
              <BookOpen className="w-4 h-4" />
            </Link>
            <Link href="/inbox" className="size-8 rounded-md flex items-center justify-center text-inherit hover:bg-sidebar-accent hover:text-sidebar-accent-foreground" title="Inbox">
              <Inbox className="w-4 h-4" />
            </Link>
            <Link href="/goosecode" className="size-8 rounded-md flex items-center justify-center text-inherit bg-sidebar-accent text-sidebar-accent-foreground" title="GooseCode">
              <Code2 className="w-4 h-4" />
            </Link>
            <div className="mt-auto text-[10px] text-sidebar-foreground/60">v0</div>
          </div>
          )}

          {/* Left | Center | Right via Allotment (supports agent on left) */}
          {(() => {
            const displayedSizes = agentOnLeft ? [rootSizes[2], rootSizes[1], rootSizes[0]] : rootSizes
            const handleChange = (sizes: number[]) => {
              const canonical = agentOnLeft ? [sizes[2], sizes[1], sizes[0]] : sizes
              setRootSizes(canonical)
              try { localStorage.setItem('gc:sizes:root', JSON.stringify(canonical)) } catch {}
            }
            return (
          <Allotment proportionalLayout className="w-full h-full" sizes={displayedSizes} onChange={handleChange}>
            {agentOnLeft ? (
              // Agent | Center | Left
              <>
                {/* Agent pane (left side when toggled) */}
                <Allotment.Pane minSize={260} preferredSize={360} visible={showRight && fullscreenPane !== 'left' && fullscreenPane !== 'center'}>
                  <div className="flex-1 h-full">
            <div className="h-9 flex items-center justify-between px-2 border-b border-zinc-800/80 text-xs">
              <div className="text-zinc-400 uppercase tracking-wide">Agent</div>
              <div className="flex items-center gap-2">
                <button onClick={()=>toggleFullscreen('right')} title={fullscreenPane==='right'?'Exit fullscreen':'Fullscreen'} className="inline-flex items-center justify-center size-6 rounded hover:bg-zinc-800/60 text-zinc-400 hover:text-zinc-200">
                  {fullscreenPane==='right' ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
                </button>
                <select value={agentModel} onChange={(e)=>setAgentModel(e.target.value)} className="bg-black/40 border border-zinc-800/80 rounded px-1 py-0.5">
                  <option value="gpt-5-code">GPT-5 Code (stub)</option>
                  <option value="gpt-4o">gpt-4o</option>
                  <option value="claude-3-5-sonnet">Claude 3.5 Sonnet</option>
                </select>
                <select value={agentMode} onChange={(e)=>setAgentMode(e.target.value)} className="bg-black/40 border border-zinc-800/80 rounded px-1 py-0.5">
                  <option value="edit">Edit</option>
                  <option value="explain">Explain</option>
                  <option value="test">Test</option>
                </select>
              </div>
            </div>
            <div className="h-[calc(100%-2rem)] grid grid-rows-[1fr_auto]">
              <div className="overflow-auto p-2 space-y-2">
                {agentMessages.length === 0 ? (
                  <div className="text-xs text-zinc-500">Start a conversation about your code. Nothing is executed yet; this is a stub UI.</div>
                ) : (
                  agentMessages.map((m, i) => (
                    <div key={i} className={(m.role==='user'?'text-zinc-200':'text-emerald-300') + ' text-sm font-mono whitespace-pre-wrap'}>
                      <span className="text-zinc-500">{m.role==='user'?'you':'assistant'} ▸ </span>{m.text}
                    </div>
                  ))
                )}
              </div>
              <div className="border-t border-zinc-800/80 p-2 flex items-center gap-2">
                <input value={agentInput} onChange={(e)=>setAgentInput(e.target.value)}
                  placeholder={`Ask to ${agentMode}…`} className="flex-1 bg-black/40 border border-zinc-800/80 rounded px-2 py-1 text-sm outline-none" />
                <button onClick={onAgentSend} className="px-2 py-1 rounded border border-zinc-800 hover:bg-zinc-800 text-sm">Send</button>
              </div>
            </div>
                  </div>
                </Allotment.Pane>
              </>
            ) : (
              // Default left buffer
              <Allotment.Pane minSize={180} preferredSize={220} visible={showLeft && fullscreenPane !== 'center' && fullscreenPane !== 'right'}>
                <div className="h-full border-r border-zinc-800/80 bg-black/30">
            <div className="h-9 flex items-center justify-between px-2 border-b border-zinc-800/80 text-xs">
              <div className="uppercase tracking-wide text-zinc-400">Buffers</div>
              <button onClick={()=>toggleFullscreen('left')} title={fullscreenPane==='left'?'Exit fullscreen':'Fullscreen'} className="inline-flex items-center justify-center size-6 rounded hover:bg-zinc-800/60 text-zinc-400 hover:text-zinc-200">
                {fullscreenPane==='left' ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
              </button>
            </div>
            <div className="p-2 space-y-1 text-sm">
              {files.map(f => (
                <button key={f.id}
                  onClick={()=>setActiveFileId(f.id)}
                  className={(activeFileId===f.id ? 'bg-zinc-800 text-white' : 'bg-transparent hover:bg-zinc-900 text-zinc-300') + ' w-full text-left px-2 py-1 rounded border border-zinc-800/60'}>
                  {(activeFileId===f.id ? '● ' : '○ ')} {f.name}
                </button>
              ))}
            </div>
            <div className="px-2 pb-2 flex items-center gap-1 text-xs text-zinc-400">
              <Tooltip>
                <TooltipTrigger asChild>
                  <button onClick={()=>addFile('html')} className="px-2 py-1 rounded border border-zinc-800 hover:bg-zinc-800">+ HTML</button>
                </TooltipTrigger>
                <TooltipContent>Add HTML file</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button onClick={()=>addFile('css')} className="px-2 py-1 rounded border border-zinc-800 hover:bg-zinc-800">+ CSS</button>
                </TooltipTrigger>
                <TooltipContent>Add CSS file</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button onClick={()=>addFile('js')} className="px-2 py-1 rounded border border-zinc-800 hover:bg-zinc-800">+ JS</button>
                </TooltipTrigger>
                <TooltipContent>Add JS file</TooltipContent>
              </Tooltip>
            </div>
                </div>
              </Allotment.Pane>
            )}
            

            <Allotment.Pane minSize={500} preferredSize={720} visible={fullscreenPane !== 'left' && fullscreenPane !== 'right'}>
              <div className="h-full">
            <div className="flex items-center gap-2 px-2 h-9 border-b border-zinc-800/80 text-xs">
              <div className="flex items-center gap-1 overflow-auto">
                {files.map(f => (
                  <button key={f.id} onClick={()=>setActiveFileId(f.id)}
                    className={(activeFileId===f.id? 'bg-zinc-800 text-white':'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900')+ ' px-2 py-1 rounded'}>
                    {f.name}
                  </button>
                ))}
              </div>
              <div className="ml-auto flex items-center gap-1 text-zinc-500">
                <DropdownMenu>
                  <DropdownMenuTrigger className="size-7 rounded hover:bg-zinc-900 inline-flex items-center justify-center">Layout</DropdownMenuTrigger>
                  <DropdownMenuContent sideOffset={6}>
                    <DropdownMenuLabel>Presets</DropdownMenuLabel>
                    <DropdownMenuItem onClick={()=>applyPreset('balanced')}>Balanced</DropdownMenuItem>
                    <DropdownMenuItem onClick={()=>applyPreset('editor')}>Editor focus</DropdownMenuItem>
                    <DropdownMenuItem onClick={()=>applyPreset('preview')}>Preview focus</DropdownMenuItem>
                    <DropdownMenuItem onClick={()=>applyPreset('console')}>Console focus</DropdownMenuItem>
                    <DropdownMenuItem onClick={()=>applyPreset('clean')}>Clean canvas</DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel>Visibility</DropdownMenuLabel>
                    <DropdownMenuCheckboxItem checked={showLeft} onCheckedChange={(v)=>{ setShowLeft(!!v); try { localStorage.setItem('gc:visibility', JSON.stringify({ left: !!v, right: showRight, console: showConsole, agentOnLeft })) } catch {} }}>Show left</DropdownMenuCheckboxItem>
                    <DropdownMenuCheckboxItem checked={showRight} onCheckedChange={(v)=>{ setShowRight(!!v); try { localStorage.setItem('gc:visibility', JSON.stringify({ left: showLeft, right: !!v, console: showConsole, agentOnLeft })) } catch {} }}>Show right</DropdownMenuCheckboxItem>
                    <DropdownMenuCheckboxItem checked={showConsole} onCheckedChange={(v)=>{ setShowConsole(!!v); try { localStorage.setItem('gc:visibility', JSON.stringify({ left: showLeft, right: showRight, console: !!v, agentOnLeft })) } catch {} }}>Show console</DropdownMenuCheckboxItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuCheckboxItem checked={agentOnLeft} onCheckedChange={(v)=>{ setAgentOnLeft(!!v); try { localStorage.setItem('gc:visibility', JSON.stringify({ left: showLeft, right: showRight, console: showConsole, agentOnLeft: !!v })) } catch {} }}>Agent on left</DropdownMenuCheckboxItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button onClick={()=>setAutorun(a=>!a)} className={(autorun?'text-emerald-400':'text-zinc-400') + ' size-7 rounded hover:bg-zinc-900 flex items-center justify-center'} aria-label="Toggle autorun">
                      {/* play/pause icon via css dot */}
                      <span className="inline-block w-0 h-0 border-y-4 border-l-6 border-y-transparent border-l-current"></span>
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>{autorun ? 'Autorun: on' : 'Autorun: off'}</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button onClick={runOnce} className="text-zinc-300 size-7 rounded hover:bg-zinc-900 flex items-center justify-center" aria-label="Run">
                      ▷
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>Run</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button onClick={clearLogs} className="text-zinc-300 size-7 rounded hover:bg-zinc-900 flex items-center justify-center" aria-label="Clear console">
                      ⌫
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>Clear console</TooltipContent>
                </Tooltip>
                <button onClick={()=>toggleFullscreen('center')} title={fullscreenPane==='center'?'Exit fullscreen':'Fullscreen'} className="inline-flex items-center justify-center size-7 rounded hover:bg-zinc-800/60 text-zinc-400 hover:text-zinc-200">
                  {fullscreenPane==='center' ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>
            <div ref={centerRowsRef} className="h-[calc(100%-2.25rem)]">
              <Allotment vertical proportionalLayout sizes={centerSizes} onChange={(s)=>{ setCenterSizes(s); try { localStorage.setItem('gc:sizes:center', JSON.stringify(s)) } catch {} }}>
                <Allotment.Pane minSize={300} preferredSize={520} visible={!consoleMax}>
                  <Allotment vertical proportionalLayout sizes={editorSizes} onChange={(s)=>{ setEditorSizes(s); try { localStorage.setItem('gc:sizes:editor', JSON.stringify(s)) } catch {} }}>
                    <Allotment.Pane minSize={200} preferredSize={340}>
                      <div className="p-2 h-full">
                        <textarea value={activeFile?.content || ''} onChange={e=>updateActiveFileContent(e.target.value)}
                          spellCheck={false}
                          className="w-full h-full resize-none bg-black/50 border border-zinc-800 rounded p-2 font-mono text-sm outline-none focus:ring-1 focus:ring-zinc-700" />
                      </div>
                    </Allotment.Pane>
                    <Allotment.Pane minSize={200} preferredSize={260}>
                      <div className="relative h-full">
                        <div ref={previewContainerRef} className="absolute inset-0">
                          <iframe ref={iframeRef} title="preview" className="absolute inset-0 w-full h-full bg-white"
                            sandbox="allow-scripts allow-same-origin"
                            srcDoc={srcDoc}
                          />
                          <div className="absolute top-2 right-2 flex items-center gap-1">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button onClick={() => {
                                  try {
                                    const el = previewContainerRef.current
                                    if (!el) return
                                    if (document.fullscreenElement) document.exitFullscreen?.();
                                    else el.requestFullscreen?.();
                                  } catch {}
                                }} className="size-6 rounded bg-black/40 text-zinc-200 hover:bg-black/60 border border-zinc-800/80 flex items-center justify-center" aria-label="Fullscreen preview">
                                  <Maximize2 className="w-3 h-3" />
                                </button>
                              </TooltipTrigger>
                              <TooltipContent>Fullscreen preview</TooltipContent>
                            </Tooltip>
                          </div>
                        </div>
                      </div>
                    </Allotment.Pane>
                  </Allotment>
                </Allotment.Pane>
                <Allotment.Pane minSize={120} preferredSize={200} visible={showConsole}>
                  <div className="bg-black/40 grid grid-rows-[auto_1fr_auto] text-xs font-mono h-full">
                <div className="h-9 flex items-center justify-between px-2 border-b border-zinc-800/80">
                  <div className="flex items-center gap-2 text-[11px] text-zinc-400">
                    <TerminalIcon className="w-3.5 h-3.5 text-zinc-500" />
                    <span className="text-zinc-300">{terminalUser}@{terminalHost}</span>
                    <span className="text-zinc-500">{terminalPath}</span>
                    <span className="text-zinc-700">•</span>
                    <span className="text-zinc-500">{new Date().toLocaleTimeString()}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button onClick={clearLogs} className="text-zinc-300 size-6 rounded hover:bg-zinc-900 flex items-center justify-center" aria-label="Clear">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>Clear</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button onClick={()=>setConsoleMax(m=>!m)} className="text-zinc-300 size-6 rounded hover:bg-zinc-900 flex items-center justify-center" aria-label="Maximize console">
                          {consoleMax ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>{consoleMax ? 'Exit console focus' : 'Focus console'}</TooltipContent>
                    </Tooltip>
                  </div>
                </div>
                <div className="overflow-hidden">
                  <XtermConsole
                    files={files}
                    onFilesChange={setFiles}
                    activeFileId={activeFileId}
                    onActiveFileChange={setActiveFileId}
                    prompt={terminalPrompt}
                    path={terminalPath}
                    onPathChange={setTerminalPath}
                    resetNonce={runNonce}
                    onExecBackend={async (cmd) => {
                      try {
                        const res = await (wsClientRef.current as any)?.client?.executeTerminalCommand?.(cmd, roomId)
                        // The ws will push terminal.result; we also return stdout for immediate view if any
                        const out = typeof res?.stdout === 'string' ? res.stdout : ''
                        const err = typeof res?.stderr === 'string' ? res.stderr : ''
                        return [out, err].filter(Boolean).join('\n') || ''
                      } catch {
                        return ''
                      }
                    }}
                  />
                </div>
                <div className="border-t border-zinc-800/80 px-2 py-1 flex items-center gap-2">
                  <span className="text-emerald-400">Eval</span>
                  <input value={terminalInput} onChange={(e)=>setTerminalInput(e.target.value)} onKeyDown={onTerminalKeyDown}
                    placeholder="Eval JS here (Enter). Shell lives above."
                    className="flex-1 bg-transparent outline-none text-zinc-200 placeholder:text-zinc-500" />
                </div>
                  </div>
                </Allotment.Pane>
              </Allotment>
              </div>
              </div>
            </Allotment.Pane>

            <Allotment.Pane minSize={260} preferredSize={360} visible={showRight && fullscreenPane !== 'left' && fullscreenPane !== 'center'}>
              <div className="flex-1 h-full">
            <div className="h-9 flex items-center justify-between px-2 border-b border-zinc-800/80 text-xs">
              <div className="text-zinc-400 uppercase tracking-wide">Agent</div>
              <div className="flex items-center gap-2">
                <button onClick={()=>toggleFullscreen('right')} title={fullscreenPane==='right'?'Exit fullscreen':'Fullscreen'} className="inline-flex items-center justify-center size-6 rounded hover:bg-zinc-800/60 text-zinc-400 hover:text-zinc-200">
                  {fullscreenPane==='right' ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
                </button>
                <select value={agentModel} onChange={(e)=>setAgentModel(e.target.value)} className="bg-black/40 border border-zinc-800/80 rounded px-1 py-0.5">
                  <option value="gpt-5-code">GPT-5 Code (stub)</option>
                  <option value="gpt-4o">gpt-4o</option>
                  <option value="claude-3-5-sonnet">Claude 3.5 Sonnet</option>
                </select>
                <select value={agentMode} onChange={(e)=>setAgentMode(e.target.value)} className="bg-black/40 border border-zinc-800/80 rounded px-1 py-0.5">
                  <option value="edit">Edit</option>
                  <option value="explain">Explain</option>
                  <option value="test">Test</option>
                </select>
              </div>
            </div>
            <div className="h-[calc(100%-2rem)] grid grid-rows-[1fr_auto]">
              <div className="overflow-auto p-2 space-y-2">
                {agentMessages.length === 0 ? (
                  <div className="text-xs text-zinc-500">Start a conversation about your code. Nothing is executed yet; this is a stub UI.</div>
                ) : (
                  agentMessages.map((m, i) => (
                    <div key={i} className={(m.role==='user'?'text-zinc-200':'text-emerald-300') + ' text-sm font-mono whitespace-pre-wrap'}>
                      <span className="text-zinc-500">{m.role==='user'?'you':'assistant'} ▸ </span>{m.text}
                    </div>
                  ))
                )}
              </div>
              <div className="border-t border-zinc-800/80 p-2 flex items-center gap-2">
                <input value={agentInput} onChange={(e)=>setAgentInput(e.target.value)}
                  placeholder={`Ask to ${agentMode}…`} className="flex-1 bg-black/40 border border-zinc-800/80 rounded px-2 py-1 text-sm outline-none" />
                <button onClick={onAgentSend} className="px-2 py-1 rounded border border-zinc-800 hover:bg-zinc-800 text-sm">Send</button>
              </div>
            </div>
              </div>
            </Allotment.Pane>
          </Allotment>
            )
          })()}
        </div>
      </div>

      {/* Bottom command removed; terminal lives inside console now */}
      <style jsx global>{`
        /* Allotment sash styling: subtle gray instead of blue */
        .allotment { --sash-size: 3px; --sash-hover-size: 5px; }
        /* Robust overrides for CSS-module classnames used by Allotment sashes */
        .allotment .sash,
        .allotment [class^="sash"],
        .allotment [class*=" sash"],
        .allotment [class*="sash-"] {
          background-color: rgba(63,63,70,0.18) !important; /* zinc-700/18 */
        }
        /* Disable hover effect entirely (keep base color) */
        .allotment .sash:hover,
        .allotment [class^="sash"]:hover,
        .allotment [class*=" sash"]:hover,
        .allotment [class*="sash-"]:hover { background-color: rgba(63,63,70,0.18) !important; }
        .allotment .sash.active,
        .allotment [class^="sash"].active,
        .allotment [class*=" sash"].active,
        .allotment [class*="sash-"][data-active],
        .allotment [class*="sash-"]:active {
          background-color: rgba(113,113,122,0.32) !important; /* zinc-500/32 */
        }
        .allotment [class*="sash"]:focus { outline: none !important; box-shadow: none !important; }

        /* Also override internal hover/active pseudo element which uses --focus-border (#007fd4 by default) */
        :root { --focus-border: transparent !important; }
        .sash-module_sash__K-9lB.sash-module_hover__80W6I:before,
        .sash-module_sash__K-9lB.sash-module_active__bJspD:before {
          background: transparent !important;
        }

        /* Minimal scrubber visuals - hide default arrows, show tiny square cue */
        .allotment [class*="sash"] .sash-content svg { display: none !important; }
        .allotment [class*="sash"] .sash-content { opacity: 0.45; }
        .allotment [class*="sash"] .sash-content::before {
          content: '';
          display: block;
          width: 4px;
          height: 4px;
          border: 1px solid rgba(113,113,122,0.4);
          border-radius: 2px;
        }
      `}</style>
    </div>
  )
}

function GooseMark({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={className}
      style={{
        WebkitMaskImage: 'url(/goose.svg)',
        maskImage: 'url(/goose.svg)',
        WebkitMaskRepeat: 'no-repeat',
        maskRepeat: 'no-repeat',
        WebkitMaskSize: 'contain',
        maskSize: 'contain',
        WebkitMaskPosition: 'center',
        maskPosition: 'center',
        backgroundColor: 'currentColor',
      }}
    />
  )
}


