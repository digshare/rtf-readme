import * as chokidar from 'chokidar';
import * as fs from 'fs';
import mkdirp from 'mkdirp';
import * as Path from 'path';
import rimraf from 'rimraf';
import simpleGit from 'simple-git';
import {TextEncoder} from 'util';
import * as vscode from 'vscode';
import {pathToPosixPath, posixPathToPath} from 'please-readme.lib';

export class FileSystemProvider implements vscode.FileSystemProvider {
  private _onDidChangeFile: vscode.EventEmitter<vscode.FileChangeEvent[]>;

  constructor() {
    this._onDidChangeFile = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  }

  get onDidChangeFile(): vscode.Event<vscode.FileChangeEvent[]> {
    return this._onDidChangeFile.event;
  }

  watch(uri: vscode.Uri): vscode.Disposable {
    let watcher = chokidar.watch(uri.fsPath, {
      ignoreInitial: true,
      ignored: /(^|[\/\\])\.git/,
    });

    watcher.on('all', async (event, path) => {
      let absolutePath = pathToPosixPath(path);

      this._onDidChangeFile.fire([
        {
          type:
            event === 'change'
              ? vscode.FileChangeType.Changed
              : (await _.exists(path))
              ? vscode.FileChangeType.Created
              : vscode.FileChangeType.Deleted,
          uri: uri,
          filePath: absolutePath,
          fileType: event.indexOf('Dir') === -1 ? 'file' : 'dir',
        } as vscode.FileChangeEvent,
      ]);
    });

    return {dispose: () => watcher.close()};
  }

  stat(uri: vscode.Uri): Thenable<vscode.FileStat> {
    return this._stat(uri.fsPath);
  }

  async _stat(path: string): Promise<vscode.FileStat> {
    const res = await _.statLink(path);
    return new FileStat(res.stat, res.isSymbolicLink);
  }

  readDirectory(
    uri: vscode.Uri,
  ): [string, vscode.FileType][] | Thenable<[string, vscode.FileType][]> {
    return this._readDirectory(uri);
  }

  async _readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
    const children = await _.readdir(uri.fsPath);

    const result: [string, vscode.FileType][] = [];
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      const stat = await this._stat(Path.join(uri.fsPath, child));
      result.push([child, stat.type]);
    }

    return Promise.resolve(result);
  }

  createDirectory(uri: vscode.Uri): void | Thenable<void> {
    return _.mkdir(uri.fsPath);
  }

  readFile(uri: vscode.Uri): Uint8Array | Thenable<Uint8Array> {
    let absolutePath = uri.path;

    let commit: string;

    try {
      commit = JSON.parse(uri.query).commit;
    } catch (e) {
      console.error('parse uri.query failed.\n', e);

      return new TextEncoder().encode('');
    }

    let workspaceFolders = vscode.workspace.workspaceFolders?.filter(
      workspaceFolder => absolutePath.startsWith(workspaceFolder.uri.path),
    );

    if (workspaceFolders) {
      for (let workspaceFolder of workspaceFolders) {
        let workspacePath = workspaceFolder.uri.path;

        try {
          let simpleGitObject = simpleGit(posixPathToPath(workspacePath));

          let relativePath = posixPathToPath(
            Path.posix.relative(workspacePath, absolutePath),
          );

          return simpleGitObject
            .show([`${commit}:${relativePath}`])
            .then(content => new TextEncoder().encode(content));
        } catch (e) {
          continue;
        }
      }
    }

    return new TextEncoder().encode('');
  }

  writeFile(
    uri: vscode.Uri,
    content: Uint8Array,
    options: {create: boolean; overwrite: boolean},
  ): void | Thenable<void> {
    return this._writeFile(uri, content, options);
  }

  async _writeFile(
    uri: vscode.Uri,
    content: Uint8Array,
    options: {create: boolean; overwrite: boolean},
  ): Promise<void> {
    const exists = await _.exists(uri.fsPath);
    if (!exists) {
      if (!options.create) {
        throw vscode.FileSystemError.FileNotFound();
      }

      await _.mkdir(Path.dirname(uri.fsPath));
    } else {
      if (!options.overwrite) {
        throw vscode.FileSystemError.FileExists();
      }
    }

    return _.writefile(uri.fsPath, content as Buffer);
  }

  delete(
    uri: vscode.Uri,
    options: {recursive: boolean},
  ): void | Thenable<void> {
    if (options.recursive) {
      return _.rmrf(uri.fsPath);
    }

    return _.unlink(uri.fsPath);
  }

  rename(
    oldUri: vscode.Uri,
    newUri: vscode.Uri,
    options: {overwrite: boolean},
  ): void | Thenable<void> {
    return this._rename(oldUri, newUri, options);
  }

  async _rename(
    oldUri: vscode.Uri,
    newUri: vscode.Uri,
    options: {overwrite: boolean},
  ): Promise<void> {
    const exists = await _.exists(newUri.fsPath);
    if (exists) {
      if (!options.overwrite) {
        throw vscode.FileSystemError.FileExists();
      } else {
        await _.rmrf(newUri.fsPath);
      }
    }

    const parentExists = await _.exists(Path.dirname(newUri.fsPath));
    if (!parentExists) {
      await _.mkdir(Path.dirname(newUri.fsPath));
    }

    return _.rename(oldUri.fsPath, newUri.fsPath);
  }
}

