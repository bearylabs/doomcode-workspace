# doom-workspace

Sidecar extension for [Doom Code](https://github.com/bearylabs/doomcode).

Some Doom Code features — directory reading, project file listing, and text search — must run on the machine that owns the workspace (SSH host, WSL, or local). VS Code's `extensionKind: ["ui"]` restriction prevents the main extension from doing this directly, so those features are extracted here as a `extensionKind: ["workspace"]` extension that Doom Code can call via `vscode.commands.executeCommand`.

## Commands

| Command | Description |
|---|---|
| `doom-workspace.readDirectory` | Read a directory and return sorted entries with metadata |
| `doom-workspace.listProjectFiles` | List all project files via git or VS Code findFiles fallback |
| `doom-workspace.searchText` | Search file contents via ripgrep, falling back to git grep |
