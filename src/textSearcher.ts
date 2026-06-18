import { spawn } from 'child_process';
import * as path from 'path';
import * as vscode from 'vscode';

// doom-workspace runs as extensionKind ["workspace"] so this always executes
// on the machine that owns the workspace (local, SSH host, or WSL). All
// filesystem operations below happen on that machine directly.

export interface TextSearchResult {
    rel: string;
    line: number;   // 0-based
    text: string;
}

/**
 * Searches for literal text in the workspace rooted at `rootUriString`.
 * Tries ripgrep first (fast, respects .gitignore), falls back to git grep.
 * Returns at most `maxResults` results in file-path / line-number order.
 */
export async function searchText(
    rootUriString: string,
    query: string,
    maxResults: number,
): Promise<TextSearchResult[]> {
    const rootUri = vscode.Uri.parse(rootUriString);
    const rootPath = rootUri.fsPath;
    const excludes = ['.git', 'node_modules', 'out', 'dist', 'coverage', 'build', '.next'];

    try {
        return await rgSearch(rootPath, query, maxResults, excludes);
    } catch {
        try {
            return await gitGrepSearch(rootPath, query, maxResults);
        } catch {
            return [];
        }
    }
}

function rgSearch(
    rootPath: string,
    query: string,
    maxResults: number,
    excludes: string[],
): Promise<TextSearchResult[]> {
    return new Promise((resolve, reject) => {
        const excludeArgs = excludes.flatMap(d => ['--glob', `!${d}/**`]);
        const args = [
            '--line-number',
            '--no-heading',
            '--color=never',
            '--fixed-strings',
            ...excludeArgs,
            '-e', query,
            '--',
            '.',
        ];
        runSearch('rg', args, rootPath, maxResults, resolve, reject);
    });
}

function gitGrepSearch(
    rootPath: string,
    query: string,
    maxResults: number,
): Promise<TextSearchResult[]> {
    return new Promise((resolve, reject) => {
        const args = ['grep', '-n', '--fixed-strings', '-e', query, '--', '.'];
        runSearch('git', args, rootPath, maxResults, resolve, reject);
    });
}

function runSearch(
    cmd: string,
    args: string[],
    cwd: string,
    maxResults: number,
    resolve: (results: TextSearchResult[]) => void,
    reject: (err: Error) => void,
): void {
    const proc = spawn(cmd, args, { cwd });
    const chunks: Buffer[] = [];

    proc.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    proc.on('error', reject);
    proc.on('close', (code) => {
        // exit 0 = matches found, exit 1 = no matches, exit 2+ = error
        if (code !== null && code > 1) {
            reject(new Error(`${cmd} exited with code ${code}`));
            return;
        }
        resolve(parseGrepOutput(Buffer.concat(chunks).toString('utf-8'), cwd, maxResults));
    });
}

/** Parses `FILE:LINENUM:TEXT` lines produced by rg/git grep into result objects. */
function parseGrepOutput(output: string, rootPath: string, maxResults: number): TextSearchResult[] {
    const results: TextSearchResult[] = [];
    for (const rawLine of output.split('\n')) {
        if (results.length >= maxResults) { break; }
        const line = rawLine.trimEnd();
        if (!line) { continue; }

        const firstColon = line.indexOf(':');
        if (firstColon === -1) { continue; }
        const secondColon = line.indexOf(':', firstColon + 1);
        if (secondColon === -1) { continue; }

        const filePath = line.slice(0, firstColon);
        const lineNum = parseInt(line.slice(firstColon + 1, secondColon), 10);
        if (isNaN(lineNum) || lineNum < 1) { continue; }

        const text = line.slice(secondColon + 1);
        let rel = filePath.startsWith('./') ? filePath.slice(2) : filePath;
        if (path.isAbsolute(rel)) {
            rel = path.relative(rootPath, rel);
        }

        results.push({ rel, line: lineNum - 1, text: text.trim() });
    }
    return results;
}
