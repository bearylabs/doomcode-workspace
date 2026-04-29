import { promises as fsp } from 'fs';
import * as vscode from 'vscode';

export interface DirectoryEntry {
    name: string;
    isDir: boolean;
    size: string;
    mtime: number | undefined;
    permissions: string;
}

function formatFileSize(bytes: number): string {
    if (bytes < 1024) {
        return `${bytes}B`;
    }
    if (bytes < 1048576) {
        return `${(bytes / 1024).toFixed(1)}K`;
    }
    if (bytes < 1073741824) {
        return `${(bytes / 1048576).toFixed(1)}M`;
    }
    return `${(bytes / 1073741824).toFixed(1)}G`;
}

function formatPermissions(mode: number): string {
    const typeMap: Record<number, string> = {
        0o140000: 's',
        0o120000: 'l',
        0o100000: '-',
        0o060000: 'b',
        0o040000: 'd',
        0o020000: 'c',
        0o010000: 'p',
    };
    const fileType = typeMap[mode & 0o170000] ?? '?';
    const bits = (n: number): string =>
        (n & 4 ? 'r' : '-') + (n & 2 ? 'w' : '-') + (n & 1 ? 'x' : '-');
    return fileType + bits((mode >> 6) & 7) + bits((mode >> 3) & 7) + bits(mode & 7);
}

export async function readDirectory(uriString: string): Promise<DirectoryEntry[]> {
    const uri = vscode.Uri.parse(uriString);
    const { scheme, authority } = uri;
    const isSsh = scheme === 'vscode-remote' && authority.startsWith('ssh-remote+');
    const isWsl = scheme === 'vscode-remote' && authority.startsWith('wsl+');

    const rawEntries = await vscode.workspace.fs.readDirectory(uri);
    const entries: DirectoryEntry[] = [];

    for (const [name, fileType] of rawEntries) {
        const isDir = !!(fileType & vscode.FileType.Directory);
        const childUri = vscode.Uri.joinPath(uri, name);

        let size = '';
        let mtime: number | undefined;
        let permissions = '';

        try {
            const vsStat = await vscode.workspace.fs.stat(childUri);
            mtime = vsStat.mtime > 0 ? vsStat.mtime : undefined;
            if (!isDir) {
                size = formatFileSize(vsStat.size);
            }
        } catch {
            // ignore inaccessible entries
        }

        // On local and SSH/WSL workspace machines the fsPath is a real path
        // we can stat via Node fs to obtain Unix permission bits.
        if (isSsh || isWsl || scheme === 'file') {
            try {
                const nodeStat = await fsp.stat(childUri.fsPath);
                permissions = formatPermissions(nodeStat.mode);
            } catch {
                // ignore permission errors
            }
        }

        entries.push({ name, isDir, size, mtime, permissions });
    }

    const dirs = entries
        .filter(e => e.isDir)
        .sort((a, b) => a.name.localeCompare(b.name));

    const files = entries
        .filter(e => !e.isDir)
        .sort((a, b) => (b.mtime ?? 0) - (a.mtime ?? 0));

    return [...dirs, ...files];
}
