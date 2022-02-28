import * as Path from 'path';
import {TextEncoder} from 'util';

import * as _ from 'lodash';
import minimatch from 'minimatch';
import {
  CACHE_FILENAME,
  READMEInfo,
  README_FILE_NAMES,
  UserInfo,
  getFilesPatternsOfREADME,
  getSimpleGitObject,
  pathToPosixPath,
  posixPathToPath,
} from 'rtf-readme';
import {SimpleGit} from 'simple-git';

import * as vscode from 'vscode';

import {FileSystemProvider} from './file-system-provider';

let output!: vscode.OutputChannel;

let loadREADMEFilePromises: Promise<boolean>[] = [];

let writeToCacheFilePromise: Promise<void> = Promise.resolve();

interface PleaseREADMEConfig {
  files: READMEInfo[];
  users: UserInfo[];
}

let pleaseREADMEConfigs: {[path: string]: PleaseREADMEConfig} = {};

let workspacePathToGitDict: {[workspacePath: string]: SimpleGit} = {};

let workspacePathToWatchDisposableDict: {
  [workspacePath: string]: vscode.Disposable;
} = {};

async function readCacheFile(
  uri: vscode.Uri,
  doNotWrite: boolean = false,
): Promise<void> {
  let workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);

  let path = uri.path;

  if (workspaceFolder) {
    let workspacePath = workspaceFolder.uri.path;
    let simpleGitObject = workspacePathToGitDict[workspacePath];

    try {
      let config =
        (JSON.parse(
          (await vscode.workspace.fs.readFile(uri)).toString(),
        ) as PleaseREADMEConfig) || {};

      config.users = config.users || [];

      let configModified = false;

      for (let user of config.users) {
        if (!user.name || !user.email) {
          throw Error('Invalid user name or email.');
        }

        user.files = user.files || [];

        if (user.files.length <= 1) {
          continue;
        }

        let groups = _.groupBy(user.files, 'path');

        let userFiles = [];

        for (let [, group] of Object.entries(groups)) {
          let file = group[0];

          if (group.length === 1) {
            userFiles.push(file);

            continue;
          }

          for (let iterFile of group) {
            if (file.commit === iterFile.commit) {
              continue;
            }

            let count = await simpleGitObject.raw(
              'rev-list',
              `${file.commit}..${iterFile.commit}`,
              '--count',
            );

            if (Number(count) > 0) {
              file = iterFile;
            }
          }

          userFiles.push(file);
        }

        if (!_.isEqual(user.files, userFiles)) {
          configModified = true;

          user.files = userFiles;
        }
      }

      if (pleaseREADMEConfigs[workspacePath]) {
        pleaseREADMEConfigs[workspacePath].users = config.users;
      } else {
        pleaseREADMEConfigs[workspacePath] = {users: config.users, files: []};
      }

      if (!doNotWrite && configModified) {
        writeToCacheFileWithPromise(workspacePath);
      }
    } catch (e) {
      output.appendLine(
        `The config file ${path} is not valid.\n${(e as any).toString()}`,
      );
    }
  } else {
    output.appendLine(
      `This README file ${path} does not belong to any workspace.`,
    );
  }
}

function deleteCacheFile(uri: vscode.Uri): void {
  let workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);

  let path = uri.path;

  if (workspaceFolder) {
    try {
      pleaseREADMEConfigs[workspaceFolder.uri.path].users = [];
    } catch (e) {
      output.appendLine(
        `The config file ${path} deletion has not succeeded.\n${(
          e as any
        ).toString()}`,
      );
    }
  } else {
    output.appendLine(
      `This README file ${path} does not belong to any workspace.`,
    );
  }
}