//#region Utilities

export interface IStatAndLink {
  stat: fs.Stats;
  isSymbolicLink: boolean;
}

namespace _ {
  function handleResult<T>(
    resolve: (result: T) => void,
    reject: (error: Error) => void,
    error: Error | null | undefined,
    result: T | undefined,
  ): void {
    if (error) {
      reject(messageError(error));
    } else {
      resolve(result!);
    }
  }

  function messageError(error: Error & {code?: string}): Error {
    if (error.code === 'ENOENT') {
      return vscode.FileSystemError.FileNotFound();
    }

    if (error.code === 'EISDIR') {
      return vscode.FileSystemError.FileIsADirectory();
    }

    if (error.code === 'EEXIST') {
      return vscode.FileSystemError.FileExists();
    }

    if (error.code === 'EPERM' || error.code === 'EACCESS') {
      return vscode.FileSystemError.NoPermissions();
    }

    return error;
  }

  export function checkCancellation(token: vscode.CancellationToken): void {
    if (token.isCancellationRequested) {
      throw new Error('Operation cancelled');
    }
  }

  export function normalizeNFC(items: string): string;
  export function normalizeNFC(items: string[]): string[];
  export function normalizeNFC(items: string | string[]): string | string[] {
    if (process.platform !== 'darwin') {
      return items;
    }

    if (Array.isArray(items)) {
      return items.map(item => item.normalize('NFC'));
    }

    return items.normalize('NFC');
  }

  export function readdir(path: string): Promise<string[]> {
    return new Promise<string[]>((resolve, reject) => {
      fs.readdir(path, (error, children) =>
        handleResult(resolve, reject, error, normalizeNFC(children)),
      );
    });
  }

  export function readfile(path: string): Promise<Buffer> {
    return new Promise<Buffer>((resolve, reject) => {
      fs.readFile(path, (error, buffer) =>
        handleResult(resolve, reject, error, buffer),
      );
    });
  }

  export function writefile(path: string, content: Buffer): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      fs.writeFile(path, content, error =>
        handleResult(resolve, reject, error, void 0),
      );
    });
  }

  export function exists(path: string): Promise<boolean> {
    return new Promise<boolean>((resolve, reject) => {
      fs.exists(path, exists => handleResult(resolve, reject, null, exists));
    });
  }

  export function rmrf(path: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      rimraf(path, error => handleResult(resolve, reject, error, void 0));
    });
  }

  export function mkdir(path: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      mkdirp(path).catch(error => handleResult(resolve, reject, error, void 0));
    });
  }

  export function rename(oldPath: string, newPath: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      fs.rename(oldPath, newPath, error =>
        handleResult(resolve, reject, error, void 0),
      );
    });
  }

  export function unlink(path: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      fs.unlink(path, error => handleResult(resolve, reject, error, void 0));
    });
  }

  export function statLink(path: string): Promise<IStatAndLink> {
    return new Promise<IStatAndLink>((resolve, reject) => {
      fs.lstat(path, (error, lstat) => {
        if (error || lstat.isSymbolicLink()) {
          fs.stat(path, (error, stat) => {
            if (error) {
              return handleResult(resolve, reject, error, void 0);
            }

            handleResult(resolve, reject, error, {
              stat,
              isSymbolicLink: lstat && lstat.isSymbolicLink(),
            });
          });
        } else {
          handleResult(resolve, reject, error, {
            stat: lstat,
            isSymbolicLink: false,
          });
        }
      });
    });
  }
}

export class FileStat implements vscode.FileStat {
  constructor(private fsStat: fs.Stats, private _isSymbolicLink: boolean) {}

  get type(): vscode.FileType {
    let type: number;
    if (this._isSymbolicLink) {
      type =
        vscode.FileType.SymbolicLink |
        (this.fsStat.isDirectory()
          ? vscode.FileType.Directory
          : vscode.FileType.File);
    } else {
      type = this.fsStat.isFile()
        ? vscode.FileType.File
        : this.fsStat.isDirectory()
        ? vscode.FileType.Directory
        : vscode.FileType.Unknown;
    }

    return type;
  }

  get isFile(): boolean | undefined {
    return this.fsStat.isFile();
  }

  get isDirectory(): boolean | undefined {
    return this.fsStat.isDirectory();
  }

  get isSymbolicLink(): boolean | undefined {
    return this._isSymbolicLink;
  }

  get size(): number {
    return this.fsStat.size;
  }

  get ctime(): number {
    return this.fsStat.ctime.getTime();
  }

  get mtime(): number {
    return this.fsStat.mtime.getTime();
  }
}

//#endregion
