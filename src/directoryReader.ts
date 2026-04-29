import { promises as fsp } from 'fs';
import * as vscode from 'vscode';

// doom-workspace runs as extensionKind ["workspace"] so this always executes
// on the machine that owns the workspace (local, SSH host, or WSL). All
// filesystem operations below happen on that machine directly.

export interface DirectoryEntry {
    name: string;
    isDir: boolean;
    size: string;
    mtime: number | undefined;
    permissions: string;
}

/** Formats a byte count into a human-readable string. Matches the format in panel/helpers.ts. */
function formatFileSize(bytes: number): string {
    if (bytes < 1024) {
        return String(bytes);
    }
    if (bytes < 1024 * 1024) {
        const k = bytes / 1024;
        const s = k < 10 ? String(Math.round(k * 10) / 10) : String(Math.round(k));
        return s + 'k';
    }
    if (bytes < 1024 * 1024 * 1024) {
        const m = bytes / (1024 * 1024);
        const s = m < 10 ? String(Math.round(m * 10) / 10) : String(Math.round(m));
        return s + 'M';
    }
    const g = bytes / (1024 * 1024 * 1024);
    const s = g < 10 ? String(Math.round(g * 10) / 10) : String(Math.round(g));
    return s + 'G';
}

/**
 * Converts a Unix `stat.mode` bitmask into an `ls`-style permission string
 * (e.g. `-rwxr-xr-x`). The high bits identify the file type; the low 9 bits
 * encode owner/group/other rwx permissions.
 */
function formatPermissions(mode: number): string {
    const typeMap: Record<number, string> = {
        0o140000: 's',  // socket
        0o120000: 'l',  // symlink
        0o100000: '-',  // regular file
        0o060000: 'b',  // block device
        0o040000: 'd',  // directory
        0o020000: 'c',  // char device
        0o010000: 'p',  // named pipe
    };
    const fileType = typeMap[mode & 0o170000] ?? '?';
    const bits = (n: number): string =>
        (n & 4 ? 'r' : '-') + (n & 2 ? 'w' : '-') + (n & 1 ? 'x' : '-');
    return fileType + bits((mode >> 6) & 7) + bits((mode >> 3) & 7) + bits(mode & 7);
}

/**
 * Lists the contents of a directory, returning entries with size, mtime, and
 * Unix permission bits. Used by the `doom-workspace.readDirectory` command,
 * which powers the `SPC .` directory browser in the doomcode extension.
 *
 * Two stat sources are used per entry and fired in parallel to avoid serial
 * WSL/SSH round-trips:
 *   - `vscode.workspace.fs.stat`  — cross-platform; provides size + mtime.
 *   - `fsp.stat` (Node fs)        — local/SSH/WSL only; provides Unix mode bits
 *                                   for permission display.
 *
 * Result is sorted: directories first (alphabetical), then files (newest first).
 */
export async function readDirectory(uriString: string): Promise<DirectoryEntry[]> {
    const uri = vscode.Uri.parse(uriString);
    const { scheme, authority } = uri;
    // Detect remote context so we know whether Node fs can reach the fsPath.
    const isSsh = scheme === 'vscode-remote' && authority.startsWith('ssh-remote+');
    const isWsl = scheme === 'vscode-remote' && authority.startsWith('wsl+');
    // Node fs is available on local, SSH remote, and WSL — but not on other
    // virtual file systems (e.g. devcontainer volumes).
    const canUseFsp = isSsh || isWsl || scheme === 'file';

    const rawEntries = await vscode.workspace.fs.readDirectory(uri);

    const entries = await Promise.all(rawEntries.map(async ([name, fileType]) => {
        const isDir = !!(fileType & vscode.FileType.Directory);
        const childUri = vscode.Uri.joinPath(uri, name);

        let size = '';
        let mtime: number | undefined;
        let permissions = '';

        // Both stat calls are fired in parallel. On WSL/SSH with many entries
        // this avoids N × 2 serial round-trips and instead pays ~1 round-trip
        // of latency regardless of directory size.
        const [vsStat, nodeStat] = await Promise.allSettled([
            vscode.workspace.fs.stat(childUri),
            canUseFsp ? fsp.stat(childUri.fsPath) : Promise.reject(),
        ]);

        if (vsStat.status === 'fulfilled') {
            mtime = vsStat.value.mtime > 0 ? vsStat.value.mtime : undefined;
            size = formatFileSize(vsStat.value.size);
        }
        if (nodeStat.status === 'fulfilled') {
            permissions = formatPermissions(nodeStat.value.mode);
        }

        return { name, isDir, size, mtime, permissions };
    }));

    const dirs = entries
        .filter(e => e.isDir)
        .sort((a, b) => a.name.localeCompare(b.name));

    const files = entries
        .filter(e => !e.isDir)
        .sort((a, b) => (b.mtime ?? 0) - (a.mtime ?? 0));

    return [...dirs, ...files];
}
