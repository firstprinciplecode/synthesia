'use client'

import React, { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { BookOpen, Inbox, Code2 } from 'lucide-react'

// Minimal, self-contained VIM/EMACS-style coding surface.
// - Left: buffers sidebar + tabbed editors for HTML/CSS/JS
// - Center: sandboxed preview (iframe srcDoc)
// - Right: agent stub panel (model/mode + chat log)
// - Draggable dividers for flexible layout
// - Bottom command line placeholder (":" commands later)

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
      } catch(_) {}
    </script>
    <script>${esc(js)}</script>
  </body>
</html>`
}

type TabKey = 'html' | 'css' | 'js'

export default function GooseCodePage() {
  const [active, setActive] = useState<TabKey>('html')
  const [html, setHtml] = useState<string>(`<main style="height:100%;display:grid;place-items:center;">
  <canvas id="c" width="480" height="320" style="border:1px solid #444;border-radius:8px;background:#111"></canvas>
  <p style="position:fixed;bottom:10px;left:10px;color:#999;font:12px/1.2 system-ui">Tip: :run to refresh • :w to save (stub)</p>
</main>`)
  const [css, setCss] = useState<string>(`*{box-sizing:border-box}
:root{color-scheme:dark}
body{font:14px/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;background:#0a0a0a;color:#e5e5e5}
button{cursor:pointer}
`)
  const [js, setJs] = useState<string>(`(function(){
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
})();`)

  const [leftSidebarWidth, setLeftSidebarWidth] = useState<number>(16) // percent
  const [centerWidth, setCenterWidth] = useState<number>(64) // percent; right gets remaining
  const [autorun, setAutorun] = useState<boolean>(true)
  const [runNonce, setRunNonce] = useState<number>(0)
  const [logs, setLogs] = useState<string[]>([])
  const [agentModel, setAgentModel] = useState<string>('gpt-5-code')
  const [agentMode, setAgentMode] = useState<string>('edit') // edit | explain | test
  const [agentInput, setAgentInput] = useState<string>('')
  const [agentMessages, setAgentMessages] = useState<Array<{role:'user'|'assistant'; text:string}>>([])

  const dragLeftRef = useRef<HTMLDivElement | null>(null)
  const dragRightRef = useRef<HTMLDivElement | null>(null)
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const cmdRef = useRef<HTMLInputElement | null>(null)

  const buffers: Array<{ key: TabKey; name: string }> = [
    { key: 'html', name: 'index.html' },
    { key: 'css', name: 'styles.css' },
    { key: 'js', name: 'app.js' },
  ]

  const srcDoc = useMemo(() => buildSrcDoc(html, css, js), [html, css, js, runNonce])

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
      }
    }
    try { window.addEventListener('message', onMsg as EventListener) } catch {}
    return () => { try { window.removeEventListener('message', onMsg as EventListener) } catch {} }
  }, [])

  useEffect(() => {
    if (!autorun) return
    const id = setTimeout(() => setRunNonce(n => n + 1), 300)
    return () => clearTimeout(id)
  }, [autorun, html, css, js])

  function startDrag(which: 'left' | 'right', e: React.MouseEvent){
    e.preventDefault()
    const startX = e.clientX
    const startLeft = leftSidebarWidth
    const startCenter = centerWidth
    function move(me: MouseEvent){
      const dx = me.clientX - startX
      const pct = dx / (window.innerWidth || 1) * 100
      if (which === 'left') {
        const nextLeft = Math.min(30, Math.max(10, startLeft + pct))
        // keep center within 40-70
        const nextCenter = Math.min(70, Math.max(40, startCenter - (nextLeft - startLeft)))
        setLeftSidebarWidth(nextLeft)
        setCenterWidth(nextCenter)
      } else {
        const nextCenter = Math.min(70, Math.max(40, startCenter + pct))
        setCenterWidth(nextCenter)
      }
    }
    function up(){
      document.removeEventListener('mousemove', move)
      document.removeEventListener('mouseup', up)
    }
    document.addEventListener('mousemove', move)
    document.addEventListener('mouseup', up)
  }

  function runOnce(){ setRunNonce(n => n + 1) }
  function clearLogs(){ setLogs([]) }

  function onCommandSubmit(e: React.FormEvent){
    e.preventDefault()
    const val = (cmdRef.current?.value || '').trim()
    if (!val) return
    if (val === ':w' || val === ':write') {
      setLogs(prev => [...prev, 'saved (stub)'].slice(-200))
    } else if (val === ':run') {
      runOnce()
    } else if (val === ':clear') {
      clearLogs()
    } else if (val === ':q' || val === ':quit') {
      // noop
    } else {
      setLogs(prev => [...prev, `unknown command ${val}`].slice(-200))
    }
    if (cmdRef.current) cmdRef.current.value = ''
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

          {/* Left: Buffers sidebar */}
          <div className="h-full border-r border-zinc-800/80 bg-black/30" style={{ width: `${leftSidebarWidth}%` }}>
            <div className="h-8 flex items-center px-2 border-b border-zinc-800/80 text-xs uppercase tracking-wide text-zinc-400">Buffers</div>
            <div className="p-2 space-y-1 text-sm">
              {buffers.map(b => (
                <button key={b.key}
                  onClick={()=>setActive(b.key)}
                  className={(active===b.key ? 'bg-zinc-800 text-white' : 'bg-transparent hover:bg-zinc-900 text-zinc-300') + ' w-full text-left px-2 py-1 rounded border border-zinc-800/60'}>
                  {active===b.key ? '● ' : '○ '} {b.name}
                </button>
              ))}
            </div>
          </div>

          {/* Drag between left and center */}
          <div ref={dragLeftRef} onMouseDown={(e)=>startDrag('left', e)}
            className="w-1.5 cursor-col-resize hover:bg-zinc-700/40 active:bg-zinc-600/60" />

          {/* Center: Editor + Preview + Console */}
          <div className="h-full border-r border-zinc-800/80" style={{ width: `${centerWidth}%` }}>
            <div className="flex items-center gap-1 px-2 h-8 border-b border-zinc-800/80 text-xs">
              {(['html','css','js'] as TabKey[]).map(k => (
                <button key={k} onClick={()=>setActive(k)}
                  className={(active===k? 'bg-zinc-800 text-white':'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900')+ ' px-2 py-1 rounded'}>
                  {k.toUpperCase()}
                </button>
              ))}
              <div className="ml-auto text-zinc-500">{active.toUpperCase()} — {autorun? 'auto':'manual'}</div>
            </div>
            <div className="h-[calc(100%-2rem)] grid grid-rows-[1fr_1fr]">
              <div className="p-2">
                {active==='html' && (
                  <textarea value={html} onChange={e=>setHtml(e.target.value)}
                    spellCheck={false}
                    className="w-full h-full resize-none bg-black/60 border border-zinc-800/80 rounded p-2 font-mono text-sm outline-none focus:ring-1 focus:ring-zinc-700" />
                )}
                {active==='css' && (
                  <textarea value={css} onChange={e=>setCss(e.target.value)}
                    spellCheck={false}
                    className="w-full h-full resize-none bg-black/60 border border-zinc-800/80 rounded p-2 font-mono text-sm outline-none focus:ring-1 focus:ring-zinc-700" />
                )}
                {active==='js' && (
                  <textarea value={js} onChange={e=>setJs(e.target.value)}
                    spellCheck={false}
                    className="w-full h-full resize-none bg-black/60 border border-zinc-800/80 rounded p-2 font-mono text-sm outline-none focus:ring-1 focus:ring-zinc-700" />
                )}
              </div>
              <div className="grid grid-rows-[1fr_140px]">
                <div className="relative">
                  <iframe ref={iframeRef} title="preview" className="absolute inset-0 w-full h-full bg-white"
                    sandbox="allow-scripts allow-same-origin"
                    srcDoc={srcDoc}
                  />
                </div>
                <div className="border-t border-zinc-800/80 bg-black/40 overflow-auto p-2 text-xs font-mono leading-relaxed">
                  {logs.length===0 ? <div className="text-zinc-500">console output…</div> : (
                    <pre className="whitespace-pre-wrap">{logs.map((l,i)=>`› ${l}`).join('\n')}</pre>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Drag between center and right */}
          <div ref={dragRightRef} onMouseDown={(e)=>startDrag('right', e)}
            className="w-1.5 cursor-col-resize hover:bg-zinc-700/40 active:bg-zinc-600/60" />

          {/* Right: Agent stub */}
          <div className="flex-1 h-full">
            <div className="h-8 flex items-center justify-between px-2 border-b border-zinc-800/80 text-xs">
              <div className="text-zinc-400 uppercase tracking-wide">Agent</div>
              <div className="flex items-center gap-2">
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
        </div>
      </div>

      {/* Command line (VIM-style placeholder) */}
      <form onSubmit={onCommandSubmit} className="h-9 border-t border-zinc-800/80 flex items-center gap-2 px-2 bg-black/50">
        <span className="text-zinc-500 text-sm">:</span>
        <input ref={cmdRef} placeholder="run | w | clear | quit" className="flex-1 bg-transparent outline-none text-sm" />
      </form>
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


