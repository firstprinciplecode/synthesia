import { exec } from 'child_process';
import { promisify } from 'util';

const pexec = promisify(exec);

class TerminalService {
  async executeCommand(command: string, _connectionId?: string): Promise<{ command: string; stdout: string; stderr: string; exitCode: number }> {
    try {
      const { stdout, stderr } = await pexec(command, { timeout: 30_000, maxBuffer: 10 * 1024 * 1024 });
      return { command, stdout, stderr, exitCode: 0 };
    } catch (e: any) {
      return { command, stdout: e.stdout || '', stderr: e.stderr || String(e.message || e), exitCode: typeof e.code === 'number' ? e.code : 1 };
    }
  }
}

export const terminalService = new TerminalService();


