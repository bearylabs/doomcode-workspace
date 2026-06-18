import { promises as fsp } from 'fs';
import * as vscode from 'vscode';

// doom-workspace runs as extensionKind ["workspace"] so this always executes
// on the machine that owns the workspace (local, SSH host, or WSL). All
// filesystem operations below happen on that machine directly.

export interface DirectoryEntry {
    name: string;
    isDir: boolean;
    size: number | undefined;
    mtime: number | undefined;
    mode: number | undefined;
}

/**
 * Lists the contents of a directory, returning entries with raw size, mtime,
 * and Unix mode bits. Formatting for display is left to the caller so the UI
 * extension stays the single source of truth. Used by the
 * `doom-workspace.readDirectory` command,
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

        let size: number | undefined;
        let mtime: number | undefined;
        let mode: number | undefined;

        // Both stat calls are fired in parallel. On WSL/SSH with many entries
        // this avoids N × 2 serial round-trips and instead pays ~1 round-trip
        // of latency regardless of directory size.
        const [vsStat, nodeStat] = await Promise.allSettled([
            vscode.workspace.fs.stat(childUri),
            canUseFsp ? fsp.stat(childUri.fsPath) : Promise.reject(),
        ]);

        if (vsStat.status === 'fulfilled') {
            mtime = vsStat.value.mtime > 0 ? vsStat.value.mtime : undefined;
            size = vsStat.value.size;
        }
        if (nodeStat.status === 'fulfilled') {
            mode = nodeStat.value.mode;
        }

        return { name, isDir, size, mtime, mode };
    }));

    const dirs = entries
        .filter(e => e.isDir)
        .sort((a, b) => a.name.localeCompare(b.name));

    const files = entries
        .filter(e => !e.isDir)
        .sort((a, b) => (b.mtime ?? 0) - (a.mtime ?? 0));

    return [...dirs, ...files];
}
