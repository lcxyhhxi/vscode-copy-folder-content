import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export function activate(context: vscode.ExtensionContext) {
    let disposable = vscode.commands.registerCommand('extension.copyFolderContent', async (folder: vscode.Uri) => {
        // Prepare to read the directory and its files
        try {
            let files = await fs.promises.readdir(folder.fsPath);
            let content = '';

            for (const file of files) {
                let filePath = path.join(folder.fsPath, file);
                let stats = await fs.promises.stat(filePath);

                if (stats.isFile()) {
                    let fileContent = await fs.promises.readFile(filePath, 'utf-8');

                    content += '// ' + file + '\n';
                    content += fileContent + '\n';
                }
            }

            // add the suffix
            const config = vscode.workspace.getConfiguration('copy-folder-content');
            const suffix = config.get('suffix') as string;
            content += suffix;

            await vscode.env.clipboard.writeText(content);
            vscode.window.showInformationMessage('Folder content copied to clipboard!');
        } catch (err) {
            vscode.window.showErrorMessage('Could not read folder');
        }
    });

    context.subscriptions.push(disposable);
}

export function deactivate() { }
