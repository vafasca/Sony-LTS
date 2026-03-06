import { NextRequest, NextResponse } from 'next/server';
import { exec } from 'child_process';
import { promisify } from 'util';
import os from 'os';
import fs from 'fs/promises';
import path from 'path';

const execAsync = promisify(exec);

// Lista de carpetas comunes para acceso rápido
function getCommonFolders(): string[] {
  const homeDir = os.homedir();
  const platform = os.platform();
  
  const folders = [
    homeDir,
    path.join(homeDir, 'Desktop'),
    path.join(homeDir, 'Documents'),
    path.join(homeDir, 'Downloads'),
    path.join(homeDir, 'Projects'),
  ];
  
  if (platform === 'win32') {
    folders.push('C:\\Projects', 'D:\\Projects');
  } else {
    folders.push('/home/projects', '/var/www');
  }
  
  // La validación de existencia se hace de forma asíncrona en el handler GET.
  return folders;
}

// Abrir diálogo de selección de carpeta en Windows
async function openFolderDialogWindows(): Promise<string | null> {
  try {
    // Usar PowerShell con FolderBrowserDialog (evita problemas de escaping con -EncodedCommand)
    const script = `
      try {
        Add-Type -AssemblyName System.Windows.Forms -ErrorAction Stop
        $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
        if ($null -eq $dialog) { return }

        $dialog.Description = 'Selecciona la carpeta del proyecto'
        $dialog.ShowNewFolderButton = $true

        if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
          $dialog.SelectedPath
        }
      } catch {
        Write-Error $_.Exception.Message
      }
    `;

    const encodedScript = Buffer.from(script, 'utf16le').toString('base64');

    const { stdout } = await execAsync(
      `powershell -NoProfile -STA -ExecutionPolicy Bypass -EncodedCommand ${encodedScript}`,
      {
        timeout: 15000,
        windowsHide: true,
        maxBuffer: 1024 * 1024,
      }
    );

    const selectedPath = stdout.trim();
    if (selectedPath && selectedPath.length > 0) {
      return selectedPath;
    }
    return null;
  } catch (error) {
    const e = error as { killed?: boolean; signal?: string; stderr?: string };
    if (e?.killed || e?.signal === 'SIGTERM') {
      console.warn('[FolderDialog] Diálogo cancelado o expirado (timeout).');
      return null;
    }
    console.error('[FolderDialog] Error opening dialog:', error);
    return null;
  }
}

// Listar subcarpetas de un directorio
async function listSubfolders(folderPath: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(folderPath, { withFileTypes: true });
    return entries
      .filter(entry => entry.isDirectory())
      .map(entry => path.join(folderPath, entry.name))
      .slice(0, 50); // Limitar a 50 carpetas
  } catch {
    return [];
  }
}

// Verificar si una ruta es válida
async function validatePath(folderPath: string): Promise<{ valid: boolean; error?: string }> {
  try {
    const stats = await fs.stat(folderPath);
    if (!stats.isDirectory()) {
      return { valid: false, error: 'La ruta no es un directorio' };
    }
    return { valid: true };
  } catch {
    return { valid: false, error: 'Directorio no encontrado' };
  }
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const action = url.searchParams.get('action') || 'common';
  const pathParam = url.searchParams.get('path');
  
  try {
    switch (action) {
      case 'browse': {
        // Abrir diálogo nativo (solo Windows con GUI)
        const platform = os.platform();
        if (platform === 'win32') {
          const selectedPath = await openFolderDialogWindows();
          if (selectedPath) {
            return NextResponse.json({ 
              success: true, 
              path: selectedPath 
            });
          }
          return NextResponse.json({ 
            success: false, 
            error: 'No se seleccionó ninguna carpeta' 
          });
        }
        return NextResponse.json({ 
          success: false, 
          error: 'Diálogo nativo solo disponible en Windows',
          alternative: 'use_input'
        });
      }
      
      case 'list': {
        // Listar subcarpetas de un directorio
        if (!pathParam) {
          return NextResponse.json({ 
            error: 'Parámetro path requerido' 
          }, { status: 400 });
        }
        
        const subfolders = await listSubfolders(pathParam);
        return NextResponse.json({ 
          path: pathParam, 
          subfolders 
        });
      }
      
      case 'validate': {
        // Validar una ruta
        if (!pathParam) {
          return NextResponse.json({ 
            error: 'Parámetro path requerido' 
          }, { status: 400 });
        }
        
        const validation = await validatePath(pathParam);
        return NextResponse.json({ 
          path: pathParam, 
          ...validation 
        });
      }
      
      case 'common':
      default: {
        // Retornar carpetas comunes
        const commonFolders = await Promise.all(
          getCommonFolders().map(async (f) => {
            try {
              await fs.access(f);
              return f;
            } catch {
              return null;
            }
          })
        );
        
        return NextResponse.json({ 
          folders: commonFolders.filter(Boolean),
          home: os.homedir(),
          cwd: process.cwd()
        });
      }
    }
  } catch (error) {
    console.error('[FolderDialog] Error:', error);
    return NextResponse.json({ 
      error: 'Error en el diálogo de carpeta',
      details: String(error) 
    }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, path: folderPath } = body;
    
    if (action === 'create') {
      // Crear una nueva carpeta
      if (!folderPath) {
        return NextResponse.json({ 
          error: 'Ruta requerida' 
        }, { status: 400 });
      }
      
      try {
        await fs.mkdir(folderPath, { recursive: true });
        return NextResponse.json({ 
          success: true, 
          path: folderPath 
        });
      } catch (error) {
        return NextResponse.json({ 
          success: false, 
          error: `Error creando directorio: ${error}` 
        });
      }
    }
    
    return NextResponse.json({ 
      error: 'Acción no reconocida' 
    }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ 
      error: 'Error procesando solicitud',
      details: String(error) 
    }, { status: 500 });
  }
}
