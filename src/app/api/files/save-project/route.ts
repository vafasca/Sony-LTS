import { NextRequest, NextResponse } from 'next/server';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';

// Base directory for projects
const PROJECTS_BASE_DIR = join(process.cwd(), 'projects');

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { projectName, folder, files } = body;

    if (!projectName || !files || files.length === 0) {
      return NextResponse.json(
        { error: 'Se requiere nombre de proyecto y archivos' },
        { status: 400 }
      );
    }

    // Use provided folder or default
    const baseDir = folder || PROJECTS_BASE_DIR;
    const projectDir = join(baseDir, projectName);

    // Create project directory
    await mkdir(projectDir, { recursive: true });

    // Save each file
    const savedFiles: string[] = [];
    for (const file of files) {
      const filePath = join(projectDir, file.nombre || file.name);
      
      // Create subdirectories if needed
      const fileDir = filePath.substring(0, filePath.lastIndexOf('/'));
      if (fileDir !== projectDir) {
        await mkdir(fileDir, { recursive: true });
      }
      
      await writeFile(filePath, file.contenido || file.content || '', 'utf-8');
      savedFiles.push(file.nombre || file.name);
    }

    return NextResponse.json({
      success: true,
      message: `Proyecto "${projectName}" guardado correctamente`,
      projectDir,
      filesCount: savedFiles.length,
      files: savedFiles,
    });

  } catch (error) {
    console.error('Save project error:', error);
    return NextResponse.json(
      { error: 'Error al guardar el proyecto', details: String(error) },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({
    message: 'API para guardar proyectos de Sonny Agent',
    usage: {
      method: 'POST',
      body: {
        projectName: 'nombre-del-proyecto',
        folder: '/ruta/opcional',
        files: [
          { nombre: 'archivo.html', contenido: '...' }
        ]
      }
    }
  });
}
