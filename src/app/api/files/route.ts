import { NextRequest, NextResponse } from 'next/server';
import { writeFile, mkdir, readFile, readdir, stat, unlink } from 'fs/promises';
import { join, dirname } from 'path';

const PROJECTS_DIR = join(process.cwd(), 'projects');

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, path: filePath, content, project } = body;

    if (action === 'create' || action === 'write') {
      if (!filePath || content === undefined) {
        return NextResponse.json({ error: 'Se requiere path y content' }, { status: 400 });
      }

      const fullPath = project 
        ? join(PROJECTS_DIR, project, filePath)
        : join(PROJECTS_DIR, filePath);

      // Create parent directories
      await mkdir(dirname(fullPath), { recursive: true });
      
      // Write file
      await writeFile(fullPath, content, 'utf-8');

      return NextResponse.json({
        success: true,
        message: `Archivo creado: ${filePath}`,
        path: filePath,
        fullPath,
      });
    }

    if (action === 'read') {
      if (!filePath) {
        return NextResponse.json({ error: 'Se requiere path' }, { status: 400 });
      }

      const fullPath = project 
        ? join(PROJECTS_DIR, project, filePath)
        : join(PROJECTS_DIR, filePath);

      const content = await readFile(fullPath, 'utf-8');

      return NextResponse.json({
        success: true,
        content,
        path: filePath,
      });
    }

    if (action === 'delete') {
      if (!filePath) {
        return NextResponse.json({ error: 'Se requiere path' }, { status: 400 });
      }

      const fullPath = project 
        ? join(PROJECTS_DIR, project, filePath)
        : join(PROJECTS_DIR, filePath);

      await unlink(fullPath);

      return NextResponse.json({
        success: true,
        message: `Archivo eliminado: ${filePath}`,
      });
    }

    if (action === 'list') {
      const dirPath = project 
        ? join(PROJECTS_DIR, project, filePath || '')
        : join(PROJECTS_DIR, filePath || '');

      const entries = await readdir(dirPath, { withFileTypes: true });
      const files = await Promise.all(
        entries.map(async (entry) => {
          const entryPath = join(dirPath, entry.name);
          let size: number | undefined;
          if (entry.isFile()) {
            const stats = await stat(entryPath);
            size = stats.size;
          }
          return {
            name: entry.name,
            type: entry.isDirectory() ? 'directory' : 'file',
            size,
          };
        })
      );

      return NextResponse.json({
        success: true,
        files,
        path: filePath || '',
      });
    }

    return NextResponse.json({ error: 'Acción no válida' }, { status: 400 });

  } catch (error) {
    console.error('Files API error:', error);
    return NextResponse.json({
      success: false,
      error: String(error),
    });
  }
}

export async function GET() {
  return NextResponse.json({
    message: 'API para gestionar archivos',
    usage: {
      create: { action: 'create', path: 'archivo.ts', content: '...' },
      read: { action: 'read', path: 'archivo.ts' },
      delete: { action: 'delete', path: 'archivo.ts' },
      list: { action: 'list', path: '' },
    }
  });
}
