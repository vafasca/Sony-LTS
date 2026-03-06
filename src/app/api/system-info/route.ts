import { NextResponse } from 'next/server';
import { exec } from 'child_process';
import { promisify } from 'util';
import os from 'os';
import fs from 'fs/promises';
import path from 'path';

const execAsync = promisify(exec);

interface SystemInformation {
  os: {
    name: string;
    version: string;
    platform: string;
  };
  ram: {
    total: number;
    available: number;
    usedPercent: number;
  };
  disk: {
    total: number;
    free: number;
    usedPercent: number;
    selectedFolder: string;
  };
  architecture: string;
  cpu: {
    model: string;
    cores: number;
    speed: string;
  };
  shell: string;
}

async function getDiskSpace(folder: string): Promise<{ total: number; free: number }> {
  const platform = os.platform();
  
  try {
    if (platform === 'win32') {
      // Para Windows, usar wmic o PowerShell
      try {
        // Obtener la letra de la unidad del folder
        const driveLetter = path.resolve(folder).split(path.sep)[0] || 'C:';
        const { stdout } = await execAsync(
          `powershell -Command "(Get-PSDrive -Name '${driveLetter.replace(':', '')}').Free; (Get-PSDrive -Name '${driveLetter.replace(':', '')}').Used"`,
          { timeout: 10000 }
        );
        const lines = stdout.trim().split('\n').map(l => parseFloat(l.trim())).filter(n => !isNaN(n));
        if (lines.length >= 2) {
          const free = lines[0] / (1024 * 1024 * 1024);
          const used = lines[1] / (1024 * 1024 * 1024);
          return { total: Math.round(free + used), free: Math.round(free) };
        }
      } catch {
        // Fallback con fs.stat si PowerShell falla
      }
    } else {
      // Linux/Mac - usar df
      const { stdout } = await execAsync(`df -BG "${folder}" | tail -1`, { timeout: 5000 });
      const parts = stdout.trim().split(/\s+/);
      if (parts.length >= 4) {
        const total = parseInt(parts[1].replace('G', '')) || 0;
        const free = parseInt(parts[3].replace('G', '')) || 0;
        return { total, free };
      }
    }
  } catch (error) {
    console.error('[SystemInfo] Error getting disk space:', error);
  }
  
  return { total: 0, free: 0 };
}

async function getCPUInfo(): Promise<{ model: string; cores: number; speed: string }> {
  const cpus = os.cpus();
  const model = cpus[0]?.model || 'Desconocido';
  const cores = cpus.length;
  const speed = cpus[0]?.speed ? `${(cpus[0].speed / 1000).toFixed(2)} GHz` : 'N/A';
  
  return { model, cores, speed };
}

async function getOSInfo(): Promise<{ name: string; version: string; platform: string }> {
  const platform = os.platform();
  const release = os.release();
  
  let name = 'Linux';
  
  if (platform === 'win32') {
    name = 'Windows';
    // Mapear versión de Windows
    const versionMap: Record<string, string> = {
      '10.0.22': 'Windows 11',
      '10.0.19': 'Windows 10',
      '10.0.18': 'Windows 10',
      '10.0.17': 'Windows 10',
      '10.0.16': 'Windows 10',
      '10.0.10': 'Windows 10',
      '6.3': 'Windows 8.1',
      '6.2': 'Windows 8',
      '6.1': 'Windows 7',
    };
    
    for (const [key, value] of Object.entries(versionMap)) {
      if (release.startsWith(key)) {
        name = value;
        break;
      }
    }
    
    // Intentar obtener el nombre exacto con PowerShell
    try {
      const { stdout } = await execAsync(
        'powershell -Command "(Get-CimInstance Win32_OperatingSystem).Caption"',
        { timeout: 5000 }
      );
      if (stdout.trim()) {
        name = stdout.trim();
      }
    } catch {
      // Usar el valor por defecto
    }
  } else if (platform === 'darwin') {
    name = 'macOS';
    try {
      const { stdout } = await execAsync('sw_vers -productVersion', { timeout: 5000 });
      return { name: 'macOS', version: stdout.trim(), platform };
    } catch {
      // Usar release como versión
    }
  }
  
  return { name, version: release, platform };
}

function getShell(): string {
  const platform = os.platform();
  
  if (platform === 'win32') {
    // Detectar si estamos en Git Bash / MINGW64
    if (process.env.MSYSTEM || process.env.MINGW_PREFIX) {
      return 'Git Bash (MINGW64)';
    }
    return 'PowerShell';
  }
  
  const shell = process.env.SHELL || '/bin/bash';
  if (shell.includes('zsh')) return 'zsh';
  if (shell.includes('fish')) return 'fish';
  if (shell.includes('bash')) return 'bash';
  
  return shell;
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const folder = url.searchParams.get('folder') || process.cwd();
    
    // Verificar que el folder existe
    try {
      await fs.access(folder);
    } catch {
      return NextResponse.json({ 
        error: 'Carpeta no encontrada',
        path: folder 
      }, { status: 400 });
    }
    
    // Obtener información del sistema
    const osInfo = await getOSInfo();
    const totalRam = os.totalmem();
    const freeRam = os.freemem();
    const diskInfo = await getDiskSpace(folder);
    const cpuInfo = await getCPUInfo();
    const shell = getShell();
    
    const systemInfo: SystemInformation = {
      os: osInfo,
      ram: {
        total: Math.round(totalRam / (1024 * 1024 * 1024) * 10) / 10,
        available: Math.round(freeRam / (1024 * 1024 * 1024) * 10) / 10,
        usedPercent: Math.round((1 - freeRam / totalRam) * 100),
      },
      disk: {
        total: diskInfo.total,
        free: diskInfo.free,
        usedPercent: diskInfo.total > 0 
          ? Math.round((1 - diskInfo.free / diskInfo.total) * 100) 
          : 0,
        selectedFolder: folder,
      },
      architecture: os.arch() === 'x64' ? 'x86_64' : os.arch(),
      cpu: cpuInfo,
      shell,
    };
    
    return NextResponse.json(systemInfo);
  } catch (error) {
    console.error('[SystemInfo] Error:', error);
    return NextResponse.json({ 
      error: 'Error obteniendo información del sistema',
      details: String(error) 
    }, { status: 500 });
  }
}