async function loadREADMEFile(absolutePath: string): Promise<boolean> {
  let workspaceFolders = vscode.workspace.workspaceFolders?.filter(
    workspaceFolder => absolutePath.startsWith(workspaceFolder.uri.path),
  );

  if (workspaceFolders) {
    let readmeContent = (
      await vscode.workspace.fs.readFile(
        vscode.Uri.from({scheme: 'file', path: absolutePath}),
      )
    ).toString();
    let filesPatterns = getFilesPatternsOfREADME(readmeContent);

    if (filesPatterns.length === 0) {
      for (let workspaceFolder of workspaceFolders) {
        let workspacePath = workspaceFolder.uri.path;
        let relativePath = Path.posix.relative(workspacePath, absolutePath);

        if (pleaseREADMEConfigs[workspacePath]) {
          _.remove(pleaseREADMEConfigs[workspacePath].files, {
            path: relativePath,
          });
        }
      }

      return false;
    }

    for (let workspaceFolder of workspaceFolders) {
      let workspacePath = workspaceFolder.uri.path;
      let relativePath = Path.posix.relative(workspacePath, absolutePath);

      let commit: string | undefined;

      let simpleGitObject = workspacePathToGitDict[workspacePath];

      if (!simpleGitObject) {
        continue;
      }

      try {
        let logResult = _.compact(
          (
            await simpleGitObject.raw(
              'log',
              '-1',
              '--pretty=format:%H',
              posixPathToPath(absolutePath),
            )
          ).split('\n'),
        );

        commit = logResult[0];
      } catch (e) {
        if (
          !(e as any)
            .toString()
            .startsWith(
              "Error: fatal: your current branch 'master' does not have any commits yet",
            )
        ) {
          output.appendLine(`get log failed.\n${(e as any).toString()}`);
        }
      }

      if (commit === undefined) {
        continue;
      }

      if (!pleaseREADMEConfigs[workspacePath]) {
        pleaseREADMEConfigs[workspacePath] = {
          files: [
            {
              path: relativePath,
              filesPatterns,
              commit,
            },
          ],
          users: [],
        };
      } else {
        let readmeInfoIndex = _.findIndex(
          pleaseREADMEConfigs[workspacePath].files,
          {
            path: relativePath,
          },
        );

        if (readmeInfoIndex === -1) {
          pleaseREADMEConfigs[workspacePath].files.push({
            path: relativePath,
            filesPatterns,
            commit,
          });
        } else {
          pleaseREADMEConfigs[workspacePath].files[readmeInfoIndex] = {
            path: relativePath,
            filesPatterns,
            commit,
          };
        }
      }
    }

    return true;
  } else {
    output.appendLine(`no project found for README file: ${absolutePath}`);

    return false;
  }
}

async function readREADMEFile(absolutePath: string): Promise<void> {
  let workspaceFolders = vscode.workspace.workspaceFolders?.filter(
    workspaceFolder => absolutePath.startsWith(workspaceFolder.uri.path),
  );

  if (workspaceFolders) {
    for (let workspaceFolder of workspaceFolders) {
      let workspacePath = workspaceFolder.uri.path;

      let simpleGitObject = workspacePathToGitDict[workspacePath];

      if (!simpleGitObject) {
        continue;
      }

      let username = (await simpleGitObject.getConfig('user.name')).value;
      let email = (await simpleGitObject.getConfig('user.email')).value;

      if (!username || !email) {
        continue;
      }

      let relativePath = Path.posix.relative(workspacePath, absolutePath);

      let config = pleaseREADMEConfigs[workspacePath];

      if (!config) {
        config = {
          files: [],
          users: [],
        };

        pleaseREADMEConfigs[workspacePath] = config;
      }

      let readme = _.find(config.files, {path: relativePath});

      if (!readme || !readme.commit) {
        continue;
      }

      let user = _.find(config.users, {name: username, email});

      if (!user) {
        user = {
          name: username,
          email,
          files: [],
        };

        config.users.push(user);
      }

      let file = _.find(user.files, {path: relativePath});

      if (!file) {
        user.files.push({path: relativePath, commit: readme.commit});
      } else if (file.commit !== readme.commit) {
        file.commit = readme.commit;
      }

      writeToCacheFileWithPromise(workspacePath, true);
    }
  }
}

function deleteREADMEFile(absolutePath: string): void {
  let workspaceFolders = vscode.workspace.workspaceFolders?.filter(
    workspaceFolder => absolutePath.startsWith(workspaceFolder.uri.path),
  );

  if (workspaceFolders) {
    for (let workspaceFolder of workspaceFolders) {
      let workspacePath = workspaceFolder.uri.path;

      let readmes = pleaseREADMEConfigs[workspacePath].files;

      if (readmes) {
        pleaseREADMEConfigs[workspacePath].files = readmes.filter(
          readme =>
            readme.path !== Path.posix.relative(workspacePath, absolutePath),
        );
      } else {
        output.appendLine(
          'Deleting a README file which is not inspected by PleaseREADME.',
        );
      }
    }
  } else {
    output.appendLine('No workspace when deleting README file saved in RAM.');
  }
}

