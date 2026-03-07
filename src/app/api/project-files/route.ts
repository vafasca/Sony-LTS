import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';

interface FileItem {
  nombre: string;
  ruta: string;
  tipo: 'file' | 'directory';
}

interface IgnoreRule {
  raw: string;
  negate: boolean;
  dirOnly: boolean;
}

const MAX_ENTRIES = 10000;
const MAX_FILE_SIZE_BYTES = 1024 * 1024; // 1MB
const DEFAULT_IGNORES = ['.git', 'node_modules', '.next', 'dist', 'build', 'coverage', 'out'];

function wildcardToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\\\*/g, '.*');
  return new RegExp(`^${escaped}$`, 'i');
}

function parseIgnoreRules(content: string): IgnoreRule[] {
  return content
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'))
    .map(line => {
      const negate = line.startsWith('!');
      const rawRule = negate ? line.slice(1).trim() : line;
      const dirOnly = rawRule.endsWith('/');
      const raw = rawRule.replace(/^\/+/, '').replace(/\/+$/, '');
      return { raw, negate, dirOnly };
    })
    .filter(rule => !!rule.raw);
}

function applyRuleMatch(relPath: string, isDir: boolean, rule: IgnoreRule): boolean {
  const normalized = relPath.replace(/\\/g, '/');
  const segments = normalized.split('/').filter(Boolean);
  const basename = segments[segments.length - 1] || normalized;

  if (rule.dirOnly && !isDir) return false;

  const hasSlash = rule.raw.includes('/');
  const hasWildcard = rule.raw.includes('*');

  if (hasWildcard) {
    const re = wildcardToRegExp(rule.raw);
    return hasSlash ? re.test(normalized) : re.test(basename);
  }

  if (hasSlash) {
    return normalized === rule.raw || normalized.startsWith(`${rule.raw}/`);
  }

  return segments.includes(rule.raw) || basename === rule.raw;
}

async function loadIgnoreRules(root: string): Promise<IgnoreRule[]> {
  const rules: IgnoreRule[] = DEFAULT_IGNORES.map(raw => ({ raw, negate: false, dirOnly: true }));
  try {
    const content = await fs.readFile(path.join(root, '.gitignore'), 'utf-8');
    rules.push(...parseIgnoreRules(content));
  } catch {
    // .gitignore puede no existir.
  }
  return rules;
}

function shouldIgnore(relPath: string, isDir: boolean, rules: IgnoreRule[]): boolean {
  let ignored = false;
  for (const rule of rules) {
    if (applyRuleMatch(relPath, isDir, rule)) {
      ignored = !rule.negate;
    }
  }
  return ignored;
}

async function listProjectFiles(root: string, ignoreRules: IgnoreRule[]): Promise<FileItem[]> {
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
        if (shouldIgnore(relPath, true, ignoreRules)) continue;
        results.push({ nombre: entry.name, ruta: relPath, tipo: 'directory' });
        queue.push(relPath);
      } else if (entry.isFile()) {
        if (shouldIgnore(relPath, false, ignoreRules)) continue;
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

    const ignoreRules = await loadIgnoreRules(rootPath);

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

      if (shouldIgnore(sanitizedRelPath, false, ignoreRules)) {
        return NextResponse.json({ success: false, error: 'Archivo ignorado por reglas del proyecto' }, { status: 403 });
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

    const items = await listProjectFiles(rootPath, ignoreRules);
    return NextResponse.json({ success: true, root: rootPath, items, truncated: items.length >= MAX_ENTRIES });
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}
