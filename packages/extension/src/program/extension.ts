import * as _ from 'lodash';
import minimatch from 'minimatch';
import * as Path from 'path';
import {SimpleGit} from 'simple-git';
import {TextEncoder} from 'util';
import * as vscode from 'vscode';

import {
  CONFIG_FILENAME,
  README_FILE_NAMES,
  READMEInfo,
  UserInfo,
  pathToPosixPath,
  posixPathToPath,
  getSimpleGitObject,
} from 'please-readme.lib';

import {FileSystemProvider} from './file-system-provider';

interface PleaseREADMEConfig {
  files: READMEInfo[];
  users: UserInfo[];
}

let pleaseREADMEConfigs: {[path: string]: PleaseREADMEConfig} = {};

let workspacePathToGitDict: {[workspacePath: string]: SimpleGit} = {};

let workspacePathToWatchDisposableDict: {
  [workspacePath: string]: vscode.Disposable;
} = {};

async function readCacheFile(uri: vscode.Uri): Promise<void> {
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

      if (configModified) {
        await writeToCacheFile(workspacePath);
      }
    } catch (e) {
      console.error(`The config file ${path} is not valid.\n`, e);
    }
  } else {
    console.error(
      'This README file',
      path,
      'does not belong to any workspace.',
    );
  }
}

function deleteCacheFile(uri: vscode.Uri): void {
  let workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);

  let path = uri.path;

  if (workspaceFolder) {
    try {
      delete pleaseREADMEConfigs[workspaceFolder.uri.path];
    } catch (e) {
      console.error(`The config file ${path} deletion has not succeeded.\n`, e);
    }
  } else {
    console.error(
      'This README file',
      path,
      'does not belong to any workspace.',
    );
  }
}

async function loadREADMEFile(absolutePath: string): Promise<void> {
  let workspaceFolders = vscode.workspace.workspaceFolders?.filter(
    workspaceFolder => absolutePath.startsWith(workspaceFolder.uri.path),
  );

  if (workspaceFolders) {
    let filesPatterns = [];

    let readmeContent = (
      await vscode.workspace.fs.readFile(
        vscode.Uri.from({scheme: 'file', path: absolutePath}),
      )
    ).toString();

    let readmeParts = readmeContent.split(/<!--/g);

    for (let i = 1; i < readmeParts.length; ++i) {
      let parts = readmeParts[i].split(/-->/g);

      if (parts.length <= 1) {
        continue;
      }

      let matchResult = parts[0].match(/\s*readme\s*\:\s*(.+\S)\s*/);

      if (matchResult && matchResult.length >= 2) {
        filesPatterns.push(matchResult[1].split(Path.sep).join(Path.posix.sep));
      }
    }

    for (let workspaceFolder of workspaceFolders) {
      let workspacePath = workspaceFolder.uri.path;
      let relativePath = Path.posix.relative(workspacePath, absolutePath);

      let commit: string = '';

      let simpleGitObject = workspacePathToGitDict[workspacePath];

      if (!simpleGitObject) {
        continue;
      }

      try {
        let diffResult = await simpleGitObject.diff([relativePath]);

        if (diffResult) {
          commit = '';
        } else {
          let logResult = await simpleGitObject.log({
            file: posixPathToPath(absolutePath),
          });

          commit = logResult.latest === null ? '' : logResult.latest.hash;
        }
      } catch (e) {
        if (
          !(e as any)
            .toString()
            .startsWith(
              "Error: fatal: your current branch 'master' does not have any commits yet",
            )
        ) {
          console.error('get log failed.\n', e);
        }
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
  } else {
    console.error('no project found for README file:', absolutePath);
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

      if (!readme) {
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

      if (readme.commit === '') {
        await writeToCacheFile(workspacePath);

        continue;
      }

      let file = _.find(user.files, {path: relativePath});

      if (!file) {
        user.files.push({path: relativePath, commit: readme.commit});
      } else if (file.commit !== readme.commit) {
        file.commit = readme.commit;
      }

      await writeToCacheFile(workspacePath);
    }
  }
}

function deleteREADMEFile(absolutePath: string) {
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
        console.error(
          'Deleting a README file which is not inspected by PleaseREADME.',
        );
      }
    }
  } else {
    console.error('No workspace when deleting README file saved in RAM.');
  }
}

