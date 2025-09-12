"use client";

export function TerminalOutput({ command, stdout, stderr, exitCode }: { command: string; stdout?: string; stderr?: string; exitCode?: number }) {
  return (
    <div className="rounded-md border bg-black text-green-400 p-3 text-xs">
      <div className="text-white mb-2">$ {command}</div>
      {stdout && <pre className="whitespace-pre-wrap text-green-400">{stdout}</pre>}
      {stderr && <pre className="whitespace-pre-wrap text-red-400">{stderr}</pre>}
      {typeof exitCode === 'number' && <div className="mt-2 text-white/60">exit code: {exitCode}</div>}
    </div>
  );
}


