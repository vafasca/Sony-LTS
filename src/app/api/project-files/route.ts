import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';

interface FileItem {
  nombre: string;
  ruta: string;
  tipo: 'file' | 'directory';
}

const MAX_ENTRIES = 10000;
const MAX_FILE_SIZE_BYTES = 1024 * 1024; // 1MB

async function listProjectFiles(root: string): Promise<FileItem[]> {
  const results: FileItem[] = [];
  const queue: string[] = [''];

  while (queue.length > 0 && results.length < MAX_ENTRIES) {
    const relDir = queue.shift()!;
    const absDir = path.join(root, relDir);

    let entries;
    try {
      entries = await fs.readdir(absDir, { withFileTypes: true });
    } catch {
      continue;
    }

    entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

    for (const entry of entries) {
      if (results.length >= MAX_ENTRIES) break;
      const relPath = relDir ? path.posix.join(relDir.replaceAll('\\', '/'), entry.name) : entry.name;

      if (entry.isDirectory()) {
        results.push({ nombre: entry.name, ruta: relPath, tipo: 'directory' });
        queue.push(relPath);
      } else if (entry.isFile()) {
        results.push({ nombre: entry.name, ruta: relPath, tipo: 'file' });
      }
    }
  }

  return results;
}

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const root = url.searchParams.get('root');
    const action = url.searchParams.get('action') || 'list';

    if (!root) {
      return NextResponse.json({ success: false, error: 'Parámetro root requerido' }, { status: 400 });
    }

    const rootPath = path.resolve(root);
    const rootStats = await fs.stat(rootPath);
    if (!rootStats.isDirectory()) {
      return NextResponse.json({ success: false, error: 'root no es un directorio' }, { status: 400 });
    }

    if (action === 'content') {
      const filePathParam = url.searchParams.get('file');
      if (!filePathParam) {
        return NextResponse.json({ success: false, error: 'Parámetro file requerido' }, { status: 400 });
      }

      const sanitizedRelPath = filePathParam.replace(/\\/g, '/');
      const absoluteFilePath = path.resolve(rootPath, sanitizedRelPath);

      if (!(absoluteFilePath === rootPath || absoluteFilePath.startsWith(rootPath + path.sep))) {
        return NextResponse.json({ success: false, error: 'Ruta fuera del proyecto' }, { status: 400 });
      }

      const stats = await fs.stat(absoluteFilePath);
      if (!stats.isFile()) {
        return NextResponse.json({ success: false, error: 'No es un archivo' }, { status: 400 });
      }

      if (stats.size > MAX_FILE_SIZE_BYTES) {
        return NextResponse.json({
          success: false,
          error: `Archivo demasiado grande para vista previa (> ${Math.round(MAX_FILE_SIZE_BYTES / 1024)} KB)`,
        }, { status: 413 });
      }

      const content = await fs.readFile(absoluteFilePath, 'utf-8');
      return NextResponse.json({ success: true, file: sanitizedRelPath, content });
    }

    const items = await listProjectFiles(rootPath);
    return NextResponse.json({ success: true, root: rootPath, items, truncated: items.length >= MAX_ENTRIES });
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}
