import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

// doom-workspace runs as extensionKind ["workspace"] so this always executes
// on the machine that owns the workspace (local, SSH host, or WSL). All git
// and filesystem operations below happen on that machine directly.

export interface ProjectFileEntry {
    rel: string;
    mtime: number | undefined;
    size: number | undefined;
    mode: number | undefined;
}

export async function listProjectFiles(rootUriString: string): Promise<ProjectFileEntry[]> {
    const rootUri = vscode.Uri.parse(rootUriString);
    const rootPath = rootUri.fsPath;
    const { scheme, authority } = rootUri;
    const isWsl = scheme === 'vscode-remote' && authority.startsWith('wsl+');

    let relativePaths: string[];

    try {
        const files = await gitLsFiles(rootPath, isWsl);
        relativePaths = files.length > 0 ? files : await findFilesFallback(rootUri);
    } catch {
        // not a git repository or git is not available — fall through
        relativePaths = await findFilesFallback(rootUri);
    }

    const statResults = await Promise.allSettled(
        relativePaths.map(rel => fs.promises.stat(path.join(rootPath, rel)))
    );

    return relativePaths.map((rel, i) => {
        const s = statResults[i];
        return {
            rel,
            mtime: s.status === 'fulfilled' ? s.value.mtimeMs : undefined,
            size: s.status === 'fulfilled' ? s.value.size : undefined,
            mode: s.status === 'fulfilled' ? s.value.mode : undefined,
        };
    });
}

async function findFilesFallback(rootUri: vscode.Uri): Promise<string[]> {
    const uris = await vscode.workspace.findFiles(
        new vscode.RelativePattern(rootUri, '**/*'),
        '{**/node_modules/**,**/.git/**,**/.hg/**,**/.svn/**}'
    );
    return uris.map(uri => vscode.workspace.asRelativePath(uri, false));
}

function gitLsFiles(cwd: string, isWsl: boolean): Promise<string[]> {
    return new Promise((resolve, reject) => {
        const gitArgs = [
            'ls-files',
            '--cached',
            '--others',
            '--exclude-standard',
        ];

        // On a WSL workspace the extension runs inside WSL, so the git binary
        // is the native Linux one and needs no special wrapper.
        const [cmd, args] = isWsl
            ? ['git', gitArgs]
            : ['git', gitArgs];

        const proc = spawn(cmd, args, { cwd });
        const chunks: Buffer[] = [];

        proc.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
        proc.on('error', reject);
        proc.on('close', (code) => {
            if (code !== 0) {
                reject(new Error(`git ls-files exited with code ${code}`));
                return;
            }
            const output = Buffer.concat(chunks).toString('utf-8');
            resolve(output.split('\n').filter(Boolean));
        });
    });
}
