import { spawn } from 'child_process';
import * as vscode from 'vscode';

// doom-workspace runs as extensionKind ["workspace"] so this always executes
// on the machine that owns the workspace (local, SSH host, or WSL). All git
// and filesystem operations below happen on that machine directly.

export async function listProjectFiles(rootUriString: string): Promise<string[]> {
    const rootUri = vscode.Uri.parse(rootUriString);
    const rootPath = rootUri.fsPath;
    const { scheme, authority } = rootUri;
    const isWsl = scheme === 'vscode-remote' && authority.startsWith('wsl+');

    try {
        const files = await gitLsFiles(rootPath, isWsl);
        if (files.length > 0) {
            return files;
        }
    } catch {
        // not a git repository or git is not available — fall through
    }

    // findFiles fallback: respects .gitignore via VS Code's built-in exclusions
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