async function loadCacheFile(workspacePath: string): Promise<void> {
  let cacheFilePath = Path.posix.resolve(workspacePath, CACHE_FILENAME);
  let uri = vscode.Uri.from({scheme: 'file', path: cacheFilePath});

  try {
    let stat = await vscode.workspace.fs.stat(uri);

    if (stat.type === vscode.FileType.File) {
      await readCacheFile(uri, true);
    }
  } catch (e) {
    output.appendLine(
      `load config file of workspace ${workspacePath} failed.\n${(
        e as any
      ).toString()}`,
    );
  }
}

async function loadCacheFiles(): Promise<void> {
  let workspaceFolders = vscode.workspace.workspaceFolders;

  if (workspaceFolders) {
    for (let workspaceFolder of workspaceFolders) {
      await loadCacheFile(workspaceFolder.uri.path);
    }
  }
}

async function walkThroughFilesToLoadREADME(
  path: string,
  fileType?: vscode.FileType,
): Promise<void> {
  if (!fileType) {
    try {
      let stat = await vscode.workspace.fs.stat(
        vscode.Uri.from({scheme: 'file', path}),
      );

      fileType = stat.type;
    } catch (e) {
      output.appendLine(`walk through files error.\n${(e as any).toString()}`);

      return;
    }
  }

  if (
    fileType === vscode.FileType.File ||
    fileType === vscode.FileType.SymbolicLink
  ) {
    if (README_FILE_NAMES.includes(Path.posix.basename(path))) {
      loadREADMEFilePromises.push(loadREADMEFile(path));
    }
  } else {
    for (let [filePath, newFileType] of await vscode.workspace.fs.readDirectory(
      vscode.Uri.from({scheme: 'file', path}),
    )) {
      if (!filePath.endsWith('node_modules') && !filePath.endsWith('.git')) {
        await walkThroughFilesToLoadREADME(
          Path.posix.resolve(path, filePath),
          newFileType,
        );
      }
    }
  }
}

async function loadFiles(): Promise<void> {
  await loadCacheFiles();

  for (let workspaceFolder of vscode.workspace.workspaceFolders || []) {
    await walkThroughFilesToLoadREADME(workspaceFolder.uri.path);
  }
}

async function writeToCacheFile(
  workspacePath: string,
  mustWriteFile: boolean,
): Promise<void> {
  let pleaseREADMEConfig = pleaseREADMEConfigs[workspacePath] || {
    files: [],
    users: [],
  };
  let pleaseREADMEConfigsClone: any = {users: pleaseREADMEConfig.users};
  let uri = vscode.Uri.from({
    scheme: 'file',
    path: Path.posix.resolve(workspacePath, CACHE_FILENAME),
  });

  let stringToWrite = JSON.stringify(pleaseREADMEConfigsClone, undefined, 2);

  try {
    let cacheFileContent = (await vscode.workspace.fs.readFile(uri)).toString();

    if (stringToWrite !== cacheFileContent) {
      await vscode.workspace.fs.writeFile(
        uri,
        new TextEncoder().encode(stringToWrite),
      );
    }
  } catch (e) {
    let errorMessage = (e as any).toString();

    if (errorMessage.startsWith('EntryNotFound')) {
      if (mustWriteFile) {
        await vscode.workspace.fs.writeFile(
          uri,
          new TextEncoder().encode(stringToWrite),
        );
      }
    } else {
      output.appendLine(`write to cache failed. ${errorMessage}`);
    }
  }
}

function writeToCacheFileWithPromise(
  workspacePath: string,
  mustWriteFile: boolean = true,
): void {
  writeToCacheFilePromise = writeToCacheFilePromise
    .then(() => writeToCacheFile(workspacePath, mustWriteFile))
    .then(
      () => {},
      err => err,
    )
    .then(err => err && output.appendLine(err.toString()));
}

async function writeToCacheFiles(): Promise<void> {
  for (const workspacePath of Object.keys(pleaseREADMEConfigs)) {
    writeToCacheFileWithPromise(workspacePath, false);
  }
}

