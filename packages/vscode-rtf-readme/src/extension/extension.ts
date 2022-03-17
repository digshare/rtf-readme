import * as Path from 'path';
import {TextEncoder} from 'util';

import * as _ from 'lodash';
import fetch from 'node-fetch';
import {
  CONFIG_FILENAME,
  DEFAULT_READMES_TO_BE_CONSIDERED,
  READMEInfo,
  README_MAX_NUMBER_OF_COMMITS_CONSIDERED,
  TransformedConfig,
  UserInfo,
  commitInputValidate,
  getFilesPatternsOfREADME,
  getGitUserInfo,
  getServeUrl,
  getSimpleGitObject,
  globMatch,
  pathToPosixPath,
  posixPathToPath,
  serverConfigValidate,
  tokenValidate,
} from 'rtf-readme';
import {SimpleGit} from 'simple-git';

import * as vscode from 'vscode';

import {FileSystemProvider} from './file-system-provider';

let output!: vscode.OutputChannel;

let loadREADMEFilePromises: Promise<boolean>[] = [];

let updateCacheFilePromise: Promise<void> = Promise.resolve();

interface RTFREADMECache {
  files: READMEInfo[];
  users: UserInfo[];
}

let workspacePathToConfigDict: {[path: string]: TransformedConfig} = {};
let workspacePathToRTFREADMECacheDict: {[path: string]: RTFREADMECache} = {};

let workspacePathToGitDict: {[workspacePath: string]: SimpleGit} = {};

let workspacePathToWatchDisposableDict: {
  [workspacePath: string]: vscode.Disposable;
} = {};

enum FileOpenType {
  Opened = 4,
}

