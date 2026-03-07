import { NextRequest, NextResponse } from 'next/server';
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

// Verificar si un comando es específico de PowerShell (cmdlets o script)
function isPowerShellCmdlet(cmd: string): boolean {
  const trimmed = cmd.trim();
  const psPatterns = [
    /^Set-Location/i, /^Get-/i, /^New-Item/i, /^Remove-Item/i,
    /^Write-/i, /^Test-Path/i, /^Copy-Item/i, /^Move-Item/i,
    /^Get-CimInstance/i, /^Get-PSDrive/i, /^Get-ChildItem/i,
    /^Test-Connection/i, /^Start-/i, /^Stop-/i,
    /^\(\s*Get-/i,  // (Get-... expresiones
    /^try\s*\{/i, /^if\s*\(/i, // bloques de script powershell
    /^\$[A-Za-z_]/,              // variable powershell al inicio
    /^\[[A-Za-z0-9_.]+\]::/,   // expresiones .NET: [math]::Floor(...), [version]::Parse(... )
  ];

  if (psPatterns.some(p => p.test(trimmed))) {
    return true;
  }

  // Heurísticas para scripts PowerShell inline aunque no inicien por cmdlet
  return /\$[A-Za-z_][A-Za-z0-9_]*\s*=/.test(trimmed)
    || /\[[A-Za-z0-9_.]+\]::/.test(trimmed)
    || /\[version\]/i.test(trimmed)
    || /\bWrite-Output\b/i.test(trimmed)
    || /\bSilentlyContinue\b/i.test(trimmed)
    || /\bcatch\s*\{/i.test(trimmed);
}

// Limpiar comando - eliminar símbolos de prompt que no son parte del comando
function cleanCommand(cmd: string): string {
  let cleaned = cmd.trim();
  
  // Eliminar $ al inicio (prompt de Linux/Mac bash)
  if (cleaned.startsWith('$ ') || cleaned.startsWith('$\t')) {
    cleaned = cleaned.substring(1).trim();
  }
  
  // Eliminar # al inicio (prompt de root)
  if (cleaned.startsWith('# ') || cleaned.startsWith('#\t')) {
    cleaned = cleaned.substring(1).trim();
  }
  
  // Eliminar > al inicio (prompt de cmd)
  if (cleaned.startsWith('> ') || cleaned.startsWith('>\t')) {
    cleaned = cleaned.substring(1).trim();
  }
  
  // Eliminar prompts de PowerShell como "PS C:\ruta> "
  cleaned = cleaned.replace(/^PS\s+[A-Za-z]?:?[^>]*>\s*/i, '');
  
  // Eliminar prompts de MINGW64/Git Bash
  cleaned = cleaned.replace(/^[^\s]+@[^\s]+\s+[A-Za-z0-9]+\s+[^\s]+\s*\$\s*/, '');
  
  return cleaned.trim();
}

function stripAnsi(text: string): string {
  return String(text || '').replace(/\u001B\[[0-9;]*m/g, '');
}

// ═══════════════════════════════════════════════════════════════
// EJECUCIÓN DE COMANDOS - SIMPLE Y DIRECTO
// ═══════════════════════════════════════════════════════════════

// Ejecutar comando directamente (como en el script que funciona)
async function runCommand(cmd: string, cwd: string): Promise<{ stdout: string; stderr: string; code: number }> {
  let effectiveCwd = cwd;
  let cwdWarning = '';

  // En Windows/Git Bash es común que el cwd "recordado" no exista todavía.
  // Si eso ocurre, hacemos fallback al cwd del proceso para evitar ENOENT.
  try {
    const stats = await fs.stat(cwd);
    if (!stats.isDirectory()) {
      throw new Error('cwd no es directorio');
    }
  } catch {
    effectiveCwd = process.cwd();
    cwdWarning = `[runCommand] ⚠️ cwd inválido (${cwd}). Usando fallback: ${effectiveCwd}\n`;
  }

  try {
    // En Windows forzamos cmd.exe para evitar dependencias de shell heredada
    // (por ejemplo entornos MINGW sin COMSPEC consistente).
    const { stdout, stderr } = await execAsync(cmd, {
      cwd: effectiveCwd,
      timeout: 300000,
      ...(isWindows ? { shell: process.env.ComSpec || 'cmd.exe' } : {}),
    });
    return { stdout, stderr: `${cwdWarning}${stderr || ''}`, code: 0 };
  } catch (error: unknown) {
    const execError = error as { stdout?: string; stderr?: string; code?: number; message?: string };
    const stderr = `${cwdWarning}${execError.stderr || execError.message || ''}`;
    return {
      stdout: execError.stdout || '',
      stderr,
      code: typeof execError.code === 'number' ? execError.code : 1,
    };
  }
}

// Ejecutar comando PowerShell (para cmdlets específicos)
async function runPowerShellCommand(cmd: string, cwd: string): Promise<{ stdout: string; stderr: string; code: number }> {
  // Intentar con distintos binarios (Windows/Git Bash/pwsh)
  // y con flags equivalentes al script manual que sí funciona.
  const escapedCmd = cmd.replace(/"/g, '\\"');
  const candidates = [
    `powershell -NoProfile -ExecutionPolicy Bypass -Command "${escapedCmd}"`,
    `powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "${escapedCmd}"`,
    `pwsh -NoProfile -ExecutionPolicy Bypass -Command "${escapedCmd}"`,
    `pwsh.exe -NoProfile -ExecutionPolicy Bypass -Command "${escapedCmd}"`,
  ];

  let lastResult = { stdout: '', stderr: 'No se pudo ejecutar PowerShell', code: 1 };

  for (const candidate of candidates) {
    const result = await runCommand(candidate, cwd);

    // ENOENT suele indicar que ese ejecutable no existe en PATH.
    const output = `${result.stdout}\n${result.stderr}`;
    const isMissingExecutable = result.code === 1 && /ENOENT|not found|is not recognized/i.test(output);

    if (!isMissingExecutable) {
      return result;
    }

    lastResult = result;
  }

  return lastResult;
}

/**
 * Main Processing API - Flujo de Sonny v2.1
 * 
 * FLUJO DE FASES:
 * 1A - Análisis de requisitos previos
 * 1B - Instalación y configuración de requisitos
 * 2  - Scaffolding y estructura del proyecto
 * 3  - Desarrollo por bloques
 * 4  - Validación y pruebas
 * 
 * IMPORTANTE: El servidor detecta su propio entorno y genera comandos
 * para ESE entorno. Los comandos se ejecutan donde corre el backend.
 */

// ═══════════════════════════════════════════════════════════════
// TIPOS
// ═══════════════════════════════════════════════════════════════

interface SystemInfo {
  os_nombre: string;
  os_version: string;
  arquitectura: string;
  shell_disponible: string;
  gestor_paquetes: string;
  ram_gb: number;
  espacio_disco_gb: number;
  conexion_internet: boolean;
  disco_seleccionado: string;
  directorio_trabajo: string;
}

interface Requisito {
  nombre: string;
  tipo: 'software' | 'hardware' | 'archivo' | 'credencial' | 'herramienta_fisica' | 'conocimiento' | 'otro';
  obligatorio: boolean;
  instalar_automaticamente: boolean;
  version_minima: string | number | null;
  version_recomendada: string | number | null;
  comparador: '>=' | '>' | '==' | null;
  comparador_error: '<' | '<=' | null;
  unidad: 'GB' | 'MB' | null;
  comando_verificacion: string | null;
  salida_esperada: string | number | null;
  salida_error: number | null;
  accion_si_falta: 'instalar' | 'actualizar' | 'configurar' | 'adquirir' | 'liberar' | 'ignorar';
  comando_instalacion: string | null;
}

interface Decision {
  decision: string;
  valor: string;
  justificacion: string;
  alternativas_descartadas: Array<{ nombre: string; razon: string }>;
}

interface ExecutionStep {
  id: string;
  fase: string;
  paso: string;
  accion: 'verificar' | 'instalar' | 'configurar' | 'crear' | 'editar' | 'eliminar' | 'validar' | 'corregir' | 'ejecutar' | 'scaffolding' | 'desarrollo_bloque';
  descripcion: string;
  status: 'pending' | 'running' | 'success' | 'error';
  comandos?: string[];
  archivos?: Array<{ nombre: string; contenido?: string; ruta?: string }>;
  validacion?: string;
  progreso?: string;
  output?: string;
  requisito_origen?: string;
  tipo?: string;
}

interface ErrorReport {
  fase: string;
  paso: string;
  accion_ejecutada: string;
  tipo_error: 'instalacion' | 'configuracion' | 'codigo' | 'comando' | 'compatibilidad' | 'permisos' | 'red' | 'otro';
  mensaje_error: string;
  codigo_salida: number | null;
  archivo_afectado: string | null;
  linea_error: number | null;
  contexto_archivo: string | null;
  estructura_proyecto: Record<string, unknown>;
  archivos_afectados: string[];
  intentos_previos: Array<{ comando_intentado: string; resultado: string }>;
  entorno_adicional: {
    version_runtime: string | null;
    version_gestor: string | null;
    requirement_checks?: Array<Record<string, unknown>>;
  };
}

interface Phase1AResponse {
  objetivo: string;
  fase: string;
  accion: string;
  tipo_tarea: 'digital' | 'fisico' | 'mixto';
  entorno_detectado: Record<string, string>;
  decisiones_tomadas: Decision[];
  descripcion: string;
  requisitos: Requisito[];
  compatibilidades: Array<Record<string, unknown>>;
  alertas_entorno: Array<{ tipo: string; mensaje: string; critico: boolean }>;
  archivos_necesarios: Array<unknown>;
  credenciales_necesarias: Array<unknown>;
  validacion_final: { comando: string | null; salida_esperada: string | null; salida_error: string | null };
  progreso: string;
  siguiente_fase: string;
}

interface Phase2Response {
  fase: string;
  accion: string;
  tipo_scaffold: 'cli' | 'manual';
  descripcion: string;
  nombre_proyecto: string;
  ruta_proyecto: string;
  estructura_esperada: Record<string, unknown>;
  pasos: Array<{
    orden: number;
    descripcion: string;
    tipo: 'comando' | 'archivo';
    comando: string | null;
    archivo: { ruta: string; operacion: string; contenido: string | null } | null;
    continuar_si_falla: boolean;
  }>;
  validacion: { comando: string; salida_esperada: string; salida_error: string; comparador: string };
  progreso: string;
  siguiente_fase: string;
}

interface Phase3Response {
  fase: string;
  accion: string;
  bloque_actual: { id: string; nombre: string; descripcion: string; dependencias_bloque: string[] };
  dependencias_adicionales: Array<{ nombre: string; comando_instalacion: string; razon: string }>;
  archivos: Array<{ ruta: string; operacion: string; descripcion: string; contenido: string }>;
  comandos_post_escritura: Array<{ orden: number; descripcion: string; comando: string; continuar_si_falla: boolean }>;
  previsualizacion: { comando: string; url: string | null; instruccion: string };
  validacion: { comando: string; salida_esperada: string; salida_error: string; comparador: string };
  bloques_pendientes: Array<{ id: string; nombre: string; depende_de: string[] }>;
  progreso: string;
  siguiente_bloque: string | null;
  siguiente_fase: string | null;
}

// ═══════════════════════════════════════════════════════════════
// ESTADO GLOBAL DE LA SESIÓN
// ═══════════════════════════════════════════════════════════════

interface SessionState {
  currentWorkDir: string;
  projectPath: string | null;
  phase1AResult: Phase1AResponse | null;
  phase2Result: Phase2Response | null;
  completedBlocks: string[];
  currentBlock: string | null;
  pendingBlocks: string[];
  errores: Array<{ fase: string; paso: string; error: string }>;
}

const sessionState: SessionState = {
  currentWorkDir: process.cwd(),
  projectPath: null,
  phase1AResult: null,
  phase2Result: null,
  completedBlocks: [],
  currentBlock: null,
  pendingBlocks: [],
  errores: [],
};

// ═══════════════════════════════════════════════════════════════
// DETECCIÓN DE ENTORNO DEL SERVIDOR
// ═══════════════════════════════════════════════════════════════

// Función auxiliar para ejecutar comandos de detección de forma segura
async function safeExecForDetection(cmd: string): Promise<{ stdout: string; stderr: string }> {
  try {
    const result = await runCommand(cmd, process.cwd());
    return { stdout: result.stdout, stderr: result.stderr };
  } catch {
    return { stdout: '', stderr: '' };
  }
}

async function detectServerEnvironment(): Promise<SystemInfo> {
  const platform = os.platform();
  const release = os.release();
  const arch = os.arch();
  const totalRam = os.totalmem();
  const ramGb = Math.round(totalRam / (1024 * 1024 * 1024));
  
  // Determinar nombre del OS
  let osNombre = 'Linux';
  let osVersion = release;
  let shellDisponible = 'bash';
  let gestorPaquetes = 'apt';
  
  if (platform === 'win32') {
    osNombre = 'Windows';
    shellDisponible = 'PowerShell';
    gestorPaquetes = 'winget';
    // Verificar chocolatey
    try {
      const { stdout } = await safeExecForDetection('choco --version');
      if (stdout.trim()) gestorPaquetes = 'chocolatey';
    } catch { /* winget es default */ }
  } else if (platform === 'darwin') {
    osNombre = 'macOS';
    shellDisponible = 'zsh';
    gestorPaquetes = 'brew';
  } else {
    // Linux - verificar qué gestor está disponible
    const managers = [
      { cmd: 'apt-get', name: 'apt' },
      { cmd: 'dnf', name: 'dnf' },
      { cmd: 'yum', name: 'yum' },
      { cmd: 'pacman', name: 'pacman' },
    ];
    
    for (const m of managers) {
      try {
        const { stdout } = await execAsync(`which ${m.cmd}`, { timeout: 2000 });
        if (stdout.trim()) {
          gestorPaquetes = m.name;
          break;
        }
      } catch { /* continuar */ }
    }
    
    // Detectar shell
    const shell = process.env.SHELL || '/bin/bash';
    if (shell.includes('zsh')) shellDisponible = 'zsh';
    else if (shell.includes('fish')) shellDisponible = 'fish';
  }
  
  // Espacio en disco
  let espacioDisco = 50;
  try {
    if (platform === 'win32') {
      // Usar PowerShell para obtener espacio en disco
      const result = await runPowerShellCommand('(Get-PSDrive -Name C).Free / 1GB', process.cwd());
      const valor = parseFloat(result.stdout.trim());
      if (!isNaN(valor)) espacioDisco = Math.round(valor);
    } else {
      const { stdout } = await execAsync('df -BG / | tail -1', { timeout: 5000 });
      const match = stdout.match(/(\d+)G\s+\d+%.*$/);
      if (match) espacioDisco = parseInt(match[1]);
    }
  } catch { /* usar default */ }
  
  // Conexión a internet
  let conexionInternet = false;
  try {
    if (platform === 'win32') {
      // Usar ping normal (más simple)
      const result = await runCommand('ping -n 1 google.com', process.cwd());
      conexionInternet = result.code === 0;
    } else {
      await execAsync('ping -c 1 google.com', { timeout: 5000 });
      conexionInternet = true;
    }
  } catch { /* sin conexión */ }
  
  return {
    os_nombre: osNombre,
    os_version: osVersion,
    arquitectura: arch === 'x64' ? 'x86_64' : arch,
    shell_disponible: shellDisponible,
    gestor_paquetes: gestorPaquetes,
    ram_gb: ramGb,
    espacio_disco_gb: espacioDisco,
    conexion_internet: conexionInternet,
    disco_seleccionado: platform === 'win32' ? 'C' : '/',
    directorio_trabajo: sessionState.currentWorkDir,
  };
}

// ═══════════════════════════════════════════════════════════════
// EJECUCIÓN DE COMANDOS
// ═══════════════════════════════════════════════════════════════

async function executeCommand(cmd: string, systemInfo: SystemInfo): Promise<{ success: boolean; output: string; exitCode: number }> {
  // ═══════════════════════════════════════════════════════════════
  // LIMPIAR COMANDO - Eliminar símbolos de prompt
  // Los prompts como $, #, >, PS C:\> NO son parte del comando
  // ═══════════════════════════════════════════════════════════════
  const cleanedCmd = cleanCommand(cmd);
  
  const commandCwd = sessionState.currentWorkDir;

  console.log(`[executeCommand] Ejecutando: ${cleanedCmd}`);
  console.log(`[executeCommand] Shell: ${systemInfo.shell_disponible}`);
  console.log(`[executeCommand] Directorio de trabajo: ${commandCwd}`);
  
  try {
    let commandToRun = cleanedCmd;
    let executionCwd = commandCwd;

    // Soportar comandos compuestos del tipo:
    //   cd <ruta>; <comando>
    //   cd <ruta> && <comando>
    // para evitar que se interpreten como un único "cd" inválido.
    const chainedCdPatterns = [
      /^cd\s+([^;&]+)\s*(?:;|&&)\s*(.+)$/i,
      /^Set-Location\s+([^;&]+)\s*(?:;|&&)\s*(.+)$/i,
      /^sl\s+([^;&]+)\s*(?:;|&&)\s*(.+)$/i,
    ];

    for (const pattern of chainedCdPatterns) {
      const match = commandToRun.match(pattern);
      if (!match) continue;

      const targetDir = match[1].trim().replace(/^["']|["']$/g, '');
      const trailingCommand = (match[2] || '').trim();
      const newDir = path.isAbsolute(targetDir)
        ? targetDir
        : path.join(commandCwd, targetDir);

      try {
        await fs.access(newDir);
        sessionState.currentWorkDir = newDir;
        executionCwd = newDir;
        commandToRun = trailingCommand;
        console.log(`[executeCommand] ℹ️ Comando compuesto detectado. cwd=${newDir}; comando=${commandToRun}`);
      } catch {
        console.log(`[executeCommand] ❌ Directorio no encontrado en comando compuesto: ${newDir}`);
        return {
          success: false,
          output: `Directorio no encontrado: ${newDir}`,
          exitCode: 1,
        };
      }
      break;
    }

    // ═══════════════════════════════════════════════════════════════
    // INTERCEPTAR COMANDOS DE CAMBIO DE DIRECTORIO
    // Estos comandos no funcionan entre llamadas porque cada llamada
    // es un proceso independiente
    // ═══════════════════════════════════════════════════════════════
    
    // Patrones de cambio de directorio para diferentes shells
    const cdPatterns = [
      /^cd\s+([^;&]+)\s*$/i,                              // bash/cmd: cd ruta
      /^Set-Location\s+["']?([^;&]+?)["']?\s*$/i,        // PowerShell: Set-Location "ruta"
      /^sl\s+["']?([^;&]+?)["']?\s*$/i,                  // PowerShell alias: sl ruta
      /^pushd\s+([^;&]+)\s*$/i,                           // pushd ruta
    ];
    
    for (const pattern of cdPatterns) {
      const match = commandToRun.match(pattern);
      if (match) {
        let targetDir = match[1].trim().replace(/^["']|["']$/g, '');
        
        // Manejar rutas relativas
        const newDir = path.isAbsolute(targetDir) 
          ? targetDir 
          : path.join(commandCwd, targetDir);
        
        try {
          await fs.access(newDir);
          sessionState.currentWorkDir = newDir;
          console.log(`[executeCommand] ✅ Directorio cambiado a: ${sessionState.currentWorkDir}`);
          return { 
            success: true, 
            output: `Directorio cambiado a: ${sessionState.currentWorkDir}`, 
            exitCode: 0 
          };
        } catch {
          console.log(`[executeCommand] ❌ Directorio no encontrado: ${newDir}`);
          return { 
            success: false, 
            output: `Directorio no encontrado: ${newDir}`, 
            exitCode: 1 
          };
        }
      }
    }
    
    // ═══════════════════════════════════════════════════════════════
    // INTERCEPTAR COMANDOS DE CREACIÓN DE DIRECTORIOS (PowerShell)
    // New-Item -ItemType Directory -Path "ruta" -Force
    // ═══════════════════════════════════════════════════════════════
    
    const mkdirMatch = cleanedCmd.match(/New-Item\s+-ItemType\s+Directory\s+-Path\s+(?:"([^"]+)"|'([^']+)'|(\S+))/i);
    if (mkdirMatch) {
      const targetPath = mkdirMatch[1] || mkdirMatch[2] || mkdirMatch[3];
      const fullPath = path.isAbsolute(targetPath) 
        ? targetPath 
        : path.join(commandCwd, targetPath);
      
      try {
        await fs.mkdir(fullPath, { recursive: true });
        console.log(`[executeCommand] ✅ Directorio creado: ${fullPath}`);
        return { 
          success: true, 
          output: `Directorio creado: ${fullPath}`, 
          exitCode: 0 
        };
      } catch (err) {
        console.log(`[executeCommand] ❌ Error creando directorio: ${err}`);
        return { 
          success: false, 
          output: `Error creando directorio: ${err}`, 
          exitCode: 1 
        };
      }
    }
    
    // ═══════════════════════════════════════════════════════════════
    // EJECUTAR COMANDO
    // Usar execAsync directamente como en el script que funciona
    // ═══════════════════════════════════════════════════════════════
    
    let result;

    // Normalizar scaffolding Angular para evitar rutas absolutas en --directory.
    // Con workDir correcto, ng new debe operar con nombre de proyecto y --directory relativo.
    const ngNewMatch = commandToRun.match(/^ng\s+new\s+(?:"([^"]+)"|'([^']+)'|(\S+))(.*)$/i);
    if (ngNewMatch) {
      const targetRaw = (ngNewMatch[1] || ngNewMatch[2] || ngNewMatch[3] || '').trim();
      let restArgs = ngNewMatch[4] || '';

      const sanitizeProjectName = (value: string): string =>
        path.basename(value).replace(/[^a-zA-Z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'app';

      if (targetRaw && (path.isAbsolute(targetRaw) || targetRaw.includes('\\') || targetRaw.includes('/'))) {
        const projectName = sanitizeProjectName(targetRaw);
        if (path.isAbsolute(targetRaw)) {
          executionCwd = path.dirname(targetRaw);
        }
        commandToRun = `ng new "${projectName}"${restArgs}`;
        restArgs = commandToRun.replace(/^ng\s+new\s+(?:"[^"]+"|'[^']+'|\S+)/i, '');
      }

      const dirMatch = restArgs.match(/\s--directory(?:\s+|=)(?:"([^"]+)"|'([^']+)'|(\S+))/i);
      if (dirMatch) {
        const originalDirToken = dirMatch[0];
        const dirRaw = (dirMatch[1] || dirMatch[2] || dirMatch[3] || '').trim();
        let normalizedDir = dirRaw;

        if (dirRaw) {
          normalizedDir = path.basename(dirRaw.replace(/\\/g, '/')) || dirRaw;
          if (path.isAbsolute(dirRaw)) {
            executionCwd = path.dirname(dirRaw);
          }
        }

        restArgs = restArgs.replace(originalDirToken, ` --directory "${normalizedDir}"`);
      }

      if (!/^ng\s+new\s+/i.test(commandToRun)) {
        commandToRun = `ng new "${sanitizeProjectName(targetRaw || 'app')}"${restArgs}`;
      } else {
        commandToRun = commandToRun.replace(/^(ng\s+new\s+(?:"[^"]+"|'[^']+'|\S+)).*$/i, `$1${restArgs}`);
      }

      console.log(`[executeCommand] ℹ️ Normalizado ng new (sin rutas absolutas): ${commandToRun}; cwd=${executionCwd}`);
    }
    
    // Verificar si es un cmdlet de PowerShell que necesita ser envuelto
    if (isWindows && isPowerShellCmdlet(commandToRun)) {
      console.log('[executeCommand] Estrategia: PowerShell cmdlet');
      result = await runPowerShellCommand(commandToRun, executionCwd);
    } else {
      console.log('[executeCommand] Estrategia: Comando directo');
      result = await runCommand(commandToRun, executionCwd);
    }
    
    const output = (result.stdout || '') + (result.stderr || '');
    
    if (result.code === 0) {
      console.log(`[executeCommand] ✅ Output (${output.length} chars)`);
      return { success: true, output: output || 'Comando ejecutado correctamente', exitCode: 0 };
    } else {
      console.log(`[executeCommand] ❌ Error (code ${result.code}):`, output.substring(0, 500));
      return { success: false, output, exitCode: result.code };
    }
  } catch (error: unknown) {
    const execError = error as { message?: string; code?: number };
    const output = execError.message || 'Error desconocido';
    const exitCode = execError.code || 1;
    console.log(`[executeCommand] ❌ Excepción (code ${exitCode}):`, output.substring(0, 500));
    return { success: false, output, exitCode };
  }
}


async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function normalizeProjectRelativePath(inputPath: string): string {
  const normalizedInput = String(inputPath || '').trim().replace(/\\/g, '/');
  if (!normalizedInput) return normalizedInput;

  if (path.isAbsolute(normalizedInput)) {
    return normalizedInput;
  }

  // Si la IA devuelve prefijos redundantes (workspace/proyecto/.../src/app/file),
  // recortamos al segmento de proyecto para escribir en el cwd correcto.
  const keepFromMarkers = ['src/', 'public/', '.vscode/', 'assets/'];
  for (const marker of keepFromMarkers) {
    const markerIndex = normalizedInput.indexOf(marker);
    if (markerIndex > 0) {
      return normalizedInput.slice(markerIndex).replace(/^\/+/, '');
    }
  }

  // Archivos típicos de raíz del proyecto Angular.
  const rootFiles = [
    'angular.json',
    'package.json',
    'package-lock.json',
    'README.md',
    'tsconfig.json',
    'tsconfig.app.json',
    'tsconfig.spec.json',
    '.gitignore',
    '.editorconfig',
    '.prettierrc',
  ];
  for (const rootFile of rootFiles) {
    const suffix = `/${rootFile}`;
    if (normalizedInput.endsWith(suffix)) {
      return rootFile;
    }
  }

  const cwdBase = path.basename(sessionState.currentWorkDir || '').replace(/\\/g, '/');
  if (cwdBase && (normalizedInput === cwdBase || normalizedInput.startsWith(`${cwdBase}/`))) {
    return normalizedInput.slice(cwdBase.length).replace(/^\/+/, '');
  }

  const projectBase = path.basename(sessionState.projectPath || '').replace(/\\/g, '/');
  if (projectBase && (normalizedInput === projectBase || normalizedInput.startsWith(`${projectBase}/`))) {
    return normalizedInput.slice(projectBase.length).replace(/^\/+/, '');
  }

  return normalizedInput;
}


async function resolveProjectRootPath(): Promise<string> {
  const candidates: string[] = [];

  const addCandidate = (candidate?: string | null) => {
    if (!candidate) return;
    const trimmed = String(candidate).trim();
    if (!trimmed) return;
    if (!candidates.includes(trimmed)) {
      candidates.push(trimmed);
    }
  };

  const phase2ProjectName = sessionState.phase2Result?.nombre_proyecto;

  // Prioridad alta: ruta concreta del proyecto generado en FASE 2.
  if (phase2ProjectName) {
    addCandidate(sessionState.projectPath ? path.join(sessionState.projectPath, phase2ProjectName) : null);
    addCandidate(sessionState.currentWorkDir ? path.join(sessionState.currentWorkDir, phase2ProjectName) : null);
    addCandidate(path.join(process.cwd(), phase2ProjectName));
  }

  // Prioridad media: ubicaciones de sesión.
  addCandidate(sessionState.projectPath);
  addCandidate(sessionState.currentWorkDir);

  // Fallback: cwd del proceso.
  addCandidate(process.cwd());

  let bestCandidate: string | null = null;
  let bestScore = -1;

  for (const candidate of candidates) {
    const angularJson = path.join(candidate, 'angular.json');
    const packageJson = path.join(candidate, 'package.json');
    const srcDir = path.join(candidate, 'src');

    const hasAngular = await pathExists(angularJson);
    const hasPackage = await pathExists(packageJson);
    const hasSrc = await pathExists(srcDir);

    const score = hasAngular ? 3 : (hasPackage && hasSrc ? 2 : (hasPackage || hasSrc ? 1 : 0));

    if (score > bestScore) {
      bestScore = score;
      bestCandidate = candidate;
      if (score === 3) break;
    }
  }

  return bestCandidate || sessionState.currentWorkDir || sessionState.projectPath || process.cwd();
}


async function buildProjectStructureSnapshot(rootPath: string): Promise<Record<string, unknown>> {
  const maxEntries = 250;
  let entryCount = 0;
  let totalFiles = 0;
  let totalDirectories = 0;
  let truncated = false;

  const entriesList: string[] = [];
  const ignored = new Set([
    'node_modules', '.git', '.next', 'dist', 'build', 'coverage', 'out',
    '.angular', '.cache', 'tmp', 'temp'
  ]);

  const walk = async (absDir: string, relDir: string): Promise<void> => {
    let entries;
    try {
      entries = await fs.readdir(absDir, { withFileTypes: true });
    } catch {
      return;
    }

    entries.sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) return -1;
      if (!a.isDirectory() && b.isDirectory()) return 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });

    for (const entry of entries) {
      if (ignored.has(entry.name)) continue;
      const relPath = relDir ? `${relDir}/${entry.name}` : entry.name;
      const absPath = path.join(absDir, entry.name);

      if (entry.isDirectory()) {
        totalDirectories++;
        if (entryCount < maxEntries) {
          entriesList.push(relPath);
          entryCount++;
        } else {
          truncated = true;
        }
        await walk(absPath, relPath);
      } else if (entry.isFile()) {
        totalFiles++;
        if (entryCount < maxEntries) {
          entriesList.push(relPath);
          entryCount++;
        } else {
          truncated = true;
        }
      }
    }
  };

  await walk(rootPath, '');

  return {
    tipo: 'listado_rutas_relativas',
    raiz: rootPath,
    paths: entriesList,
    resumen: {
      archivos: totalFiles,
      directorios: totalDirectories,
      entradas_mostradas: entriesList.length,
      truncado: truncated,
    },
    nota: 'Snapshot compacto para FASE 3: solo rutas relativas visibles (sin contenido de archivos).',
  };
}

async function createFile(nombre: string, contenido: string): Promise<{ success: boolean; message: string }> {
  console.log(`[createFile] Creando: ${nombre}`);
  
  try {
    const normalizedTarget = normalizeProjectRelativePath(nombre);
    const filePath = path.isAbsolute(normalizedTarget) ? normalizedTarget : path.join(sessionState.currentWorkDir, normalizedTarget);
    const dir = path.dirname(filePath);
    
    // Crear directorios si no existen
    await fs.mkdir(dir, { recursive: true });
    
    // Escribir archivo
    await fs.writeFile(filePath, contenido, 'utf-8');
    
    console.log(`[createFile] ✅ Archivo creado: ${filePath}`);
    return { success: true, message: `Archivo creado: ${filePath}` };
  } catch (error) {
    return { success: false, message: `Error creando archivo: ${error}` };
  }
}

// ═══════════════════════════════════════════════════════════════
// PROVEEDORES DE IA (Groq)
// ═══════════════════════════════════════════════════════════════

interface Provider {
  name: string;
  apiKey: string;
  url: string;
  model: string;
}

async function callGroqProvider(
  provider: Provider,
  systemPrompt: string,
  userMessage: string,
  maxTokens: number = 500
): Promise<{ success: boolean; content?: string; error?: string }> {
  try {
    if (!provider.apiKey) {
      return { success: false, error: 'API Key no configurada' };
    }

    const response = await fetch(provider.url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${provider.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: provider.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage }
        ],
        temperature: 0.1,
        max_tokens: maxTokens,
      }),
    });

    if (!response.ok) {
      return { success: false, error: `Error ${response.status}` };
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';
    
    return { success: true, content };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

async function tryGroqProviders(
  groqApiKey: string,
  systemPrompt: string,
  userMessage: string,
  maxTokens: number = 500
): Promise<{ success: boolean; content?: string; provider?: string; error?: string }> {
  const providers: Provider[] = [
    { name: 'Groq-70B', apiKey: groqApiKey, url: 'https://api.groq.com/openai/v1/chat/completions', model: 'llama-3.3-70b-versatile' },
    { name: 'Groq-8B', apiKey: groqApiKey, url: 'https://api.groq.com/openai/v1/chat/completions', model: 'llama-3.1-8b-instant' },
  ];

  for (const provider of providers) {
    if (!provider.apiKey) continue;
    
    const result = await callGroqProvider(provider, systemPrompt, userMessage, maxTokens);

    if (result.success && result.content) {
      return { success: true, content: result.content, provider: provider.name };
    }
  }

  return { success: false, error: 'Todos los proveedores fallaron' };
}

// ═══════════════════════════════════════════════════════════════
// PARSING DE JSON
// ═══════════════════════════════════════════════════════════════

function parseJSONResponse<T>(response: string): T | null {
  const normalize = (text: string): string => text
    .replace(/^\uFEFF/, '')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .trim();

  const escapeUnescapedQuotesInFieldValues = (input: string, fieldNames: string[]): string => {
    let text = input;

    for (const field of fieldNames) {
      const fieldPattern = new RegExp(`"${field}"\\s*:\\s*"`, 'g');
      let match: RegExpExecArray | null;

      while ((match = fieldPattern.exec(text)) !== null) {
        const valueStart = match.index + match[0].length;
        let i = valueStart;
        let repaired = '';

        while (i < text.length) {
          const ch = text[i];

          if (ch === '"' && text[i - 1] !== '\\') {
            const tail = text.slice(i + 1);
            const nextNonSpace = tail.match(/^\s*/)?.[0].length ?? 0;
            const token = tail[nextNonSpace] || '';
            if (token === ',' || token === '}' || token === ']') {
              break;
            }
            repaired += '\\"';
            i++;
            continue;
          }

          repaired += ch;
          i++;
        }

        if (i >= text.length) break;

        text = `${text.slice(0, valueStart)}${repaired}${text.slice(i)}`;
        fieldPattern.lastIndex = valueStart + repaired.length + 1;
      }
    }

    return text;
  };

  const repairCommonJsonIssues = (raw: string): string => {
    const noFences = normalize(raw)
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/```$/i, '')
      .trim();

    const escapedFieldValues = escapeUnescapedQuotesInFieldValues(noFences, [
      'contenido',
      'comando',
      'instruccion',
      'descripcion',
      'mensaje',
      'razon',
      'justificacion',
      'causa_raiz',
    ]);

    return escapedFieldValues
      .replace(/,\s*([}\]])/g, '$1')
      .trim();
  };

  const tryParse = (raw: string): T | null => {
    const clean = repairCommonJsonIssues(raw);

    try {
      return JSON.parse(clean) as T;
    } catch {
      return null;
    }
  };

  // 1) Intento directo
  const direct = tryParse(response);
  if (direct) return direct;

  // 2) Intento en bloques markdown
  const fencedBlocks = [
    ...response.matchAll(/```json\s*([\s\S]*?)```/gi),
    ...response.matchAll(/```\s*([\s\S]*?)```/g),
  ];
  for (const block of fencedBlocks) {
    const parsed = tryParse(block[1] || block[0]);
    if (parsed) return parsed;
  }

  // 3) Extraer por llaves balanceadas (evita regex greedy/noisy)
  const text = normalize(response);
  const candidates: string[] = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (ch === '\\') {
      escaped = true;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (ch === '{') {
      if (depth === 0) start = i;
      depth++;
      continue;
    }

    if (ch === '}') {
      if (depth > 0) depth--;
      if (depth === 0 && start >= 0) {
        candidates.push(text.slice(start, i + 1));
        start = -1;
      }
    }
  }

  for (const candidate of candidates) {
    const parsed = tryParse(candidate);
    if (parsed) return parsed;
  }

  return null;
}


function parseInterpretation(response: string): { tipo: string; descripcion: string; necesita_ia_web: boolean } | null {
  try {
    const jsonMatch = response.match(/\{[\s\S]*?\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch { /* ignorar */ }
  return null;
}

// ═══════════════════════════════════════════════════════════════
// PROMPTS POR FASE
// ═══════════════════════════════════════════════════════════════

const INTERPRET_PROMPT = `Eres un intérprete MÍNIMO. Solo detecta la intención.

Responde SOLO con JSON:
- Desarrollo: {"tipo":"desarrollo","descripcion":"<qué>","necesita_ia_web":true}
- Pregunta: {"tipo":"pregunta","descripcion":"<qué>","necesita_ia_web":false}
- Comando: {"tipo":"comando","comando":"<cmd>","necesita_ia_web":false}
- Desconocido: {"tipo":"desconocido","descripcion":"<qué>","necesita_ia_web":true}`;

function buildPhase1APrompt(systemInfo: SystemInfo, userObjective: string): string {
  return `Eres un analizador de requisitos previos para cualquier tipo de tarea u objetivo.
Tu función es determinar qué se necesita ANTES de comenzar, verificar disponibilidad
y garantizar compatibilidad.

CONTEXTO:
- Esta es la FASE 1A de cualquier flujo de trabajo
- Tu respuesta será procesada por un agente automatizado, NO por un humano
- El agente ejecuta comandos, instala dependencias, ajusta versiones y valida entornos
- Si el agente tiene dudas, consultará de nuevo y deberás responder en el mismo formato

ENTORNO DEL AGENTE (recolectado automáticamente):
- Sistema Operativo: ${systemInfo.os_nombre} ${systemInfo.os_version}
- Arquitectura: ${systemInfo.arquitectura}
- Shell disponible: ${systemInfo.shell_disponible}
- Gestor de paquetes del sistema: ${systemInfo.gestor_paquetes}
- RAM disponible: ${systemInfo.ram_gb} GB
- Espacio libre en disco: ${systemInfo.espacio_disco_gb} GB
- Conexión a internet: ${systemInfo.conexion_internet}

REGLAS:
1. Analiza el objetivo recibido e identifica TODOS los requisitos previos mínimos e ideales
2. Clasifica los requisitos por tipo: [software, hardware, archivos, credenciales, conocimiento, herramientas_fisicas, otros]
3. Para cada requisito genera el comando de verificación más directo posible
4. TODOS los comandos deben estar escritos en sintaxis válida para ${systemInfo.shell_disponible}. Nunca uses sintaxis de otro shell
5. TODOS los comandos de instalación deben usar ${systemInfo.gestor_paquetes} como gestor del sistema si aplica
6. Para elegir stack tecnológico evalúa la complejidad real del objetivo y elige la tecnología más adecuada
7. Si el objetivo no especifica framework, elige la opción más adecuada según complejidad
8. Evalúa compatibilidad entre dependencias
9. Si el objetivo NO requiere entorno digital, omite comandos y documenta solo requisitos físicos
10. Los valores de version_minima en software con versiones semánticas deben ser strings
11. El campo salida_error en requisitos de hardware debe ser un número entero
12. El campo salida_error en requisitos de software debe ser null nativo JSON cuando no hay patron de error claro
13. Los requisitos de tipo hardware nunca deben tener instalar_automaticamente: true
14. Los requisitos con obligatorio: false deben tener instalar_automaticamente: false
15. Si RAM o disco son insuficientes, indícalo en "alertas_entorno" como crítico
16. Para requisitos de software, comando_verificacion debe devolver un marcador inequívoco en stdout: "OK-<version>", "OUT_OF_RANGE-<version>" o "MISSING"
17. Para software, salida_esperada debe ser "OK" para que el agente decida instalar solo cuando NO aparezca "OK"
18. En PowerShell usa comparación semántica con [version] y evalúa rango compatible: mínimo version_minima y máximo version_recomendada (si existe)
19. Si accion_si_falta es "instalar" o "actualizar", comando_instalacion nunca puede ser null
20. Sé minimalista: solo lo estrictamente necesario
21. NUNCA respondas en texto plano. SIEMPRE responde en JSON válido
22. Si el objetivo es una landing page, sitio informativo o página estática, prioriza HTML + CSS + JavaScript sin frameworks SPA, salvo que el usuario pida explícitamente lo contrario
23. Frameworks SPA (Angular, React, Vue) solo deben elegirse si hay autenticación, dashboard, estado complejo o interacción avanzada
24. Nunca declares como requisito un software que ya se instala automáticamente por otro requisito listado
25. Si una dependencia provee otra (ej: Node.js provee npm), declara solo la dependencia principal
26. Si version_recomendada existe, comando_verificacion de software debe validar rango completo: version_minima <= version <= version_recomendada
27. Los comandos de verificación deben usar opciones CLI estables y documentadas (sin flags experimentales)
28. Los comandos de hardware deben devolver enteros normalizados (Floor o Round)
29. Antes de usar npm/pip/u otros gestores, verifica si existe paquete en ${systemInfo.gestor_paquetes}; si existe, usa ${systemInfo.gestor_paquetes}
30. Para tareas de desarrollo web incluye como mínimo un editor de código
31. NO incluyas navegadores web como requisito, ni comandos de verificación/instalación de navegadores
32. validacion_final debe producir una salida binaria inequívoca: "OK" o "ERROR"
33. Minimiza dependencias y evita sobreingeniería: elige siempre la opción de menor complejidad que cumpla el objetivo

OBJETIVO RECIBIDO:
${userObjective}

RESPONDE ÚNICAMENTE CON EL SIGUIENTE JSON SIN TEXTO ADICIONAL:

{
  "objetivo": "[descripcion breve del objetivo]",
  "fase": "1A",
  "accion": "validar",
  "tipo_tarea": "[digital | fisico | mixto]",
  "entorno_detectado": {
    "os": "${systemInfo.os_nombre} ${systemInfo.os_version}",
    "arquitectura": "${systemInfo.arquitectura}",
    "shell": "${systemInfo.shell_disponible}",
    "gestor_paquetes": "${systemInfo.gestor_paquetes}"
  },
  "decisiones_tomadas": [
    {
      "decision": "[nombre de la decision]",
      "valor": "[lo que se eligio]",
      "justificacion": "[por que es la mejor opcion]",
      "alternativas_descartadas": [{ "nombre": "[opcion]", "razon": "[por que no aplica]" }]
    }
  ],
  "descripcion": "[resumen de qué se necesita validar y por qué]",
  "requisitos": [
    {
      "nombre": "[nombre del requisito]",
      "tipo": "[software | hardware | archivo | credencial | herramienta_fisica | conocimiento | otro]",
      "obligatorio": true,
      "instalar_automaticamente": true,
      "version_minima": "[string | numero | null]",
      "version_recomendada": "[string | numero | null]",
      "comparador": "[>= | > | == | null]",
      "comparador_error": "[< | <= | null]",
      "unidad": "[GB | MB | null]",
      "comando_verificacion": "[comando en ${systemInfo.shell_disponible} o null; para software devuelve OK/OUT_OF_RANGE/MISSING]",
      "salida_esperada": "["OK" para software | numero para hardware | null]",
      "salida_error": "[numero | null]",
      "accion_si_falta": "[instalar | actualizar | configurar | adquirir | liberar | ignorar]",
      "comando_instalacion": "[comando o null si no es instalar/actualizar]"
    }
  ],
  "compatibilidades": [],
  "alertas_entorno": [{ "tipo": "[tipo]", "mensaje": "[descripcion]", "critico": true }],
  "archivos_necesarios": [],
  "credenciales_necesarias": [],
  "validacion_final": { "comando": "[comando | null]", "salida_esperada": "[OK | ERROR | null]", "salida_error": "[error | null]" },
  "progreso": "0%",
  "siguiente_fase": "1B — configuración e instalación de requisitos faltantes"
}`;
}

function buildPhase2Prompt(systemInfo: SystemInfo, userObjective: string, decisiones1A: Decision[], projectPath: string): string {
  const decisionesStr = JSON.stringify(decisiones1A, null, 2);
  
  return `Eres un generador de estructura de proyectos para un agente automatizado.
Tu función es inicializar el proyecto y crear toda la estructura de carpetas
y archivos necesarios para comenzar el desarrollo.

CONTEXTO:
- Esta es la FASE 2 del flujo de trabajo
- El entorno ya fue verificado e instalado en fases anteriores
- Tu respuesta será procesada directamente por el agente, NO por un humano
- El agente ejecutará cada comando y creará cada archivo exactamente como los indiques
- TODOS los comandos deben ser ejecutables en ${systemInfo.shell_disponible}
- Si algo puede hacerse con un comando CLI oficial, siempre prefiere eso sobre crear archivos manualmente

ENTORNO DEL AGENTE:
- Sistema Operativo: ${systemInfo.os_nombre} ${systemInfo.os_version}
- Arquitectura: ${systemInfo.arquitectura}
- Shell disponible: ${systemInfo.shell_disponible}
- Gestor de paquetes del sistema: ${systemInfo.gestor_paquetes}

DECISIONES TOMADAS EN FASE 1A:
${decisionesStr}

OBJETIVO DEL PROYECTO:
${userObjective}

RUTA BASE DEL PROYECTO:
${projectPath}

REGLAS:
1. TODOS los comandos deben estar escritos en sintaxis válida para ${systemInfo.shell_disponible}
2. Si el stack tiene CLI oficial (ng new, npm create vite, vue create, etc.), úsalo como primer comando
3. Si el stack NO tiene CLI (HTML/CSS/JS puro), genera TODOS los comandos de creación de carpetas y archivos
4. Después del scaffold inicial, indica siempre los archivos de configuración adicionales
5. Cada archivo debe incluir su contenido completo listo para escribirse en disco
6. Los comandos de creación deben ser atómicos: un comando por carpeta o archivo
7. Todos los strings con comillas internas deben escaparse con \\"
8. El bloque de validacion debe contener un comando ejecutable que confirme la estructura
9. Si usas generadores CLI y ya existe RUTA BASE DEL PROYECTO, NO uses rutas absolutas en --directory; usa nombre relativo o solo nombre de proyecto
10. NUNCA respondas en texto plano. SIEMPRE responde en JSON válido

RESPONDE ÚNICAMENTE CON EL SIGUIENTE JSON SIN TEXTO ADICIONAL:

{
  "fase": "2",
  "accion": "scaffolding",
  "tipo_scaffold": "[cli | manual]",
  "descripcion": "[resumen de qué se va a crear y por qué]",
  "nombre_proyecto": "[nombre en kebab-case]",
  "ruta_proyecto": "${projectPath}",
  "estructura_esperada": { "[carpeta]": { "[subcarpeta]": { "[archivo]": "[descripcion]" } } },
  "pasos": [
    {
      "orden": 1,
      "descripcion": "[qué hace este paso]",
      "tipo": "[comando | archivo]",
      "comando": "[comando ejecutable en ${systemInfo.shell_disponible} | null]",
      "archivo": { "ruta": "[ruta relativa | null]", "operacion": "[crear | modificar]", "contenido": "[contenido completo | null]" },
      "continuar_si_falla": false
    }
  ],
  "validacion": {
    "comando": "[comando que confirma estructura creada]",
    "salida_esperada": "[patrón que confirma éxito]",
    "salida_error": "[patrón que indica fallo]",
    "comparador": "[contains | equals | startsWith]"
  },
  "progreso": "40%",
  "siguiente_fase": "3 — Desarrollo por bloques"
}`;
}

function buildPhase3Prompt(
  systemInfo: SystemInfo, 
  userObjective: string, 
  decisiones1A: Decision[],
  estructura2: Record<string, unknown>,
  projectPath: string,
  bloqueActual: string | null,
  bloquesCompletados: string[]
): string {
  const decisionesStr = JSON.stringify(decisiones1A, null, 2);
  const estructuraStr = JSON.stringify(estructura2, null, 2);
  
  return `Eres un generador de código para un agente automatizado.
Tu función es desarrollar el proyecto por bloques funcionales e independientes,
generando código listo para escribirse en disco y ejecutarse sin modificaciones.

CONTEXTO:
- Esta es la FASE 3 del flujo de trabajo
- La estructura del proyecto ya fue creada en FASE 2
- Tu respuesta será procesada directamente por el agente, NO por un humano
- El agente escribirá cada archivo exactamente como lo indiques
- Cada bloque debe ser funcional e independiente antes de pasar al siguiente
- Si un bloque depende de otro, indícalo explícitamente en "dependencias_bloque"
- TODOS los comandos deben ser ejecutables en ${systemInfo.shell_disponible}

ENTORNO DEL AGENTE:
- Sistema Operativo: ${systemInfo.os_nombre} ${systemInfo.os_version}
- Arquitectura: ${systemInfo.arquitectura}
- Shell disponible: ${systemInfo.shell_disponible}
- Gestor de paquetes: ${systemInfo.gestor_paquetes}

DECISIONES TOMADAS EN FASE 1A:
${decisionesStr}

ESTRUCTURA CREADA EN FASE 2 (solo rutas visibles, sin contenido):
${estructuraStr}

OBJETIVO DEL PROYECTO:
${userObjective}

RUTA DEL PROYECTO:
${projectPath}

BLOQUE A DESARROLLAR:
${bloqueActual || 'Primer bloque - decidir bloques y comenzar'}

BLOQUES YA COMPLETADOS:
${bloquesCompletados.length > 0 ? bloquesCompletados.join(', ') : 'Ninguno'}

REGLAS:
1. TODOS los comandos deben estar escritos en sintaxis válida para ${systemInfo.shell_disponible}
2. El código generado debe ser completo y funcional, nunca parcial
3. Cada archivo debe incluir su contenido completo
4. Si el bloque requiere dependencias adicionales, inclúyelas en "dependencias_adicionales"
5. El comando de previsualización debe permitir verificar que el bloque funciona
6. La validación debe ser un comando ejecutable con salida esperada concreta
7. Si el stack tiene servidor de desarrollo, el comando debe iniciarlo
8. Todos los strings con comillas internas deben escaparse con \" para garantizar JSON válido
9. El campo "bloques_pendientes" debe listar todos los bloques que faltan después del actual
10. No incluyas campos ni llaves fuera del esquema JSON definido
11. NUNCA respondas en texto plano. SIEMPRE responde en JSON válido sin texto adicional
12. En campos "contenido", "comando", "instruccion" y "descripcion", escapa TODAS las comillas internas con \" (ejemplo: \"texto\")
13. No uses markdown (sin enlaces tipo [texto](url), sin bloques fenced), solo strings JSON puros
14. Si incluyes comandos PowerShell con rutas, usa comillas escapadas válidas dentro del JSON
15. No encadenes múltiples objetos JSON en una sola respuesta; devuelve exactamente UN objeto raíz

RESPONDE ÚNICAMENTE CON EL SIGUIENTE JSON SIN TEXTO ADICIONAL:

{
  "fase": "3",
  "accion": "desarrollo_bloque",
  "bloque_actual": { "id": "[id unico]", "nombre": "[nombre]", "descripcion": "[qué incluye]", "dependencias_bloque": ["[ids requeridos]"] },
  "dependencias_adicionales": [{ "nombre": "[paquete]", "comando_instalacion": "[comando]", "razon": "[por qué]" }],
  "archivos": [{ "ruta": "[ruta relativa]", "operacion": "[crear | modificar]", "descripcion": "[para qué sirve]", "contenido": "[contenido completo]" }],
  "comandos_post_escritura": [{ "orden": 1, "descripcion": "[qué hace]", "comando": "[comando ejecutable]", "continuar_si_falla": false }],
  "previsualizacion": { "comando": "[comando para iniciar servidor/abrir]", "url": "[url | null]", "instruccion": "[qué verificar visualmente]" },
  "validacion": { "comando": "[comando que confirma éxito]", "salida_esperada": "[patrón]", "salida_error": "[patrón error]", "comparador": "[contains | equals | startsWith | greaterThan]" },
  "bloques_pendientes": [{ "id": "[id]", "nombre": "[nombre]", "depende_de": ["[ids]"] }],
  "progreso": "[porcentaje]",
  "siguiente_bloque": "[id siguiente | null si último]",
  "siguiente_fase": "[null si hay más bloques | 4 — Validación y pruebas si último]"
}`;
}

function buildErrorPrompt(systemInfo: SystemInfo, errorReport: ErrorReport): string {
  const phase1Requirements = sessionState.phase1AResult?.requisitos || [];
  const requirementChecks = Array.isArray(errorReport.entorno_adicional?.requirement_checks)
    ? errorReport.entorno_adicional.requirement_checks
    : [];

  const requirementSummary = phase1Requirements.length > 0
    ? phase1Requirements.map((req, idx) => {
      const check = requirementChecks.find((entry: Record<string, unknown>) =>
        String(entry.nombre || '').toLowerCase() === String(req.nombre || '').toLowerCase()
      ) as Record<string, unknown> | undefined;

      const detectedState = check?.status ? String(check.status) : 'UNKNOWN';
      const detectedValue = check?.output ? String(check.output) : 'Sin verificación ejecutada';

      return `${idx + 1}. ${req.nombre}
   - versión mínima: ${req.version_minima ?? 'n/a'}
   - versión recomendada: ${req.version_recomendada ?? 'n/a'}
   - expected marker: ${req.salida_esperada ?? 'OK'}
   - estado detectado: ${detectedState}
   - salida detectada: ${detectedValue}`;
    }).join('\n')
    : 'No hay requisitos de FASE 1A registrados en sesión.';

  return `Eres un solucionador de errores para un agente automatizado.
Tu función es analizar el error reportado y devolver una solución ejecutable.

CONTEXTO:
- El agente está ejecutando un flujo de trabajo por fases y pasos
- Cada paso tiene una validación y algo falló
- Tu respuesta será procesada directamente por el agente, NO por un humano
- El agente ejecutará los comandos y archivos que devuelvas exactamente como los escribas

ENTORNO DEL AGENTE:
- Sistema Operativo: ${systemInfo.os_nombre} ${systemInfo.os_version}
- Arquitectura: ${systemInfo.arquitectura}
- Shell disponible: ${systemInfo.shell_disponible}
- Gestor de paquetes del sistema: ${systemInfo.gestor_paquetes}

ERROR REPORTADO:
${JSON.stringify(errorReport, null, 2)}

REQUISITOS VALIDADOS (FASE 1A):
${requirementSummary}

INSTRUCCIONES DE CORRECCIÓN:
- Usa los requisitos validados para escoger comandos compatibles con versiones reales.
- Si detectas stack Angular standalone, evita asumir NgModule tradicional y usa flags como --standalone o --skip-import cuando aplique.
- Prioriza soluciones idempotentes y seguras para reintento automático.

RESPONDE ÚNICAMENTE CON EL SIGUIENTE JSON SIN TEXTO ADICIONAL:

{
  "accion": "corregir",
  "fase": "[fase del error]",
  "paso": "[paso específico]",
  "tipo_error": "[instalacion | configuracion | codigo | comando | compatibilidad | permisos | red | otro]",
  "causa_raiz": "[explicación técnica breve]",
  "archivos": [{ "ruta": "[ruta]", "operacion": "[crear | modificar | eliminar]", "contenido": "[contenido o null]" }],
  "comandos": [{ "descripcion": "[qué hace]", "comando": "[comando en ${systemInfo.shell_disponible}]", "continuar_si_falla": false }],
  "validacion": { "comando": "[comando verificación]", "salida_esperada": "[patrón]", "salida_error": "[patrón error]", "comparador": "[contains | equals | startsWith]" },
  "informacion_adicional_requerida": null,
  "rollback": { "necesario": false, "comandos": [] }
}`;
}

// ═══════════════════════════════════════════════════════════════
// ROUTE HANDLER
// ═══════════════════════════════════════════════════════════════

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { 
      message, 
      groqApiKey,
      aiProvider,
      action = 'process',
      steps: providedSteps,
      errorReport,
      bloqueActual,
      projectFolder,
    } = body;

    if (projectFolder && typeof projectFolder === 'string') {
      const normalizedProjectFolder = projectFolder.trim();
      if (normalizedProjectFolder) {
        try {
          const stats = await fs.stat(normalizedProjectFolder);
          if (stats.isDirectory()) {
            sessionState.currentWorkDir = normalizedProjectFolder;
            console.log(`[Process] Carpeta base del proyecto: ${sessionState.currentWorkDir}`);
          }
        } catch {
          console.log(`[Process] ⚠️ projectFolder inválido: ${normalizedProjectFolder}`);
        }
      }
    }

    // Detectar entorno del servidor
    const systemInfo = await detectServerEnvironment();
    console.log('[SystemInfo]', systemInfo);

    // ════════════════════════════════════════════════════════════
    // ACCIÓN: REPORTAR ERROR
    // ════════════════════════════════════════════════════════════
    if (action === 'report_error' && errorReport) {
      const errorPrompt = buildErrorPrompt(systemInfo, errorReport);
      
      // Enviar a IA externa vía navegador
      let browserModule;
      try {
        browserModule = await import('../../../lib/browser');
      } catch {
        return NextResponse.json({ success: false, error: 'Playwright no disponible' });
      }
      
      const { sendPrompt, getBrowserStatus, openSite } = browserModule;
      const currentStatus = getBrowserStatus();
      const selectedProvider = aiProvider || 'chatgpt';
      
      if (currentStatus.currentSite !== selectedProvider) {
        await openSite(selectedProvider);
      }
      
      const promptResult = await sendPrompt(errorPrompt);
      
      if (!promptResult.success) {
        return NextResponse.json({ success: false, error: promptResult.error });
      }
      
      const solution = parseJSONResponse(promptResult.response);
      
      return NextResponse.json({ success: true, solution, rawResponse: promptResult.response });
    }

    // ════════════════════════════════════════════════════════════
    // ACCIÓN: EJECUTAR PASOS (desde el frontend) - CON RETRY LOGIC
    // ════════════════════════════════════════════════════════════
    if (action === 'execute' && providedSteps) {
      const results = [];
      const maxRetries = 3;

      // Si el frontend envía workDir, sincronizarlo para esta ejecución.
      if (body.workDir && typeof body.workDir === 'string') {
        try {
          const normalizedWorkDir = String(body.workDir).trim();
          const stats = await fs.stat(normalizedWorkDir);

          // Evitar que en Windows se use "/" proveniente de process.cwd() del frontend (browser).
          const looksLikeUnixRootInWindows = isWindows && normalizedWorkDir === '/';
          if (stats.isDirectory() && !looksLikeUnixRootInWindows) {
            sessionState.currentWorkDir = normalizedWorkDir;
          } else {
            console.log(`[Execute] ⚠️ workDir ignorado (${normalizedWorkDir}). Se mantiene: ${sessionState.currentWorkDir}`);
          }
        } catch {
          console.log(`[Execute] ⚠️ workDir recibido no existe: ${body.workDir}. Se mantiene: ${sessionState.currentWorkDir}`);
        }
      }
      
      // Recuperar intentos previos del body o usar objeto vacío
      const previousAttempts: Record<number, number> = body.retryAttempts || {};
      
      for (let i = 0; i < providedSteps.length; i++) {
        const step = providedSteps[i];
        const result = { 
          step: i + 1, 
          success: true, 
          outputs: [] as string[], 
          files: [] as string[],
          retryCount: 0,
          error: null as ErrorReport | null,
        };
        
        // Inicializar contador de reintentos para este paso
        const stepAttempts = previousAttempts[i] || 0;
        result.retryCount = stepAttempts;
        
        // Ejecutar comandos EN ORDEN
        if (step.comandos && step.comandos.length > 0) {
          for (const cmd of step.comandos) {
            console.log(`[Execute] Paso ${i + 1}, intento ${stepAttempts + 1}, comando: ${cmd}`);
            const cmdResult = await executeCommand(cmd, systemInfo);
            result.outputs.push(`$ ${cmd}\n${cmdResult.output}`);
            
            if (!cmdResult.success) {
              const isVerificationStep = step.accion === 'verificar';
              const expectedRaw = typeof step.validacion === 'string'
                ? step.validacion.replace(/^Debe mostrar:\s*/i, '').trim()
                : '';
              const expected = expectedRaw || 'OK';
              const outputUpper = stripAnsi(String(cmdResult.output || '')).toUpperCase();
              const hasKnownMarker = outputUpper.includes('OK-') || outputUpper.includes('OUT_OF_RANGE-') || outputUpper.includes('MISSING');

              // Para verificaciones, no depender solo del exit code.
              // Si hay un marcador conocido, devolvemos éxito técnico del paso para evitar loops,
              // y dejamos que la capa de validación decida si cumple (OK) o requiere instalar (MISSING/OUT_OF_RANGE).
              if (isVerificationStep && hasKnownMarker) {
                const expectationMet = outputUpper.includes(expected.toUpperCase());
                result.success = true;
                result.outputs.push(`[verification] expectationMet=${expectationMet}; expected=${expected}`);
                continue;
              }

              if (isVerificationStep && /SYSTEM\.VERSION|NO SE PUEDE CONVERTIR EL VALOR|VERSION STRING|VERSION PART/i.test(outputUpper)) {
                // Algunos comandos de verificación devuelven cadenas no parseables de versión.
                // No debemos entrar en retry infinito: normalizamos a marcador MISSING/OUT_OF_RANGE para que
                // la fase de instalación decida qué hacer.
                const synthesizedMarker = outputUpper.includes('OUT_OF_RANGE') ? 'OUT_OF_RANGE-INVALID_VERSION' : 'MISSING';
                result.success = true;
                result.outputs.push(`[verification] normalized_marker=${synthesizedMarker}; reason=version_parse_error`);
                continue;
              }

              if (isVerificationStep && /COMMANDNOTFOUNDEXCEPTION|NO SE RECONOCE COMO NOMBRE DE UN CMDLET|IS NOT RECOGNIZED|OBJECTNOTFOUND|EL T[ÉE]RMINO/i.test(outputUpper)) {
                // Si el ejecutable no existe, tratar como "MISSING" para pasar a instalación,
                // en lugar de consumir reintentos con el mismo error.
                result.success = true;
                result.outputs.push('[verification] normalized_marker=MISSING; reason=command_not_found');
                continue;
              }

              result.success = false;
              
              // Crear ErrorReport
              const errorReport: ErrorReport = {
                fase: step.fase || `Paso ${i + 1}`,
                paso: step.descripcion || step.paso || 'Ejecución',
                accion_ejecutada: cmd,
                tipo_error: 'comando',
                mensaje_error: cmdResult.output,
                codigo_salida: cmdResult.exitCode,
                archivo_afectado: null,
                linea_error: null,
                contexto_archivo: null,
                estructura_proyecto: { workDir: sessionState.currentWorkDir },
                archivos_afectados: [],
                intentos_previos: [{ 
                  comando_intentado: cmd, 
                  resultado: `Exit code: ${cmdResult.exitCode}` 
                }],
                entorno_adicional: {
                  version_runtime: systemInfo.shell_disponible,
                  version_gestor: systemInfo.gestor_paquetes,
                },
              };
              
              result.error = errorReport;
              
              // Si hemos alcanzado el máximo de reintentos, devolver error especial
              if (stepAttempts >= maxRetries - 1) {
                return NextResponse.json({
                  success: false,
                  maxRetriesReached: true,
                  stepIndex: i,
                  result,
                  errorReport,
                  retryAttempts: { ...previousAttempts, [i]: stepAttempts + 1 },
                  message: `Se alcanzó el máximo de ${maxRetries} intentos para este paso`,
                  userActionRequired: true,
                  options: ['provide_info', 'skip_step', 'abort'],
                });
              }
              
              // Devolver con información de retry
              return NextResponse.json({
                success: false,
                needsRetry: true,
                stepIndex: i,
                result,
                errorReport,
                retryAttempts: { ...previousAttempts, [i]: stepAttempts + 1 },
                currentAttempt: stepAttempts + 1,
                maxAttempts: maxRetries,
                message: `Intento ${stepAttempts + 1} de ${maxRetries} falló`,
              });
            }
          }
        }
        
        // Si falló un comando, no crear archivos
        if (!result.success) {
          results.push(result);
          continue;
        }
        
        // Crear archivos
        if (step.archivos && step.archivos.length > 0) {
          for (const archivo of step.archivos) {
            const fileResult = await createFile(archivo.nombre || archivo.ruta, archivo.contenido || '');
            result.files.push(archivo.nombre || archivo.ruta);
            result.outputs.push(fileResult.message);
            if (!fileResult.success) {
              result.success = false;
              
              // Crear ErrorReport para archivo
              result.error = {
                fase: step.fase || `Paso ${i + 1}`,
                paso: step.descripcion || 'Creación de archivo',
                accion_ejecutada: `Crear archivo: ${archivo.nombre || archivo.ruta}`,
                tipo_error: 'codigo',
                mensaje_error: fileResult.message,
                codigo_salida: null,
                archivo_afectado: archivo.nombre || archivo.ruta || null,
                linea_error: null,
                contexto_archivo: null,
                estructura_proyecto: { workDir: sessionState.currentWorkDir },
                archivos_afectados: [archivo.nombre || archivo.ruta].filter(Boolean) as string[],
                intentos_previos: [],
                entorno_adicional: {
                  version_runtime: null,
                  version_gestor: null,
                },
              };
            }
          }
        }
        
        results.push(result);
      }
      
      return NextResponse.json({
        success: true,
        results,
        workDir: sessionState.currentWorkDir,
        systemInfo,
      });
    }

    // ════════════════════════════════════════════════════════════
    // ACCIÓN: FASE 1A - ANÁLISIS DE REQUISITOS
    // ════════════════════════════════════════════════════════════
    if (action === 'phase_1a') {
      if (!message) {
        return NextResponse.json({ error: 'Se requiere un mensaje' }, { status: 400 });
      }
      
      if (!groqApiKey) {
        return NextResponse.json({
          success: false,
          error: 'Se requiere API Key de Groq',
        });
      }

      // Interpretar con Groq primero
      const interpretResult = await tryGroqProviders(groqApiKey, INTERPRET_PROMPT, message, 150);
      
      if (!interpretResult.success) {
        return NextResponse.json({ success: false, error: interpretResult.error, systemInfo });
      }
      
      const interpretation = parseInterpretation(interpretResult.content || '');
      if (!interpretation) {
        return NextResponse.json({ success: false, error: 'No se pudo interpretar', systemInfo });
      }

      // Si no necesita desarrollo
      if (!interpretation.necesita_ia_web) {
        if (interpretation.tipo === 'comando') {
          return NextResponse.json({
            success: true,
            fase: 'directo',
            interpretation,
            steps: [{
              id: 'cmd-1', fase: 'directo', paso: 'Ejecutar comando',
              accion: 'ejecutar', descripcion: interpretation.comando || '',
              status: 'pending', comandos: [interpretation.comando]
            }],
            systemInfo,
          });
        }
        return NextResponse.json({ success: true, interpretation, systemInfo });
      }

      // Abrir navegador con IA externa
      let browserModule;
      try {
        browserModule = await import('../../../lib/browser');
      } catch {
        return NextResponse.json({ success: false, error: 'Playwright no disponible', systemInfo });
      }

      const { openSite, sendPrompt, getBrowserStatus, checkPlaywrightAvailable } = browserModule;
      
      const availability = await checkPlaywrightAvailable();
      if (!availability.available) {
        return NextResponse.json({ success: false, error: availability.message, systemInfo });
      }

      const currentStatus = getBrowserStatus();
      const selectedProvider = aiProvider || 'chatgpt';
      
      if (currentStatus.currentSite !== selectedProvider) {
        const siteResult = await openSite(selectedProvider);
        if (!siteResult.success) {
          return NextResponse.json({ success: false, error: siteResult.message, systemInfo });
        }
        if (siteResult.needsLogin) {
          return NextResponse.json({
            success: false, needsLogin: true,
            message: `Necesitas login en ${selectedProvider}`,
            currentUrl: siteResult.url, systemInfo,
          });
        }
      }

      // Enviar prompt FASE 1A
      console.log('[FASE 1A] Enviando prompt de análisis...');
      const phase1APrompt = buildPhase1APrompt(systemInfo, message);
      const promptResult = await sendPrompt(phase1APrompt);
      
      if (!promptResult.success) {
        return NextResponse.json({ success: false, error: promptResult.error, systemInfo });
      }

      const analysis = parseJSONResponse<Phase1AResponse>(promptResult.response);
      if (!analysis) {
        return NextResponse.json({
          success: false, error: 'No se pudo parsear análisis',
          rawResponse: promptResult.response.substring(0, 2000), systemInfo,
        });
      }

      // Guardar resultado para siguientes fases
      sessionState.phase1AResult = analysis;
      
      // Construir pasos de ejecución para FASE 1B
      const executionSteps: ExecutionStep[] = [];
      
      // Paso de análisis completado
      executionSteps.push({
        id: 'fase1a-complete',
        fase: '1A', paso: 'Análisis completado',
        accion: 'validar', descripcion: analysis.descripcion,
        status: 'success', progreso: '0%',
      });
      
      // Pasos de verificación e instalación para FASE 1B
      if (analysis.requisitos && analysis.requisitos.length > 0) {
        analysis.requisitos.forEach((req, idx) => {
          // Verificación
          if (req.comando_verificacion) {
            executionSteps.push({
              id: `1b-verify-${idx}`, fase: '1B',
              paso: `Verificar: ${req.nombre}`,
              accion: 'verificar',
              descripcion: `Verificar si ${req.nombre} está instalado`,
              status: 'pending',
              comandos: [req.comando_verificacion],
              validacion: `Debe mostrar: ${req.salida_esperada || 'versión'}`,
              requisito_origen: req.nombre,
            });
          }
          
          // Instalación si aplica
          if ((req.accion_si_falta === 'instalar' || req.accion_si_falta === 'actualizar') && req.comando_instalacion) {
            executionSteps.push({
              id: `1b-install-${idx}`, fase: '1B',
              paso: `Instalar: ${req.nombre}`,
              accion: 'instalar',
              descripcion: `Instalar ${req.nombre}${req.version_minima ? ` v${req.version_minima}` : ''}`,
              status: 'pending',
              comandos: [req.comando_instalacion],
              validacion: `Instalar solo si verificación previa NO cumple: ${req.salida_esperada || 'OK'}`,
              requisito_origen: req.nombre,
            });
          }
        });
      }

      return NextResponse.json({
        success: true,
        fase: '1A',
        analysis,
        executionSteps,
        systemInfo,
        rawResponse: promptResult.response,
      });
    }

    // ════════════════════════════════════════════════════════════
    // ACCIÓN: FASE 2 - SCAFFOLDING
    // ════════════════════════════════════════════════════════════
    if (action === 'phase_2') {
      if (!sessionState.phase1AResult) {
        return NextResponse.json({ success: false, error: 'FASE 1A no completada' });
      }

      // Determinar ruta del proyecto
      const projectName = message?.toLowerCase().replace(/[^a-z0-9]/g, '-').substring(0, 30) || `proyecto-${Date.now()}`;
      const projectPath = path.join(sessionState.currentWorkDir, projectName);
      sessionState.projectPath = projectPath;
      await fs.mkdir(projectPath, { recursive: true });

      let browserModule;
      try {
        browserModule = await import('../../../lib/browser');
      } catch {
        return NextResponse.json({ success: false, error: 'Playwright no disponible' });
      }

      const { sendPrompt } = browserModule;
      
      console.log('[FASE 2] Enviando prompt de scaffolding...');
      const phase2Prompt = buildPhase2Prompt(
        systemInfo, 
        message || '', 
        sessionState.phase1AResult.decisiones_tomadas,
        projectPath
      );
      
      const promptResult = await sendPrompt(phase2Prompt);
      
      if (!promptResult.success) {
        return NextResponse.json({ success: false, error: promptResult.error, systemInfo });
      }

      const phase2Result = parseJSONResponse<Phase2Response>(promptResult.response);
      if (!phase2Result) {
        return NextResponse.json({
          success: false, error: 'No se pudo parsear scaffolding',
          rawResponse: promptResult.response.substring(0, 2000), systemInfo,
        });
      }

      sessionState.phase2Result = phase2Result;
      sessionState.currentWorkDir = projectPath;

      // Construir pasos de ejecución
      const executionSteps: ExecutionStep[] = [];
      
      // Agregar paso de FASE 1A
      executionSteps.push({
        id: 'fase1a-complete', fase: '1A', paso: 'Análisis completado',
        accion: 'validar', descripcion: 'Requisitos analizados',
        status: 'success', progreso: '20%',
      });
      
      // Agregar paso de FASE 1B
      executionSteps.push({
        id: 'fase1b-complete', fase: '1B', paso: 'Instalación completada',
        accion: 'instalar', descripcion: 'Dependencias instaladas',
        status: 'success', progreso: '30%',
      });
      
      // Agregar pasos de FASE 2
      phase2Result.pasos.forEach((paso, idx) => {
        if (paso.tipo === 'comando' && paso.comando) {
          executionSteps.push({
            id: `fase2-cmd-${idx}`, fase: '2',
            paso: paso.descripcion,
            accion: 'scaffolding',
            descripcion: paso.descripcion,
            status: 'pending',
            comandos: [paso.comando],
            tipo: 'comando',
          });
        } else if (paso.tipo === 'archivo' && paso.archivo) {
          executionSteps.push({
            id: `fase2-file-${idx}`, fase: '2',
            paso: paso.descripcion,
            accion: 'crear',
            descripcion: paso.descripcion,
            status: 'pending',
            archivos: [{ nombre: paso.archivo.ruta, contenido: paso.archivo.contenido || '' }],
            tipo: 'archivo',
          });
        }
      });

      return NextResponse.json({
        success: true,
        fase: '2',
        phase2Result,
        executionSteps,
        projectPath,
        workDir: sessionState.currentWorkDir,
        systemInfo,
        rawResponse: promptResult.response,
      });
    }

    // ════════════════════════════════════════════════════════════
    // ACCIÓN: FASE 3 - DESARROLLO POR BLOQUES
    // ════════════════════════════════════════════════════════════
    if (action === 'phase_3') {
      if (!sessionState.phase1AResult || !sessionState.phase2Result) {
        return NextResponse.json({ success: false, error: 'FASE 1A o FASE 2 no completadas' });
      }

      let browserModule;
      try {
        browserModule = await import('../../../lib/browser');
      } catch {
        return NextResponse.json({ success: false, error: 'Playwright no disponible' });
      }

      const { sendPrompt } = browserModule;
      
      const resolvedProjectRoot = await resolveProjectRootPath();
      sessionState.currentWorkDir = resolvedProjectRoot;
      sessionState.projectPath = resolvedProjectRoot;
      const realStructureSnapshot = await buildProjectStructureSnapshot(resolvedProjectRoot);

      console.log('[FASE 3] Enviando prompt de desarrollo...');
      const phase3Prompt = buildPhase3Prompt(
        systemInfo, 
        message || '', 
        sessionState.phase1AResult.decisiones_tomadas,
        realStructureSnapshot,
        resolvedProjectRoot,
        bloqueActual || null,
        sessionState.completedBlocks
      );
      
      const promptResult = await sendPrompt(phase3Prompt);
      
      if (!promptResult.success) {
        return NextResponse.json({ success: false, error: promptResult.error, systemInfo });
      }

      const phase3Result = parseJSONResponse<Phase3Response>(promptResult.response);
      if (!phase3Result) {
        return NextResponse.json({
          success: false, error: 'No se pudo parsear desarrollo',
          rawResponse: promptResult.response.substring(0, 2000), systemInfo,
        });
      }

      // Actualizar estado de bloques
      if (phase3Result.bloque_actual) {
        sessionState.currentBlock = phase3Result.bloque_actual.id;
      }
      sessionState.pendingBlocks = phase3Result.bloques_pendientes.map(b => b.id);

      // Construir pasos de ejecución
      const executionSteps: ExecutionStep[] = [];
      
      // Agregar archivos a crear
      phase3Result.archivos.forEach((archivo, idx) => {
        executionSteps.push({
          id: `fase3-file-${idx}`, fase: '3',
          paso: `Crear: ${archivo.ruta}`,
          accion: 'crear',
          descripcion: archivo.descripcion,
          status: 'pending',
          archivos: [{ nombre: archivo.ruta, contenido: archivo.contenido }],
        });
      });
      
      // Agregar comandos post-escritura
      phase3Result.comandos_post_escritura?.forEach((cmd, idx) => {
        executionSteps.push({
          id: `fase3-cmd-${idx}`, fase: '3',
          paso: cmd.descripcion,
          accion: 'ejecutar',
          descripcion: cmd.descripcion,
          status: 'pending',
          comandos: [cmd.comando],
        });
      });

      return NextResponse.json({
        success: true,
        fase: '3',
        phase3Result,
        executionSteps,
        completedBlocks: sessionState.completedBlocks,
        pendingBlocks: sessionState.pendingBlocks,
        progreso: phase3Result.progreso,
        siguienteBloque: phase3Result.siguiente_bloque,
        siguienteFase: phase3Result.siguiente_fase,
        workDir: sessionState.currentWorkDir,
        systemInfo,
        rawResponse: promptResult.response,
      });
    }

    // ════════════════════════════════════════════════════════════
    // ACCIÓN: MARCAR BLOQUE COMPLETADO
    // ════════════════════════════════════════════════════════════
    if (action === 'complete_block') {
      if (sessionState.currentBlock) {
        sessionState.completedBlocks.push(sessionState.currentBlock);
        sessionState.currentBlock = null;
      }
      
      return NextResponse.json({
        success: true,
        completedBlocks: sessionState.completedBlocks,
        pendingBlocks: sessionState.pendingBlocks,
      });
    }

    // ════════════════════════════════════════════════════════════
    // ACCIÓN: PROCESO COMPLETO AUTOMÁTICO
    // ════════════════════════════════════════════════════════════
    if (!message) {
      return NextResponse.json({ error: 'Se requiere un mensaje' }, { status: 400 });
    }

    if (!groqApiKey) {
      return NextResponse.json({
        success: false,
        error: 'Se requiere API Key de Groq',
        instructions: ['Obtén tu key en: https://console.groq.com'],
      });
    }

    // Interpretar con Groq
    const interpretResult = await tryGroqProviders(groqApiKey, INTERPRET_PROMPT, message, 150);
    
    if (!interpretResult.success) {
      return NextResponse.json({ success: false, error: interpretResult.error, systemInfo });
    }
    
    const interpretation = parseInterpretation(interpretResult.content || '');
    if (!interpretation) {
      return NextResponse.json({ success: false, error: 'No se pudo interpretar', systemInfo });
    }

    if (!interpretation.necesita_ia_web) {
      return NextResponse.json({ success: true, interpretation, systemInfo });
    }

    // Abrir navegador
    let browserModule;
    try {
      browserModule = await import('../../../lib/browser');
    } catch {
      return NextResponse.json({ success: false, error: 'Playwright no disponible', systemInfo });
    }

    const { openSite, sendPrompt, getBrowserStatus, checkPlaywrightAvailable } = browserModule;
    
    const availability = await checkPlaywrightAvailable();
    if (!availability.available) {
      return NextResponse.json({ success: false, error: availability.message, systemInfo });
    }

    const selectedProvider = aiProvider || 'chatgpt';
    const currentStatus = getBrowserStatus();
    
    if (currentStatus.currentSite !== selectedProvider) {
      const siteResult = await openSite(selectedProvider);
      if (!siteResult.success) {
        return NextResponse.json({ success: false, error: siteResult.message, systemInfo });
      }
      if (siteResult.needsLogin) {
        return NextResponse.json({
          success: false, needsLogin: true,
          message: `Necesitas login en ${selectedProvider}`,
          currentUrl: siteResult.url, systemInfo,
        });
      }
    }

    // FASE 1A
    console.log('[Auto] FASE 1A...');
    const phase1APrompt = buildPhase1APrompt(systemInfo, message);
    let promptResult = await sendPrompt(phase1APrompt);
    
    if (!promptResult.success) {
      return NextResponse.json({ success: false, error: promptResult.error, systemInfo });
    }

    const analysis = parseJSONResponse<Phase1AResponse>(promptResult.response);
    if (!analysis) {
      return NextResponse.json({
        success: false, error: 'No se pudo parsear análisis FASE 1A',
        rawResponse: promptResult.response.substring(0, 2000), systemInfo,
      });
    }

    sessionState.phase1AResult = analysis;

    // Construir todos los pasos
    const allSteps: ExecutionStep[] = [];
    
    // FASE 1A
    allSteps.push({
      id: 'fase1a', fase: '1A', paso: 'Análisis de requisitos',
      accion: 'validar', descripcion: analysis.descripcion,
      status: 'success', progreso: '0%',
    });
    
    // FASE 1B
    if (analysis.requisitos) {
      analysis.requisitos.forEach((req, idx) => {
        if (req.comando_verificacion) {
          allSteps.push({
            id: `1b-verify-${idx}`, fase: '1B',
            paso: `Verificar: ${req.nombre}`,
            accion: 'verificar',
            descripcion: `Verificar ${req.nombre}`,
            status: 'pending',
            comandos: [req.comando_verificacion],
            validacion: `Debe mostrar: ${req.salida_esperada || 'OK'}`,
            requisito_origen: req.nombre,
          });
        }
        if ((req.accion_si_falta === 'instalar' || req.accion_si_falta === 'actualizar') && req.comando_instalacion) {
          allSteps.push({
            id: `1b-install-${idx}`, fase: '1B',
            paso: `Instalar: ${req.nombre}`,
            accion: 'instalar',
            descripcion: `Instalar ${req.nombre}`,
            status: 'pending',
            comandos: [req.comando_instalacion],
            validacion: `Instalar solo si verificación previa NO cumple: ${req.salida_esperada || 'OK'}`,
            requisito_origen: req.nombre,
          });
        }
      });
    }
    
    // FASE 2
    const projectName = message.toLowerCase().replace(/[^a-z0-9]/g, '-').substring(0, 30);
    const projectPath = path.join(sessionState.currentWorkDir, projectName);
    sessionState.projectPath = projectPath;
    await fs.mkdir(projectPath, { recursive: true });
    
    const phase2Prompt = buildPhase2Prompt(systemInfo, message, analysis.decisiones_tomadas, projectPath);
    promptResult = await sendPrompt(phase2Prompt);
    
    if (promptResult.success) {
      const phase2Result = parseJSONResponse<Phase2Response>(promptResult.response);
      if (phase2Result) {
        sessionState.phase2Result = phase2Result;
        sessionState.currentWorkDir = projectPath;
        
        phase2Result.pasos.forEach((paso, idx) => {
          if (paso.tipo === 'comando' && paso.comando) {
            allSteps.push({
              id: `fase2-cmd-${idx}`, fase: '2',
              paso: paso.descripcion,
              accion: 'scaffolding', descripcion: paso.descripcion,
              status: 'pending', comandos: [paso.comando],
            });
          } else if (paso.tipo === 'archivo' && paso.archivo) {
            allSteps.push({
              id: `fase2-file-${idx}`, fase: '2',
              paso: paso.descripcion,
              accion: 'crear', descripcion: paso.descripcion,
              status: 'pending',
              archivos: [{ nombre: paso.archivo.ruta, contenido: paso.archivo.contenido || '' }],
            });
          }
        });
      }
    }

    return NextResponse.json({
      success: true,
      fase: 'completo',
      steps: allSteps,
      analysis,
      interpretation,
      projectPath: sessionState.projectPath,
      workDir: sessionState.currentWorkDir,
      systemInfo,
    });

  } catch (error) {
    console.error('Process API error:', error);
    return NextResponse.json({ success: false, error: String(error) });
  }
}

export async function GET() {
  return NextResponse.json({
    message: 'Sonny Agent Process API v2.1',
    phases: ['1A - Análisis', '1B - Instalación', '2 - Scaffolding', '3 - Desarrollo', '4 - Validación'],
    actions: ['process', 'phase_1a', 'phase_2', 'phase_3', 'execute', 'report_error', 'complete_block'],
  });
}
