import { NextRequest, NextResponse } from 'next/server';
import { exec } from 'child_process';
import { promisify } from 'util';
import { mkdir } from 'fs/promises';
import { join } from 'path';

const execAsync = promisify(exec);

// Base directory for projects
const PROJECTS_DIR = join(process.cwd(), 'projects');

// Get shell command based on OS
function getShellCommand(os: string): { shell: string; separator: string; mkdirCmd: string } {
  switch (os) {
    case 'windows':
      return {
        shell: 'cmd',
        separator: '&',
        mkdirCmd: 'mkdir',
      };
    case 'macos':
    case 'linux':
    default:
      return {
        shell: 'bash',
        separator: '&&',
        mkdirCmd: 'mkdir -p',
      };
  }
}

// Execute a command
async function executeCommand(
  cmd: string, 
  cwd: string = PROJECTS_DIR,
  os: string = 'linux'
): Promise<{ success: boolean; stdout: string; stderr: string }> {
  try {
    // Ensure directory exists
    await mkdir(cwd, { recursive: true });
    
    const shellConfig = getShellCommand(os);
    
    const { stdout, stderr } = await execAsync(cmd, {
      cwd,
      timeout: 300000, // 5 minutes
      maxBuffer: 1024 * 1024 * 10,
      env: {
        ...process.env,
        CI: 'true',
        NG_CLI_ANALYTICS: 'false',
        npm_config_yes: 'true',
        FORCE_COLOR: '0',
      },
      // Use appropriate shell
      shell: os === 'windows' ? 'cmd.exe' : '/bin/bash',
    });

    return {
      success: true,
      stdout: stdout.toString(),
      stderr: stderr.toString(),
    };
  } catch (error: unknown) {
    const execError = error as { stdout?: string; stderr?: string; message?: string };
    return {
      success: false,
      stdout: execError.stdout?.toString() || '',
      stderr: execError.stderr?.toString() || execError.message || String(error),
    };
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { command, cwd, os = 'linux' } = body;

    if (!command) {
      return NextResponse.json({ error: 'Se requiere un comando' }, { status: 400 });
    }

    // Security check - block dangerous commands
    const dangerousPatterns = [
      /rm\s+-rf\s+\//i,
      /sudo\s+rm/i,
      /chmod\s+777\s+\//i,
      />\s*\/dev\/sd/i,
      /mkfs/i,
      /dd\s+if=\/dev/i,
      /:\(\)\{\s*:\|:&\s*\};:/i, // Fork bomb
    ];

    for (const pattern of dangerousPatterns) {
      if (pattern.test(command)) {
        return NextResponse.json({
          success: false,
          stdout: '',
          stderr: 'Comando bloqueado por seguridad',
        });
      }
    }

    const result = await executeCommand(command, cwd, os);

    return NextResponse.json({
      success: result.success,
      stdout: result.stdout,
      stderr: result.stderr,
      command,
      os,
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    console.error('Execute API error:', error);
    return NextResponse.json({
      success: false,
      stdout: '',
      stderr: String(error),
    });
  }
}

export async function GET() {
  return NextResponse.json({
    message: 'API para ejecutar comandos del sistema',
    usage: {
      method: 'POST',
      body: { 
        command: 'ng new my-app', 
        cwd: '/optional/path',
        os: 'linux|windows|macos'
      }
    },
    supportedOS: ['linux', 'windows', 'macos'],
  });
}