async function loadREADMEFile(
  absolutePosixPath: string,
  workspacePosixPath: string,
): Promise<boolean> {
  let readmeContent = (
    await vscode.workspace.fs.readFile(
      vscode.Uri.from({scheme: 'file', path: absolutePosixPath}),
    )
  ).toString();
  let filesPatterns = getFilesPatternsOfREADME(readmeContent);

  if (filesPatterns.length === 0) {
    let relativePath = Path.posix.relative(
      workspacePosixPath,
      absolutePosixPath,
    );

    if (workspacePathToRTFREADMECacheDict[workspacePosixPath]) {
      _.remove(workspacePathToRTFREADMECacheDict[workspacePosixPath].files, {
        path: relativePath,
      });
    }

    return false;
  }

  let relativePath = Path.posix.relative(workspacePosixPath, absolutePosixPath);

  let commit: string | undefined;

  let simpleGitObject = workspacePathToGitDict[workspacePosixPath];

  if (!simpleGitObject) {
    return true;
  }

  try {
    let logResult = _.compact(
      (
        await simpleGitObject.raw(
          'log',
          '-1',
          '--pretty=format:%H',
          posixPathToPath(absolutePosixPath),
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
    return true;
  }

  if (!workspacePathToRTFREADMECacheDict[workspacePosixPath]) {
    workspacePathToRTFREADMECacheDict[workspacePosixPath] = {
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
      workspacePathToRTFREADMECacheDict[workspacePosixPath].files,
      {
        path: relativePath,
      },
    );

    if (readmeInfoIndex === -1) {
      workspacePathToRTFREADMECacheDict[workspacePosixPath].files.push({
        path: relativePath,
        filesPatterns,
        commit,
      });
    } else {
      workspacePathToRTFREADMECacheDict[workspacePosixPath].files[
        readmeInfoIndex
      ] = {
        path: relativePath,
        filesPatterns,
        commit,
      };
    }
  }

  return true;
}

async function readREADMEFile(
  absolutePath: string,
  workspacePosixPath: string,
): Promise<void> {
  let simpleGitObject = workspacePathToGitDict[workspacePosixPath];

  if (!simpleGitObject) {
    return;
  }

  let {name: username, email} = await getGitUserInfo(simpleGitObject);

  if (!username || !email) {
    return;
  }

  let relativePath = Path.posix.relative(workspacePosixPath, absolutePath);

  let cache = workspacePathToRTFREADMECacheDict[workspacePosixPath];

  if (!cache) {
    cache = {
      files: [],
      users: [],
    };

    workspacePathToRTFREADMECacheDict[workspacePosixPath] = cache;
  }

  let readme = _.find(cache.files, {path: relativePath});

  if (!readme || !readme.commit) {
    return;
  }

  let user = _.find(cache.users, {name: username, email});

  if (!user) {
    user = {
      name: username,
      email,
      files: [],
    };

    cache.users.push(user);
  }

  let file = _.find(user.files, {path: relativePath});

  if (!file) {
    file = {path: relativePath, commit: readme.commit};

    user.files.push(file);
  } else if (file.commit !== readme.commit) {
    file.commit = readme.commit;
  }

  updateCacheFileWithPromise(workspacePosixPath, {
    name: user.name,
    email: user.email,
    files: [file],
  });

  output.appendLine(
    `${new Date().toLocaleString()}: README "${file.path}" read.`,
  );
}

function deleteREADMEFile(
  absolutePath: string,
  workspacePosixPath: string,
): void {
  let readmes = workspacePathToRTFREADMECacheDict[workspacePosixPath].files;

  if (readmes) {
    workspacePathToRTFREADMECacheDict[workspacePosixPath].files =
      readmes.filter(
        readme =>
          readme.path !== Path.posix.relative(workspacePosixPath, absolutePath),
      );
  } else {
    output.appendLine(
      'Deleting a README file which is not inspected by PleaseREADME.',
    );
  }
}

async function loadConfigAndGetCacheFile(workspacePath: string): Promise<void> {
  let configFilePath = Path.posix.resolve(workspacePath, CONFIG_FILENAME);
  let uri = vscode.Uri.from({scheme: 'file', path: configFilePath});

  try {
    let stat = await vscode.workspace.fs.stat(uri);

    if (stat.type === vscode.FileType.File) {
      let config = (workspacePathToConfigDict[workspacePath] =
        (JSON.parse(
          (await vscode.workspace.fs.readFile(uri)).toString(),
        ) as TransformedConfig) || {});

      let response = await fetch(getServeUrl(config));

      workspacePathToRTFREADMECacheDict[workspacePath] = {
        ...JSON.parse(await response.text()),
        files: [],
      };

      await walkThroughFilesToLoadREADME(workspacePath, workspacePath);

      await Promise.all(loadREADMEFilePromises);

      loadREADMEFilePromises = [];
    }
  } catch (e) {
    output.appendLine(
      `load config file and cache of workspace ${workspacePath} failed.\n${(
        e as any
      ).toString()}`,
    );
  }
}

function deleteConfigFile(workspacePath: string): void {
  delete workspacePathToConfigDict[workspacePath];

  delete workspacePathToRTFREADMECacheDict[workspacePath];
}

async function loadConfigAndGetCacheFiles(): Promise<void> {
  let workspaceFolders = vscode.workspace.workspaceFolders;

  if (workspaceFolders) {
    for (let workspaceFolder of workspaceFolders) {
      await loadConfigAndGetCacheFile(workspaceFolder.uri.path);
    }
  }
}

async function walkThroughFilesToLoadREADME(
  workspacePosixPath: string,
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

  let config = workspacePathToConfigDict[workspacePosixPath];

  if (
    fileType === vscode.FileType.File ||
    fileType === vscode.FileType.SymbolicLink
  ) {
    if (
      globMatch(
        path,
        workspacePosixPath,
        config.readme || [],
        config.ignore || [],
      )
    ) {
      loadREADMEFilePromises.push(loadREADMEFile(path, workspacePosixPath));
    }
  } else if (fileType === vscode.FileType.Directory) {
    for (let [fileName, newFileType] of await vscode.workspace.fs.readDirectory(
      vscode.Uri.from({scheme: 'file', path}),
    )) {
      let filePath = Path.posix.resolve(path, fileName);

      if (!globMatch(filePath, workspacePosixPath, config.ignore || [], [])) {
        await walkThroughFilesToLoadREADME(
          workspacePosixPath,
          filePath,
          newFileType,
        );
      }
    }
  }
}

async function loadFiles(): Promise<void> {
  await loadConfigAndGetCacheFiles();
}

async function updateCacheFile(
  workspacePath: string,
  userInfo: UserInfo,
): Promise<void> {
  let config = workspacePathToConfigDict[workspacePath];

  try {
    let response = await fetch(getServeUrl(config), {
      method: 'post',
      body: JSON.stringify(userInfo),
      headers: {'Content-Type': 'application/json'},
    });

    let responseString = await response.text();

    if (responseString === 'ok') {
      return;
    }

    if (responseString === 'Not Found') {
      output.appendLine(
        'Something is wrong on the server side. Did you create a token on the server side?',
      );

      return;
    }

    if (userInfo.files.length === 0) {
      output.appendLine(
        "When the length of files is 0, the server should return 'ok' as response.",
      );

      return;
    }

    let responseObject = JSON.parse(responseString);

    let simpleGitObject = workspacePathToGitDict[workspacePath];

    let readmeRelativePosixPath = userInfo.files[0].path;

    let filesNeededToBeDeleted: {path: string; commit: string}[] = [];

    let commits = _.compact(
      (
        await simpleGitObject.raw(
          'log',
          '--pretty=format:%H',
          readmeRelativePosixPath,
        )
      ).split('\n'),
    ).slice(1);

    for (let file of responseObject.files) {
      if (file.path !== readmeRelativePosixPath) {
        continue;
      }

      if (commits.includes(file.commit)) {
        filesNeededToBeDeleted.push(file);
      }
    }

    response = await fetch(getServeUrl(config), {
      method: 'put',
      body: JSON.stringify({
        name: userInfo.name,
        email: userInfo.email,
        files: filesNeededToBeDeleted,
      }),
      headers: {'Content-Type': 'application/json'},
    });

    if ((await response.text()) !== 'ok') {
      output.appendLine(
        'Delete repeated README record on the server side failed.',
      );
    }
  } catch (e) {
    output.appendLine((e as any).toString());
  }
}

function updateCacheFileWithPromise(
  workspacePath: string,
  userInfo: UserInfo,
): void {
  updateCacheFilePromise = updateCacheFilePromise
    .then(() => updateCacheFile(workspacePath, userInfo))
    .then(
      () => {},
      err => err && output.appendLine(err.toString()),
    );
}

async function hintIfNotRead(absolutePath: string): Promise<void> {
  for (let [workspacePath, cache] of Object.entries(
    workspacePathToRTFREADMECacheDict,
  )) {
    if (!absolutePath.startsWith(workspacePath)) {
      continue;
    }

    let config = workspacePathToConfigDict[workspacePath];

    if (!config) {
      continue;
    }

    if (globMatch(absolutePath, workspacePath, config.ignore || [], [])) {
      continue;
    }

    let simpleGitObject = workspacePathToGitDict[workspacePath];

    if (!simpleGitObject) {
      continue;
    }

    let username: string | null | undefined, email: string | null | undefined;

    for (let readme of cache.files) {
      if (readme.filesPatterns.length === 0) {
        continue;
      }

      let readmeAbsolutePath = Path.posix.join(workspacePath, readme.path);

      let matched = globMatch(
        absolutePath,
        Path.posix.dirname(readmeAbsolutePath),
        readme.filesPatterns,
        config.ignore || [],
      );

      if (!matched) {
        continue;
      }

      if (username === undefined && email === undefined) {
        let userGitInfo = await getGitUserInfo(simpleGitObject);

        username = userGitInfo.name;
        email = userGitInfo.email;
      }

      if (!username || !email) {
        break;
      }

      let user = _.find(cache.users, {name: username, email});

      if (!user) {
        user = {
          name: username,
          email,
          files: [],
        };

        cache.users.push(user);

        updateCacheFileWithPromise(workspacePath, user);
      }

      // if the readme has been read, do not hint
      let file = _.find(user.files, {path: readme.path, commit: readme.commit});

      if (file) {
        continue;
      }

      let commits = _.compact(
        (
          await simpleGitObject.raw(
            'log',
            `-${README_MAX_NUMBER_OF_COMMITS_CONSIDERED}`,
            '--pretty=format:%H',
            readme.path,
          )
        ).split('\n'),
      ); // TODO: speed up by preprocessing
      let files = user.files.filter(
        file => commits.findIndex(commit => file.commit === commit) !== -1,
      );
      files.sort((a, b) => {
        return (
          commits.findIndex(commit => commit === a.commit) -
          commits.findIndex(commit => commit === b.commit)
        );
      });

      file = files[0] ? _.cloneDeep(files[0]) : undefined;

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

      vscode.window
        .showInformationMessage(
          `Please read the f***ing README "${
            readme.path
          }" for file: ${Path.posix.relative(workspacePath, absolutePath)}.`,
          'Open',
          'Read Later',
        )
        .then((result): Thenable<vscode.TextEditor> | undefined => {
          if (result === 'Open') {
            let commit = file?.commit;

            if (!commit) {
              return vscode.window.showTextDocument(
                vscode.Uri.from({scheme: 'file', path: readmeAbsolutePath}),
              );
            } else {
              return vscode.commands.executeCommand(
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

          return;
        })
        .then(
          () => {},
          err => err && output.appendLine(err.toString()),
        );
    }
  }
}

async function handleSpecialFilesAndConditionalHint(
  uri: vscode.Uri,
  eventType: vscode.FileChangeType | FileOpenType.Opened,
): Promise<void> {
  let filePath = uri.path;

  let workspaceFolders = vscode.workspace.workspaceFolders?.filter(
    workspaceFolder => filePath.startsWith(workspaceFolder.uri.path),
  );

  if (workspaceFolders) {
    for (let workspaceFolder of workspaceFolders) {
      let workspacePosixPath = workspaceFolder.uri.path;

      let config = workspacePathToConfigDict[workspacePosixPath];

      if (
        Path.posix.dirname(filePath) === workspacePosixPath &&
        Path.posix.basename(filePath) === CONFIG_FILENAME
      ) {
        switch (eventType) {
          case vscode.FileChangeType.Changed:
          case vscode.FileChangeType.Created:
            await loadConfigAndGetCacheFile(workspacePosixPath);

            break;

          case vscode.FileChangeType.Deleted:
            deleteConfigFile(workspacePosixPath);

            break;

          case FileOpenType.Opened:
            break;

          default:
            output.appendLine('Unexpected event type!');

            break;
        }
      } else if (
        config &&
        globMatch(
          filePath,
          workspacePosixPath,
          config.readme || [],
          config.ignore || [],
        )
      ) {
        switch (eventType) {
          case vscode.FileChangeType.Changed:
          case vscode.FileChangeType.Created:
          case FileOpenType.Opened:
            if (await loadREADMEFile(filePath, workspacePosixPath)) {
              await readREADMEFile(filePath, workspacePosixPath);
            }

            break;

          case vscode.FileChangeType.Deleted:
            deleteREADMEFile(filePath, workspacePosixPath);

            break;

          default:
            output.appendLine('Unexpected event type!');

            break;
        }
      }
    }
  }

  await hintIfNotRead(filePath);
}

async function getDataFromInputBox(
  inputBoxInfo: {
    title: string;
    prompt?: string;
  },
  validate: (data: string) => string | true,
  // @ts-ignore
): Promise<string | undefined> {
  return vscode.window.showInputBox({
    title: inputBoxInfo.title,
    prompt: inputBoxInfo.prompt,
    ignoreFocusOut: true,
    validateInput: value => {
      let validateResult = validate(value);

      if (validateResult === true) {
        return '';
      }

      return validateResult;
    },
  });
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

        await loadConfigAndGetCacheFile(addedWorkspacePath);

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

        if (workspacePathToRTFREADMECacheDict[removedWorkspacePath]) {
          delete workspacePathToRTFREADMECacheDict[removedWorkspacePath];
        }

        if (workspacePathToGitDict[removedWorkspacePath]) {
          delete workspacePathToGitDict[removedWorkspacePath];
        }

        delete workspacePathToConfigDict[removedWorkspacePath];
      }
    }),
  );

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(async e => {
      if (e) {
        let filePath = e.document.uri.path;

        let workspaceFolders = vscode.workspace.workspaceFolders?.filter(
          workspaceFolder => filePath.startsWith(workspaceFolder.uri.path),
        );

        if (workspaceFolders) {
          for (let workspaceFolder of workspaceFolders) {
            let workspacePosixPath = workspaceFolder.uri.path;

            let config = workspacePathToConfigDict[workspacePosixPath];

            if (!config) {
              continue;
            }

            if (
              globMatch(
                filePath,
                workspacePosixPath,
                config.readme || [],
                config.ignore || [],
              )
            ) {
              await readREADMEFile(filePath, workspacePosixPath);
            }
          }
        }

        await hintIfNotRead(filePath);
      }
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('rtfr.createConfigFile', async () => {
      let editor = vscode.window.activeTextEditor;
      let workspacePath: string | undefined;

      if (!editor) {
        output.appendLine("You don't have any opened files.");
        output.appendLine(
          'rtf-README extension will create a config file for the first workspace folder.',
        );

        workspacePath = vscode.workspace.workspaceFolders?.[0].uri.path;

        if (!workspacePath) {
          output.appendLine(
            "There's no workspaceFolder that this extension could get.",
          );

          return;
        }
      } else {
        let activeFilePath = editor.document.fileName;

        workspacePath = vscode.workspace.workspaceFolders?.find(
          workspaceFolder =>
            activeFilePath.startsWith(workspaceFolder.uri.path),
        )?.uri.path;

        if (!workspacePath) {
          output.appendLine(
            `There's no workspaceFolder that match active file path ${activeFilePath}.`,
          );
          output.appendLine(
            'rtf-README extension will create a config file for the first workspace folder.',
          );

          workspacePath = vscode.workspace.workspaceFolders?.[0].uri.path;

          if (!workspacePath) {
            output.appendLine(
              "There's no workspaceFolder that this extension could get.",
            );

            return;
          }
        }
      }

      let server = await getDataFromInputBox(
        {
          title: 'The Certralizing Server',
          prompt: 'Format: http(s)://(ip or domain name):port',
        },
        serverConfigValidate,
      );

      if (server === undefined) {
        return;
      }

      let token = await getDataFromInputBox(
        {
          title: 'Server token to modify or get cache file',
        },
        tokenValidate,
      );

      if (token === undefined) {
        return;
      }

      let init = await getDataFromInputBox(
        {
          title: 'Input Commit Which "rtfr check" Starts From',
          prompt:
            "The commit hash string contains only 0-9, a-z and A-Z, and its length is 40. Leave this empty if you dont't intend to use this.",
        },
        commitInputValidate,
      );

      if (init === undefined) {
        return;
      }

      init = init.toLowerCase();

      let configFilePath = Path.posix.resolve(workspacePath, CONFIG_FILENAME);

      await vscode.workspace.fs.writeFile(
        vscode.Uri.file(configFilePath),
        new TextEncoder().encode(
          `${JSON.stringify(
            {
              init: init === '' ? undefined : init,
              server,
              token,
              ignore: ['**/node_modules/**'],
              readme: DEFAULT_READMES_TO_BE_CONSIDERED,
            },
            undefined,
            2,
          )}\n`,
        ),
      );
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

  await Promise.all(
    vscode.window.visibleTextEditors.map(async editor => {
      let document = editor.document;
      let absolutePath = pathToPosixPath(document.fileName);

      if (absolutePath === Path.posix.basename(absolutePath)) {
        return;
      }

      if (absolutePath.endsWith('.git')) {
        return;
      }

      await handleSpecialFilesAndConditionalHint(
        vscode.Uri.from({scheme: 'file', path: absolutePath}),
        FileOpenType.Opened,
      );
    }),
  );

  for (let workspaceFolder of vscode.workspace.workspaceFolders || []) {
    let disposable = fsp.watch(workspaceFolder.uri);

    context.subscriptions.push(disposable);

    workspacePathToWatchDisposableDict[workspaceFolder.uri.path] = disposable;
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('rtfr.showREADMEs', () => {
      if (!vscode.window.activeTextEditor) {
        output.appendLine("rtfr.showREADMEs: You haven't opened any files.");

        return;
      }

      let filePath = vscode.window.activeTextEditor.document.fileName;

      if (Path.posix.basename(filePath) === filePath) {
        output.appendLine('rtfr.showREADMEs: Current Focused is not a file');

        return;
      }

      let workspaceFolders = vscode.workspace.workspaceFolders?.filter(
        workspaceFolder => filePath.startsWith(workspaceFolder.uri.path),
      );

      let readmeFilePathsSplitByWorkspace: string[][] = [];

      if (workspaceFolders) {
        for (let workspaceFolder of workspaceFolders) {
          let workspacePosixPath = workspaceFolder.uri.path;
          let cache = workspacePathToRTFREADMECacheDict[workspacePosixPath];
          let config = workspacePathToConfigDict[workspacePosixPath];

          let readmeFilePaths: string[] = [workspacePosixPath];

          for (let readme of cache.files) {
            if (
              globMatch(
                filePath,
                Path.posix.dirname(
                  Path.posix.join(workspacePosixPath, readme.path),
                ),
                readme.filesPatterns,
                config.ignore || [],
              )
            ) {
              readmeFilePaths.push(readme.path);
            }
          }

          readmeFilePathsSplitByWorkspace.push(readmeFilePaths);
        }
      }

      readmeFilePathsSplitByWorkspace = readmeFilePathsSplitByWorkspace.filter(
        readmeFilePaths => readmeFilePaths.length > 1,
      );

      vscode.window
        .showQuickPick(
          _.flatten(
            readmeFilePathsSplitByWorkspace.map(readmeFilePaths => {
              return [
                {
                  label: readmeFilePaths[0],
                  kind: vscode.QuickPickItemKind.Separator,
                },
                ...readmeFilePaths.slice(1).map(readmeFilePath => ({
                  label: Path.posix.basename(readmeFilePath),
                  description:
                    Path.posix.dirname(readmeFilePath) === '.'
                      ? undefined
                      : Path.posix.dirname(readmeFilePath),
                  workspacePosixPath: readmeFilePaths[0],
                })),
              ] as (vscode.QuickPickItem & {workspacePosixPath: string})[];
            }),
          ),
          {
            placeHolder:
              readmeFilePathsSplitByWorkspace.length > 0
                ? 'Search README files by name'
                : 'No README files associated with this file',
          },
        )
        .then(item => {
          if (!item) {
            return;
          }

          return vscode.window.showTextDocument(
            vscode.Uri.file(
              item.description
                ? Path.posix.join(
                    item.workspacePosixPath!,
                    item.description,
                    item.label,
                  )
                : Path.posix.join(item.workspacePosixPath!, item.label),
            ),
          );
        })
        .then(
          () => {},
          err => err && output.appendLine(err.toString()),
        );
    }),
  );

  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider(
      [{pattern: '**'}, {pattern: '**/.*'}],
      {
        provideCodeLenses: (
          document,
          _token,
        ): vscode.ProviderResult<vscode.CodeLens[]> => {
          let filePath = document.fileName;

          if (filePath === Path.basename(filePath)) {
            return;
          }

          let workspaceFolders = vscode.workspace.workspaceFolders?.filter(
            workspaceFolder => filePath.startsWith(workspaceFolder.uri.path),
          );
          let count = 0;

          if (workspaceFolders) {
            for (let workspaceFolder of workspaceFolders) {
              let workspacePosixPath = workspaceFolder.uri.path;
              let cache = workspacePathToRTFREADMECacheDict[workspacePosixPath];
              let config = workspacePathToConfigDict[workspacePosixPath];

              for (let readme of cache.files) {
                if (
                  globMatch(
                    filePath,
                    Path.posix.dirname(
                      Path.posix.join(workspacePosixPath, readme.path),
                    ),
                    readme.filesPatterns,
                    config.ignore || [],
                  )
                ) {
                  ++count;
                }
              }
            }
          }

          return [
            new vscode.CodeLens(
              new vscode.Range(
                new vscode.Position(0, 0),
                new vscode.Position(0, 0),
              ),
              {
                title: `rtf-README: ${count} associated`,
                command: 'rtfr.showREADMEs',
              },
            ),
          ];
        },
        resolveCodeLens: (
          codeLens: vscode.CodeLens,
          _token: vscode.CancellationToken,
        ): vscode.ProviderResult<vscode.CodeLens> => {
          return codeLens;
        },
      },
    ),
  );
}

export function deactivate(): void {}
