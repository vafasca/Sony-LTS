import { NextRequest, NextResponse } from 'next/server';

/**
 * Error Report Format for Sonny Agent
 * 
 * This endpoint handles error reports from the agent execution
 * and formats them for sending to external AI services.
 */

interface ErrorReport {
  accion: 'error_reportado';
  descripcion: string;
  mensaje_error: string;
  estructura_proyecto?: Record<string, unknown>;
  archivos_afectados?: string[];
  comando_ejecutado?: string;
  salida_error?: string;
  contexto?: string;
}

interface CorrectionResponse {
  accion: 'corregir';
  descripcion: string;
  archivos: Array<{
    nombre: string;
    contenido: string;
  }>;
  comandos?: string[];
  validacion: string;
}

// Analyze error and provide correction suggestions
function analyzeError(errorReport: ErrorReport): CorrectionResponse {
  const { mensaje_error, archivos_afectados, comando_ejecutado } = errorReport;
  
  // Common error patterns and their fixes
  const errorPatterns = [
    {
      pattern: /Cannot read properties of undefined/i,
      fix: 'Se detectó acceso a propiedad de objeto undefined. Se agregará validación null-safe.',
    },
    {
      pattern: /Module not found/i,
      fix: 'Módulo no encontrado. Se verificarán las importaciones y dependencias.',
    },
    {
      pattern: /SyntaxError/i,
      fix: 'Error de sintaxis detectado. Se revisará la estructura del código.',
    },
    {
      pattern: /TypeError/i,
      fix: 'Error de tipo detectado. Se verificarán los tipos de datos.',
    },
    {
      pattern: /ReferenceError/i,
      fix: 'Referencia no definida. Se verificará el scope de las variables.',
    },
    {
      pattern: /ENOENT/i,
      fix: 'Archivo o directorio no encontrado. Se verificarán las rutas.',
    },
    {
      pattern: /permission denied/i,
      fix: 'Error de permisos. Se verificarán los permisos del archivo.',
    },
    {
      pattern: /npm ERR!/i,
      fix: 'Error de npm. Se limpiará cache y reinstalarán dependencias.',
    },
    {
      pattern: /ng: command not found/i,
      fix: 'Angular CLI no encontrado. Se instalará globalmente.',
    },
  ];

  let detectedFix = 'Error analizado. Se generará una corrección específica.';

  for (const { pattern, fix } of errorPatterns) {
    if (pattern.test(mensaje_error)) {
      detectedFix = fix;
      break;
    }
  }

  // Generate correction response
  const response: CorrectionResponse = {
    accion: 'corregir',
    descripcion: detectedFix,
    archivos: [],
    comandos: [],
    validacion: 'Ejecutar el comando nuevamente y verificar que no haya errores.',
  };

  // Add specific commands based on error type
  if (mensaje_error.includes('npm ERR!')) {
    response.comandos = [
      'rm -rf node_modules package-lock.json',
      'npm install',
    ];
  }

  if (mensaje_error.includes('ng: command not found')) {
    response.comandos = [
      'npm install -g @angular/cli',
    ];
  }

  return response;
}

// Format error report for external AI (ChatGPT, Claude, etc.)
function formatErrorForAI(errorReport: ErrorReport): string {
  return JSON.stringify(errorReport, null, 2);
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    // Validate error report format
    if (body.accion !== 'error_reportado') {
      return NextResponse.json(
        { error: 'Formato de reporte de error inválido' },
        { status: 400 }
      );
    }

    const errorReport: ErrorReport = body;

    // Analyze the error
    const correction = analyzeError(errorReport);

    // Format for external AI
    const formattedForAI = formatErrorForAI(errorReport);

    return NextResponse.json({
      success: true,
      errorReport,
      correction,
      formattedForAI,
      instructions: [
        'Envía el contenido de "formattedForAI" a la IA externa (ChatGPT/Claude)',
        'La IA responderá con una corrección en formato JSON',
        'Ejecuta los comandos y aplica los archivos de la corrección',
      ],
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    console.error('Error API error:', error);
    return NextResponse.json(
      { error: 'Error procesando el reporte de error', details: String(error) },
      { status: 500 }
    );
  }
}

export async function GET() {
  // Return documentation
  return NextResponse.json({
    name: 'Sonny Agent Error Handler',
    description: 'Maneja errores de ejecución y genera correcciones',
    errorFormat: {
      accion: 'error_reportado',
      descripcion: 'Descripción del error',
      mensaje_error: 'Mensaje de error completo',
      estructura_proyecto: { /* Estructura del proyecto */ },
      archivos_afectados: ['archivo1.ts', 'archivo2.html'],
      comando_ejecutado: 'ng serve',
      salida_error: 'Salida de error del comando',
    },
    correctionFormat: {
      accion: 'corregir',
      descripcion: 'Descripción de la corrección',
      archivos: [
        { nombre: 'archivo.ts', contenido: 'código corregido' }
      ],
      comandos: ['npm run build'],
      validacion: 'Cómo verificar la corrección',
    },
  });
}
