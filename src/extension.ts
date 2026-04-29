import * as vscode from 'vscode';
import { readDirectory } from './directoryReader';
import { listProjectFiles } from './projectFileLister';

export function activate(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.commands.registerCommand(
            'doom-workspace.readDirectory',
            (uriString: string) => readDirectory(uriString)
        ),
        vscode.commands.registerCommand(
            'doom-workspace.listProjectFiles',
            (rootUriString: string) => listProjectFiles(rootUriString)
        )
    );
}

export function deactivate(): void {
    // nothing to clean up
}