async function loadCacheFile(workspacePath: string) {
  let cacheFilePath = Path.posix.resolve(workspacePath, CONFIG_FILENAME);

  try {
    let stat = await vscode.workspace.fs.stat(
      vscode.Uri.from({scheme: 'file', path: cacheFilePath}),
    );

    if (stat.type === vscode.FileType.File) {
      await readCacheFile(
        vscode.Uri.from({scheme: 'file', path: cacheFilePath}),
      );
    }
  } catch (e) {
    console.error(
      `load config file of workspace ${workspacePath} failed.\n`,
      e,
    );
  }
}

async function loadCacheFiles() {
  let workspaceFolders = vscode.workspace.workspaceFolders;

  if (workspaceFolders) {
    for (let workspaceFolder of workspaceFolders) {
      loadCacheFile(workspaceFolder.uri.path);
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
      console.error('walk through files error.\n', e);

      return;
    }
  }

  if (
    fileType === vscode.FileType.File ||
    fileType === vscode.FileType.SymbolicLink
  ) {
    if (README_FILE_NAMES.includes(Path.posix.basename(path))) {
      await loadREADMEFile(path);
    }
  } else {
    for (let [filePath, newFileType] of await vscode.workspace.fs.readDirectory(
      vscode.Uri.from({scheme: 'file', path}),
    )) {
      await walkThroughFilesToLoadREADME(
        Path.posix.resolve(path, filePath),
        newFileType,
      );
    }
  }
}

async function loadFiles(): Promise<void> {
  await loadCacheFiles();

  for (let workspaceFolder of vscode.workspace.workspaceFolders || []) {
    await walkThroughFilesToLoadREADME(workspaceFolder.uri.path);
  }
}

async function writeToCacheFile(workspacePath: string) {
  let pleaseREADMEConfig = pleaseREADMEConfigs[workspacePath] || {
    files: [],
    users: [],
  };
  let pleaseREADMEConfigsClone: any = {users: pleaseREADMEConfig.users};
  let uri = vscode.Uri.from({
    scheme: 'file',
    path: Path.posix.resolve(workspacePath, CONFIG_FILENAME),
  });

  let stringToWrite = JSON.stringify(pleaseREADMEConfigsClone, undefined, 2);

  let cacheFileContent = (await vscode.workspace.fs.readFile(uri)).toString();

  if (stringToWrite !== cacheFileContent) {
    await vscode.workspace.fs.writeFile(
      uri,
      new TextEncoder().encode(stringToWrite),
    );
  }
}

async function writeToCacheFiles() {
  for (const workspacePath of Object.keys(pleaseREADMEConfigs)) {
    await writeToCacheFile(workspacePath);
  }
}

