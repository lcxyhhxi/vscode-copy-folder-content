import * as fs from 'node:fs'
import * as path from 'node:path'
import * as vscode from 'vscode'
import stripComments from 'strip-comments'
import * as jschardet from 'jschardet'
import * as iconv from 'iconv-lite'

let filesCollection: string[] = []

async function copyContent(files: string[], withoutComments: boolean = false): Promise<string> {
  let content = ''
  for (const file of files) {
    const stats = await fs.promises.stat(file)

    if (stats.isFile()) {
      const buffer = await fs.promises.readFile(file)
      const detected = jschardet.detect(buffer)
      let fileContent
      if (detected.encoding !== 'utf-8' && detected.encoding !== 'ascii' && detected.confidence > 0.5)
        fileContent = iconv.decode(buffer, detected.encoding)
      else fileContent = buffer.toString('utf-8')
      if (withoutComments) {
        fileContent = stripComments(fileContent)
          .replace(/\n\s*\n/g, '\n\n')
      }
      content += `------ ${vscode.workspace.asRelativePath(file)} ------\n\`\`\`\`\`\`\n`

      content += `${fileContent}\n\`\`\`\`\`\`\n`
    }
  }
  return content
}

async function countFiles(folderPath: string): Promise<number> {
  let count = 0
  const entries = await fs.promises.readdir(folderPath, { withFileTypes: true })
  for (const entry of entries) {
    const entryPath = path.join(folderPath, entry.name)
    if (entry.isDirectory())
      count += await countFiles(entryPath) // Recurse into subdirectories
    else
      count++
  }
  return count
}

async function copyFolderRecursive(folderPath: string, withoutComments: boolean = false) {
  const entries = await fs.promises.readdir(folderPath, { withFileTypes: true })
  for (const entry of entries) {
    const entryPath = path.join(folderPath, entry.name)
    if (entry.isDirectory())
      await copyFolderRecursive(entryPath, withoutComments)
    else
      filesCollection.push(entryPath)
  }
}

async function copyFolderContentRecursively(folder: vscode.Uri, withoutComments: boolean) {
  try {
    const fileCount = await countFiles(folder.fsPath)
    if (fileCount > 1000) {
      const shouldContinue = await vscode.window.showWarningMessage(
        `该文件夹包含超过1000个文件(共${fileCount}个文件)。是否继续?`,
        '是',
        '否',
      )
      if (shouldContinue !== '是')
        return
    }
    filesCollection = []
    await copyFolderRecursive(folder.fsPath, withoutComments)
    const content = await copyContent(filesCollection, withoutComments)
    await vscode.env.clipboard.writeText(content)
    vscode.window.setStatusBarMessage(`已成功将文件夹内容${withoutComments ? '(不含注释)' : ''}复制到剪贴板!`, 5000)
  }
  catch (err) {
    vscode.window.showErrorMessage('无法递归读取文件夹')
  }
}

async function copyFolderContentRecursivelyByType(folder: vscode.Uri) {
  try {
    const fileExtensions = new Set<string>()

    async function collectFileExtensions(folderPath: string) {
      const entries = await fs.promises.readdir(folderPath, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.isDirectory()) {
          await collectFileExtensions(path.join(folderPath, entry.name))
        }
        else {
          const extension = path.extname(entry.name)
          if (extension)
            fileExtensions.add(extension)
        }
      }
    }

    await collectFileExtensions(folder.fsPath)
    const selectedExtensions = await vscode.window.showQuickPick(Array.from(fileExtensions), {
      placeHolder: 'Select file extensions',
      canPickMany: true,
    })

    if (!selectedExtensions || selectedExtensions.length === 0)
      return

    filesCollection = []

    async function copyFiles(folderPath: string) {
      const entries = await fs.promises.readdir(folderPath, { withFileTypes: true })
      for (const entry of entries) {
        const entryPath = path.join(folderPath, entry.name)
        if (entry.isDirectory())
          await copyFiles(entryPath)
        else if (selectedExtensions && selectedExtensions.some(ext => entry.name.endsWith(ext)))
          filesCollection.push(entryPath)
      }
    }

    await copyFiles(folder.fsPath)

    const content = await copyContent(filesCollection)
    await vscode.env.clipboard.writeText(content)
    vscode.window.setStatusBarMessage(`已成功将文件扩展名为 ${selectedExtensions.join(', ')} 的文件夹内容复制到剪贴板!`, 5000)
  }
  catch (err) {
    vscode.window.showErrorMessage('无法递归读取文件夹')
  }
}

