import { NextRequest } from 'next/server';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';

const execAsync = promisify(exec);

// ═══════════════════════════════════════════════════════════════
// DETECCIÓN DE ENTORNO
// ═══════════════════════════════════════════════════════════════

const isWindows = os.platform() === 'win32';

// Verificar si un comando es cmdlet de PowerShell
function isPowerShellCmdlet(cmd: string): boolean {
  const psPatterns = [
    /^Set-Location/i, /^Get-/i, /^New-Item/i, /^Remove-Item/i,
    /^Write-/i, /^Test-Path/i, /^Copy-Item/i, /^Move-Item/i,
    /^Get-CimInstance/i, /^Get-PSDrive/i, /^Get-ChildItem/i,
    /^Test-Connection/i, /^Start-/i, /^Stop-/i,
    /^\(\s*Get-/i,
  ];
  return psPatterns.some(p => p.test(cmd.trim()));
}

// Limpiar comando
function cleanCommand(cmd: string): string {
  let cleaned = cmd.trim();
  if (cleaned.startsWith('$ ') || cleaned.startsWith('$\t')) {
    cleaned = cleaned.substring(1).trim();
  }
  if (cleaned.startsWith('# ') || cleaned.startsWith('#\t')) {
    cleaned = cleaned.substring(1).trim();
  }
  if (cleaned.startsWith('> ') || cleaned.startsWith('>\t')) {
    cleaned = cleaned.substring(1).trim();
  }
  cleaned = cleaned.replace(/^PS\s+[A-Za-z]?:?[^>]*>\s*/i, '');
  cleaned = cleaned.replace(/^[^\s]+@[^\s]+\s+[A-Za-z0-9]+\s+[^\s]+\s*\$\s*/, '');
  return cleaned.trim();
}

// Ejecutar comando directamente
async function runCommand(cmd: string, cwd: string): Promise<{ stdout: string; stderr: string; code: number }> {
  try {
    const { stdout, stderr } = await execAsync(cmd, { cwd, timeout: 300000 });
    return { stdout, stderr, code: 0 };
  } catch (error: unknown) {
    const execError = error as { stdout?: string; stderr?: string; code?: number };
    return { 
      stdout: execError.stdout || '', 
      stderr: execError.stderr || '', 
      code: execError.code || 1 
    };
  }
}

// Ejecutar comando PowerShell
async function runPowerShellCommand(cmd: string, cwd: string): Promise<{ stdout: string; stderr: string; code: number }> {
  const psCmd = `powershell -Command "${cmd.replace(/"/g, '\\"')}"`;
  return runCommand(psCmd, cwd);
}

// Session state para streaming
interface StreamSessionState {
  currentWorkDir: string;
  projectPath: string | null;
}

const streamSessionState: StreamSessionState = {
  currentWorkDir: process.cwd(),
  projectPath: null,
};

// Crear encoder para SSE
const encoder = new TextEncoder();

// Función para enviar evento SSE
function createSSEMessage(event: string, data: Record<string, unknown>): Uint8Array {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, steps, workDir } = body;

    // Crear stream de respuesta
    const stream = new ReadableStream({
      async start(controller) {
        try {
          // Actualizar directorio de trabajo si se proporciona
          if (workDir) {
            streamSessionState.currentWorkDir = workDir;
          }

          if (action === 'execute' && steps) {
            const totalSteps = steps.length;
            
            // Enviar evento de inicio
            controller.enqueue(createSSEMessage('start', { 
              totalSteps,
              message: `Iniciando ejecución de ${totalSteps} pasos...`
            }));

            for (let i = 0; i < steps.length; i++) {
              const step = steps[i];
              const stepNumber = i + 1;

              // Enviar evento de paso iniciado
              controller.enqueue(createSSEMessage('step_start', {
                step: stepNumber,
                total: totalSteps,
                accion: step.accion,
                descripcion: step.descripcion,
                comandos: step.comandos,
                archivos: step.archivos?.map((a: { nombre: string }) => a.nombre),
              }));

              let stepSuccess = true;
              let stepOutput = '';

              // Ejecutar comandos
              if (step.comandos && step.comandos.length > 0) {
                for (const cmd of step.comandos) {
                  const cleanedCmd = cleanCommand(cmd);

                  // Enviar evento de comando ejecutándose
                  controller.enqueue(createSSEMessage('command', {
                    step: stepNumber,
                    command: cleanedCmd,
                    status: 'running'
                  }));

                  // Ejecutar comando
                  let result;
                  if (isWindows && isPowerShellCmdlet(cleanedCmd)) {
                    result = await runPowerShellCommand(cleanedCmd, streamSessionState.currentWorkDir);
                  } else {
                    result = await runCommand(cleanedCmd, streamSessionState.currentWorkDir);
                  }

                  const output = (result.stdout || '') + (result.stderr || '');

                  // Enviar evento de comando completado
                  controller.enqueue(createSSEMessage('command', {
                    step: stepNumber,
                    command: cleanedCmd,
                    status: result.code === 0 ? 'success' : 'error',
                    output: output.substring(0, 3000),
                    code: result.code
                  }));

                  stepOutput += `$ ${cleanedCmd}\n${output}\n`;
                  
                  if (result.code !== 0) {
                    stepSuccess = false;
                  }
                }
              }

              // Crear archivos
              if (step.archivos && step.archivos.length > 0) {
                for (const archivo of step.archivos) {
                  if (archivo.contenido) {
                    try {
                      const filePath = path.isAbsolute(archivo.nombre) 
                        ? archivo.nombre 
                        : path.join(streamSessionState.currentWorkDir, archivo.nombre);
                      const dir = path.dirname(filePath);
                      
                      await fs.mkdir(dir, { recursive: true });
                      await fs.writeFile(filePath, archivo.contenido, 'utf-8');

                      controller.enqueue(createSSEMessage('file_created', {
                        step: stepNumber,
                        file: archivo.nombre,
                        path: filePath
                      }));

                      stepOutput += `📁 Archivo creado: ${archivo.nombre}\n`;
                    } catch (err) {
                      stepSuccess = false;
                      stepOutput += `❌ Error creando archivo ${archivo.nombre}: ${err}\n`;
                    }
                  }
                }
              }

              // Enviar evento de paso completado
              controller.enqueue(createSSEMessage('step_complete', {
                step: stepNumber,
                total: totalSteps,
                success: stepSuccess,
                output: stepOutput.substring(0, 3000),
                progress: Math.round(((stepNumber) / totalSteps) * 100)
              }));

              // Si falló, podemos decidir si continuar o no
              if (!stepSuccess) {
                controller.enqueue(createSSEMessage('error', {
                  step: stepNumber,
                  message: `Paso ${stepNumber} falló. Deteniendo ejecución.`
                }));
                break;
              }
            }

            // Enviar evento de finalización
            controller.enqueue(createSSEMessage('complete', {
              message: 'Ejecución completada',
              workDir: streamSessionState.currentWorkDir
            }));
          }
        } catch (error) {
          controller.enqueue(createSSEMessage('error', {
            message: `Error: ${error}`
          }));
        } finally {
          controller.close();
        }
      }
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