async function hintIfNotRead(absolutePath: string): Promise<void> {
  for (let [workspacePath, config] of Object.entries(pleaseREADMEConfigs)) {
    if (!absolutePath.startsWith(workspacePath)) {
      continue;
    }

    let simpleGitObject = workspacePathToGitDict[workspacePath];

    if (!simpleGitObject) {
      continue;
    }

    let username: string | null | undefined, email: string | null | undefined;

    for (let readme of config.files) {
      if (readme.filesPatterns.length === 0) {
        continue;
      }

      let matched: boolean = false;
      let readmeAbsolutePath = Path.posix.join(workspacePath, readme.path);
      let readmeDirPath = Path.posix.dirname(readmeAbsolutePath);

      for (let filesPattern of readme.filesPatterns) {
        if (
          minimatch(absolutePath, Path.posix.join(readmeDirPath, filesPattern))
        ) {
          matched = true;

          break;
        }
      }

      if (!matched) {
        continue;
      }

      if (username === undefined && email === undefined) {
        username = (await simpleGitObject.raw('config', 'user.name')).trim();
        email = (await simpleGitObject.raw('config', 'user.email')).trim();
      }

      if (!username || !email) {
        break;
      }

      let user = _.find(config.users, {name: username, email});

      if (!user) {
        user = {
          name: username,
          email,
          files: [],
        };

        config.users.push(user);

        writeToCacheFileWithPromise(workspacePath, false);
      }

      // if the readme has been read, do not hint
      let file = _.find(user.files, {path: readme.path, commit: readme.commit});

      if (file) {
        continue;
      }

      file = _.cloneDeep(_.find(user.files, {path: readme.path}));

      try {
        let readmeCommitsByThisUser = _.compact(
          (
            await simpleGitObject.raw(
              'log',
              '-1',
              `--author=${user.name} <${user.email}>`,
              '--pretty=format:%H',
              readme.path,
            )
          ).split('\n'),
        );

        if (readmeCommitsByThisUser.length > 0) {
          if (file) {
            let count = await simpleGitObject.raw(
              'rev-list',
              `${file.commit}..${readmeCommitsByThisUser[0]}`,
              '--count',
            );

            if (Number(count) > 0) {
              file.commit = readmeCommitsByThisUser[0];
            }
          } else {
            file = {path: readme.path, commit: readmeCommitsByThisUser[0]};
          }
        }
      } catch (e) {
        output.appendLine(
          `Searching for latest README modification by current user failed.\n${(
            e as any
          ).toString()}`,
        );
      }

      if (file?.commit === readme.commit) {
        continue;
      }

      let result = await vscode.window.showInformationMessage(
        `Please read the f***ing README "${
          readme.path
        }" for file: ${Path.posix.relative(workspacePath, absolutePath)}.`,
        'Open',
        'Read Later',
      );

      if (result === 'Open') {
        let commit = _.find(user.files, {path: readme.path})?.commit;

        if (!commit) {
          await vscode.window
            .showTextDocument(
              vscode.Uri.from({scheme: 'file', path: readmeAbsolutePath}),
            )
            .then(
              () => {},
              err => output.appendLine(err.toString()),
            );
        } else {
          await vscode.commands
            .executeCommand(
              'vscode.diff',
              vscode.Uri.from({
                scheme: 'readme',
                path: readmeAbsolutePath,
                query: JSON.stringify({commit}),
              }),
              vscode.Uri.from({scheme: 'file', path: readmeAbsolutePath}),
            )
            .then(
              () => {},
              err => output.appendLine(err.toString()),
            );
        }
      }
    }
  }
}

async function handleSpecialFilesAndConditionalHint(
  uri: vscode.Uri,
  eventType: vscode.FileChangeType | 4,
): Promise<void> {
  let filePath = uri.path;
  let fileName = Path.posix.basename(filePath);

  if (fileName === CACHE_FILENAME) {
    switch (eventType) {
      case vscode.FileChangeType.Changed:
      case vscode.FileChangeType.Created:
      case 4:
        await readCacheFile(uri);

        break;

      case vscode.FileChangeType.Deleted:
        deleteCacheFile(uri);

        break;

      default:
        output.appendLine('Unexpected event type!');

        break;
    }
  } else if (README_FILE_NAMES.includes(fileName)) {
    switch (eventType) {
      case vscode.FileChangeType.Changed:
      case vscode.FileChangeType.Created:
      case 4:
        if (await loadREADMEFile(filePath)) {
          await readREADMEFile(filePath);
        }

        break;

      case vscode.FileChangeType.Deleted:
        deleteREADMEFile(filePath);

        break;

      default:
        output.appendLine('Unexpected event type!');

        break;
    }
  }

  await hintIfNotRead(filePath);
}