export function activate(context: vscode.ExtensionContext) {
  const copyFolderContent = async (folder: vscode.Uri, prompt: string, withoutComments: boolean) => {
    try {
      const files = (await fs.promises.readdir(folder.fsPath)).map(fileName => path.join(folder.fsPath, fileName))
      const content = `${prompt}\n${await copyContent(files, withoutComments)}\n${prompt}`

      await vscode.env.clipboard.writeText(content)
      vscode.window.setStatusBarMessage(`已成功将文件夹内容${prompt ? '(带提示)' : ''}复制到剪贴板!`, 5000)
    }
    catch (err) {
      vscode.window.showErrorMessage('无法读取文件夹')
    }
  }

  const addToCollection = async (file: vscode.Uri) => {
    try {
      filesCollection.push(file.fsPath)
    }
    catch (err) {
      vscode.window.showErrorMessage('无法读取文件')
    }
  }

  const addToCollectionAndCopy = async (file: vscode.Uri) => {
    await addToCollection(file)
    const content = await copyContent(filesCollection)
    await vscode.env.clipboard.writeText(content)
    vscode.window.setStatusBarMessage(`已将文件添加到集合并复制到剪贴板!`, 5000)
  }

  const newCollectionAndAdd = async (file: vscode.Uri) => {
    filesCollection = []
    await addToCollection(file)
    vscode.window.setStatusBarMessage(`已创建新集合并添加文件!`, 5000)
  }

  const copyCollectionAndClear = async () => {
    const content = await copyContent(filesCollection)
    await vscode.env.clipboard.writeText(content)
    filesCollection = [] // 清空集合
    vscode.window.setStatusBarMessage(`已将集合内容复制到剪贴板并清空集合!`, 5000)
  }

  const disposable = vscode.commands.registerCommand('extension.copyFolderContent', folder => copyFolderContent(folder, '', false))
  const disposableWithPrompt = vscode.commands.registerCommand('extension.copyFolderContentWithPrompt', async (folder) => {
    const prompt = await vscode.window.showInputBox({ prompt: 'Enter the prompt' }) || ''
    return copyFolderContent(folder, prompt, false)
  })
  const disposableWithoutComments = vscode.commands.registerCommand('extension.copyFolderContentWithoutComments', folder => copyFolderContent(folder, '', true))
  const disposableAddToCollection = vscode.commands.registerCommand('extension.addToCollection', async (file) => {
    await addToCollection(file)
    vscode.window.setStatusBarMessage(`已将文件添加到集合!`, 5000)
  })
  const disposableAddToCollectionAndCopy = vscode.commands.registerCommand('extension.addToCollectionAndCopy', addToCollectionAndCopy)
  const disposableNewCollectionAndAdd = vscode.commands.registerCommand('extension.newCollectionAndAdd', newCollectionAndAdd)
  const disposableCopyCollectionAndClear = vscode.commands.registerCommand('extension.copyCollectionAndClear', copyCollectionAndClear)

  context.subscriptions.push(disposable)
  context.subscriptions.push(disposableWithPrompt)
  context.subscriptions.push(disposableWithoutComments)
  context.subscriptions.push(disposableAddToCollection)
  context.subscriptions.push(disposableAddToCollectionAndCopy)
  context.subscriptions.push(disposableNewCollectionAndAdd)
  context.subscriptions.push(disposableCopyCollectionAndClear)

  const disposableRecursiveCopy = vscode.commands.registerCommand('extension.copyFolderContentRecursively', folder => copyFolderContentRecursively(folder, false))
  context.subscriptions.push(disposableRecursiveCopy)

  const disposableCopyFolderContentByType = vscode.commands.registerCommand('extension.copyFolderContentRecursivelyByType', copyFolderContentRecursivelyByType)
  context.subscriptions.push(disposableCopyFolderContentByType)
}

export function deactivate() { }