async function hintIfNotRead(absolutePath: string) {
  for (let [workspacePath, config] of Object.entries(pleaseREADMEConfigs)) {
    if (!absolutePath.startsWith(workspacePath)) {
      continue;
    }

    let simpleGitObject = workspacePathToGitDict[workspacePath];

    if (!simpleGitObject) {
      continue;
    }

    let username = (await simpleGitObject.getConfig('user.name')).value;
    let email = (await simpleGitObject.getConfig('user.email')).value;

    if (!username || !email) {
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

      await writeToCacheFile(workspacePath);
    }

    for (let readme of config.files) {
      // if the readme has been modified by this user, do not hint
      if (readme.commit === '') {
        continue;
      }

      // if the readme has been read, do not hint
      let file = _.find(user.files, {path: readme.path, commit: readme.commit});

      if (file) {
        continue;
      }

      file = _.find(user.files, {path: readme.path});

      try {
        let logResult = await simpleGitObject.log({file: readme.path});

        if (file) {
          for (let commitInfo of logResult.all) {
            if (
              username === commitInfo.author_name &&
              email === commitInfo.author_email
            ) {
              let count = await simpleGitObject.raw(
                'rev-list',
                `${file.commit}..${commitInfo.hash}`,
                '--count',
              );

              if (Number(count) > 0) {
                file.commit = commitInfo.hash;

                await writeToCacheFile(workspacePath);
              }

              break;
            }
          }
        } else {
          for (let commitInfo of logResult.all) {
            if (
              username === commitInfo.author_name &&
              email === commitInfo.author_email
            ) {
              file = {path: readme.path, commit: commitInfo.hash};

              user.files.push(file);

              await writeToCacheFile(workspacePath);

              break;
            }
          }
        }
      } catch (e) {
        console.error(
          'Searching for latest README modification by current user failed.\n',
          e,
        );
      }

      if (file?.commit === readme.commit) {
        continue;
      }

      let readmeAbsolutePath = Path.posix.join(workspacePath, readme.path);

      let relativePath = Path.posix.relative(
        Path.posix.dirname(readmeAbsolutePath),
        absolutePath,
      );

      for (let filesPattern of readme.filesPatterns) {
        if (minimatch(relativePath, filesPattern)) {
          await writeToCacheFile(workspacePath);

          let result = await vscode.window.showInformationMessage(
            `Please read the README of file ${absolutePath}.`,
            'OK',
            'Read Later',
          );

          if (result === 'OK') {
            let commit = _.find(user.files, {path: readme.path})?.commit;

            if (!commit) {
              await vscode.window
                .showTextDocument(
                  vscode.Uri.from({scheme: 'file', path: readmeAbsolutePath}),
                )
                .then(() => {}, console.error);
            } else {
              await vscode.commands.executeCommand(
                'vscode.diff',
                vscode.Uri.from({
                  scheme: 'readme',
                  path: readmeAbsolutePath,
                  query: JSON.stringify({commit}),
                }),
                vscode.Uri.from({scheme: 'file', path: readmeAbsolutePath}),
              );
            }
          }

          break;
        }
      }
    }
  }
}

async function handleSpecialFilesAndConditionalHint(
  uri: vscode.Uri,
  eventType: vscode.FileChangeType | 4,
) {
  let filePath = uri.path;
  let fileName = Path.posix.basename(filePath);

  if (fileName === CONFIG_FILENAME) {
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
        console.error('Unexpected event type!');

        break;
    }
  } else if (README_FILE_NAMES.includes(fileName)) {
    switch (eventType) {
      case vscode.FileChangeType.Changed:
      case vscode.FileChangeType.Created:
      case 4:
        await loadREADMEFile(filePath);
        await readREADMEFile(filePath);

        break;

      case vscode.FileChangeType.Deleted:
        deleteREADMEFile(filePath);

        break;

      default:
        console.error('Unexpected event type!');

        break;
    }
  }

  await hintIfNotRead(filePath);
}

export async function activate(context: vscode.ExtensionContext) {
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
    vscode.workspace.onDidChangeWorkspaceFolders(event => {
      for (let addedWorkspace of event.added) {
        let addedWorkspacePath = addedWorkspace.uri.path;
        let disposable = fsp.watch(addedWorkspace.uri);

        context.subscriptions.push(disposable);

        workspacePathToWatchDisposableDict[addedWorkspacePath] = disposable;

        loadCacheFile(addedWorkspacePath);

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

  await loadFiles();

  await writeToCacheFiles();

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

  for (let document of vscode.workspace.textDocuments) {
    let absolutePath = pathToPosixPath(document.fileName);

    if (absolutePath === Path.posix.basename(absolutePath)) {
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

export function deactivate() {}