export async function activate(
  context: vscode.ExtensionContext,
): Promise<void> {
  output = vscode.window.createOutputChannel('rtf-README');

  let fsp = new FileSystemProvider();

  context.subscriptions.push(
    vscode.workspace.registerFileSystemProvider('readme', fsp, {
      isCaseSensitive: process.platform === 'linux',
    }),
  );

  context.subscriptions.push(
    fsp.onDidChangeFile(async events => {
      for (let event of events) {
        let eventWithFilePath = event as vscode.FileChangeEvent & {
          filePath: string;
          fileType: 'file' | 'dir';
        };

        let uri = vscode.Uri.from({
          scheme: 'file',
          path: eventWithFilePath.filePath,
        });

        if (eventWithFilePath.fileType === 'file') {
          await handleSpecialFilesAndConditionalHint(uri, event.type);
        }
      }
    }),
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(async event => {
      for (let addedWorkspace of event.added) {
        let addedWorkspacePath = addedWorkspace.uri.path;
        let disposable = fsp.watch(addedWorkspace.uri);

        context.subscriptions.push(disposable);

        workspacePathToWatchDisposableDict[addedWorkspacePath] = disposable;

        await loadCacheFile(addedWorkspacePath);

        let simpleGitObject: SimpleGit | undefined = getSimpleGitObject(
          posixPathToPath(addedWorkspacePath),
        );

        if (!simpleGitObject) {
          continue;
        }

        workspacePathToGitDict[addedWorkspacePath] = simpleGitObject;
      }

      for (let removedWorkspace of event.removed) {
        let removedWorkspacePath = removedWorkspace.uri.path;
        let disposable =
          workspacePathToWatchDisposableDict[removedWorkspacePath];

        if (disposable) {
          _.remove(context.subscriptions, disposable);

          disposable.dispose();

          delete workspacePathToWatchDisposableDict[removedWorkspacePath];
        }

        if (pleaseREADMEConfigs[removedWorkspacePath]) {
          delete pleaseREADMEConfigs[removedWorkspacePath];
        }

        if (workspacePathToGitDict[removedWorkspacePath]) {
          delete workspacePathToGitDict[removedWorkspacePath];
        }
      }
    }),
  );

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(async e => {
      if (e) {
        let filePath = e.document.uri.path;
        let fileName = Path.posix.basename(filePath);

        if (README_FILE_NAMES.includes(fileName)) {
          await readREADMEFile(filePath);
        }

        await hintIfNotRead(filePath);
      }
    }),
  );

  for (let workspaceFolder of vscode.workspace.workspaceFolders || []) {
    let workspacePosixPath = workspaceFolder.uri.path;
    let workspacePath = posixPathToPath(workspacePosixPath);

    let simpleGitObject: SimpleGit | undefined =
      getSimpleGitObject(workspacePath);

    if (!simpleGitObject) {
      continue;
    }

    workspacePathToGitDict[workspacePosixPath] = simpleGitObject;
  }

  await loadFiles();

  await Promise.all(loadREADMEFilePromises);

  await writeToCacheFiles();

  for (let document of vscode.workspace.textDocuments) {
    let absolutePath = pathToPosixPath(document.fileName);

    if (absolutePath === Path.posix.basename(absolutePath)) {
      continue;
    }

    if (absolutePath.endsWith('.git')) {
      continue;
    }

    await handleSpecialFilesAndConditionalHint(
      vscode.Uri.from({scheme: 'file', path: absolutePath}),
      4,
    );
  }

  for (let workspaceFolder of vscode.workspace.workspaceFolders || []) {
    let disposable = fsp.watch(workspaceFolder.uri);

    context.subscriptions.push(disposable);

    workspacePathToWatchDisposableDict[workspaceFolder.uri.path] = disposable;
  }
}

export function deactivate(): void {}
