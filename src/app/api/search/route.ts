import { NextRequest, NextResponse } from 'next/server';
import { readdir, stat, readFile } from 'fs/promises';
import { join, extname } from 'path';

interface SearchResult {
  path: string;
  name: string;
  type: 'file' | 'directory';
  size?: number;
  modified?: Date;
  match?: string;
  lineNumbers?: number[];
}

interface SearchOptions {
  basePath: string;
  query: string;
  fileTypes?: string[];
  maxDepth?: number;
  maxResults?: number;
  searchContent?: boolean;
}

// Default safe directories to search
const SAFE_DIRECTORIES = [
  process.env.HOME || '/home',
  '/home/z/my-project',
  process.cwd(),
];

// Blocked directories for security
const BLOCKED_DIRECTORIES = [
  '/etc',
  '/root',
  '/var/log',
  '/sys',
  '/proc',
  'node_modules',
  '.git',
  '__pycache__',
  '.next',
  '.cache',
  'dist',
  'build',
];

// Common file types
const FILE_TYPE_EXTENSIONS: Record<string, string[]> = {
  code: ['.ts', '.tsx', '.js', '.jsx', '.py', '.java', '.go', '.rs', '.rb', '.php', '.cs'],
  web: ['.html', '.css', '.scss', '.sass', '.less'],
  config: ['.json', '.yaml', '.yml', '.toml', '.ini', '.env'],
  docs: ['.md', '.txt', '.rst', '.pdf', '.doc', '.docx'],
  images: ['.jpg', '.jpeg', '.png', '.gif', '.svg', '.webp', '.ico'],
};

async function searchDirectory(
  dirPath: string,
  query: string,
  options: SearchOptions,
  currentDepth: number = 0,
  results: SearchResult[] = []
): Promise<SearchResult[]> {
  const { maxDepth = 5, maxResults = 100, fileTypes, searchContent = false } = options;

  if (currentDepth > maxDepth || results.length >= maxResults) {
    return results;
  }

  // Check if directory is blocked
  const dirName = dirPath.split('/').pop() || '';
  if (BLOCKED_DIRECTORIES.some(blocked => 
    dirPath.includes(blocked) || dirName === blocked
  )) {
    return results;
  }

  try {
    const entries = await readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      if (results.length >= maxResults) break;

      const fullPath = join(dirPath, entry.name);
      
      // Skip hidden files and blocked directories
      if (entry.name.startsWith('.') || BLOCKED_DIRECTORIES.includes(entry.name)) {
        continue;
      }

      if (entry.isDirectory()) {
        // Check if directory name matches query
        if (entry.name.toLowerCase().includes(query.toLowerCase())) {
          results.push({
            path: fullPath,
            name: entry.name,
            type: 'directory',
          });
        }
        // Recurse into subdirectory
        await searchDirectory(fullPath, query, options, currentDepth + 1, results);
      } else if (entry.isFile()) {
        const ext = extname(entry.name).toLowerCase();
        
        // Filter by file type if specified
        if (fileTypes && fileTypes.length > 0) {
          const allowedExtensions = fileTypes.flatMap(ft => FILE_TYPE_EXTENSIONS[ft] || [ft]);
          if (!allowedExtensions.includes(ext)) {
            continue;
          }
        }

        // Check if filename matches query
        const nameMatches = entry.name.toLowerCase().includes(query.toLowerCase());
        
        // Get file stats
        let stats;
        try {
          stats = await stat(fullPath);
        } catch {
          continue;
        }

        const result: SearchResult = {
          path: fullPath,
          name: entry.name,
          type: 'file',
          size: stats.size,
          modified: stats.mtime,
        };

        // Search in file content if enabled and file is text-based
        const textExtensions = [...FILE_TYPE_EXTENSIONS.code, ...FILE_TYPE_EXTENSIONS.web, 
          ...FILE_TYPE_EXTENSIONS.config, ...FILE_TYPE_EXTENSIONS.docs, '.txt'];
        
        if (searchContent && textExtensions.includes(ext) && stats.size < 1024 * 1024) { // Max 1MB
          try {
            const content = await readFile(fullPath, 'utf-8');
            const lines = content.split('\n');
            const matchingLines: number[] = [];
            
            lines.forEach((line, index) => {
              if (line.toLowerCase().includes(query.toLowerCase())) {
                matchingLines.push(index + 1);
              }
            });

            if (matchingLines.length > 0) {
              result.lineNumbers = matchingLines.slice(0, 10); // Max 10 matches
              result.match = `Found in ${matchingLines.length} line(s)`;
              results.push(result);
            } else if (nameMatches) {
              results.push(result);
            }
          } catch {
            // Skip files that can't be read
            if (nameMatches) {
              results.push(result);
            }
          }
        } else if (nameMatches) {
          results.push(result);
        }
      }
    }
  } catch (error) {
    // Skip directories we can't access
    console.error(`Error searching directory ${dirPath}:`, error);
  }

  return results;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { 
      query, 
      basePath, 
      fileTypes = [], 
      maxDepth = 5, 
      maxResults = 50,
      searchContent = false 
    } = body;

    if (!query || typeof query !== 'string') {
      return NextResponse.json(
        { error: 'Se requiere un término de búsqueda' },
        { status: 400 }
      );
    }

    // Determine base path
    let searchPath = basePath;
    if (!searchPath) {
      // Default to project directory
      searchPath = process.cwd();
    }

    // Validate that the search path is safe
    const isPathSafe = SAFE_DIRECTORIES.some(safeDir => 
      searchPath.startsWith(safeDir)
    ) || searchPath === process.cwd();

    if (!isPathSafe) {
      return NextResponse.json(
        { 
          error: 'Directorio no permitido por seguridad',
          safeDirectories: SAFE_DIRECTORIES.filter(Boolean)
        },
        { status: 403 }
      );
    }

    const options: SearchOptions = {
      basePath: searchPath,
      query,
      fileTypes,
      maxDepth,
      maxResults,
      searchContent,
    };

    const results = await searchDirectory(searchPath, query, options);

    return NextResponse.json({
      success: true,
      query,
      basePath: searchPath,
      resultsCount: results.length,
      results,
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    console.error('Search API error:', error);
    return NextResponse.json(
      { error: 'Error en la búsqueda', details: String(error) },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get('q');
  const basePath = searchParams.get('path') || process.cwd();
  const fileTypes = searchParams.get('types')?.split(',') || [];
  const maxResults = parseInt(searchParams.get('limit') || '50');

  if (!query) {
    return NextResponse.json(
      { error: 'Se requiere parámetro de búsqueda (q)' },
      { status: 400 }
    );
  }

  const options: SearchOptions = {
    basePath,
    query,
    fileTypes,
    maxResults,
  };

  const results = await searchDirectory(basePath, query, options);

  return NextResponse.json({
    success: true,
    query,
    basePath,
    resultsCount: results.length,
    results,
  });
}
