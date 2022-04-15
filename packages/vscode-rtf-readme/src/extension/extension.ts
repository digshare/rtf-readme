import * as Path from 'path';
import {TextEncoder} from 'util';

import * as _ from 'lodash';
import fetch from 'node-fetch';
import {
  CONFIG_FILENAME,
  DEFAULT_READMES_TO_BE_CONSIDERED,
  DEFAULT_RTF_README_SERVER,
  README_MAX_NUMBER_OF_COMMITS_CONSIDERED,
  UserInfo,
  getGetTokenUrl,
  getServeUrl,
  getSimpleGitObject,
  globMatch,
  pathToPosixPath,
  posixPathToPath,
  serverConfigValidate,
} from 'rtf-readme';
import {SimpleGit} from 'simple-git';

// eslint-disable-next-line @mufan/reference-missing-proof
import * as vscode from 'vscode';

import {cacheManager} from './@cache';
import {configManager} from './@config';
import {FileSystemProvider} from './@file-system-provider';
import {gitObjectManager} from './@git-object';
import {ConfigService, READMEService} from './@services';
import {getDataFromInputBox, getMarkdownTitle} from './@utils';

let output!: vscode.OutputChannel;
let updateCacheFilePromise: Promise<void> = Promise.resolve();

let workspacePathToWatchDisposableDict: {
  [workspacePath: string]: vscode.Disposable;
} = {};

let readmeService = new READMEService(
  output,
  configManager,
  cacheManager,
  gitObjectManager,
  updateCacheFileWithPromise,
);

let configService = new ConfigService(
  output,
  configManager,
  cacheManager,
  readmeService,
);

enum FileOpenType {
  Opened = 4,
}

async function loadFiles(): Promise<void> {
  await configService.loadConfigAndGetCacheFiles();
}

async function updateCacheFile(
  workspacePath: string,
  userInfo: UserInfo,
): Promise<void> {
  let config = configManager.getConfig(workspacePath);

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

    let simpleGitObject = gitObjectManager.getGitObject(workspacePath);

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
  for (let [workspacePath, cache] of cacheManager.entries) {
    if (!absolutePath.startsWith(workspacePath)) {
      continue;
    }

    let config = configManager.getConfig(workspacePath);

    if (!config) {
      continue;
    }

    if (
      globMatch(
        absolutePath,
        workspacePath,
        config.ignore || [],
        [],
        workspacePath,
      )
    ) {
      continue;
    }

    let simpleGitObject = gitObjectManager.getGitObject(workspacePath);

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
        workspacePath,
      );

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

      let commits: string[];

      try {
        commits = _.compact(
          (
            await simpleGitObject.raw(
              'log',
              `-${README_MAX_NUMBER_OF_COMMITS_CONSIDERED}`,
              '--pretty=format:%H',
              readme.path,
            )
          ).split('\n'),
        );
      } catch (e) {
        continue;
      }

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
          `Please read the f***ing README "./${
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
                vscode.Uri.file(readmeAbsolutePath),
              );
            } else {
              return vscode.commands.executeCommand(
                'vscode.diff',
                vscode.Uri.from({
                  scheme: 'readme',
                  path: readmeAbsolutePath,
                  query: JSON.stringify({commit}),
                }),
                vscode.Uri.file(readmeAbsolutePath),
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

      let config = configManager.getConfig(workspacePosixPath);

      if (
        Path.posix.dirname(filePath) === workspacePosixPath &&
        Path.posix.basename(filePath) === CONFIG_FILENAME
      ) {
        switch (eventType) {
          case vscode.FileChangeType.Changed:
          case vscode.FileChangeType.Created:
            await configService.loadConfigAndGetCacheFile(workspacePosixPath);

            break;

          case vscode.FileChangeType.Deleted:
            configService.deleteConfigFile(workspacePosixPath);

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
          workspacePosixPath,
        )
      ) {
        switch (eventType) {
          case vscode.FileChangeType.Changed:
          case vscode.FileChangeType.Created:
          case FileOpenType.Opened:
            if (
              await readmeService.loadREADMEFile(filePath, workspacePosixPath)
            ) {
              await readmeService.readREADMEFile(filePath, workspacePosixPath);
            }

            break;

          case vscode.FileChangeType.Deleted:
            readmeService.deleteREADMEFile(filePath, workspacePosixPath);

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

async function createConfigCommand(): Promise<void> {
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

    workspacePath = vscode.workspace.workspaceFolders?.find(workspaceFolder =>
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
      title: 'The URL of rtf-README server.',
    },
    serverConfigValidate,
    DEFAULT_RTF_README_SERVER,
  );

  if (server === undefined) {
    return;
  }

  let tokenResponse = await fetch(getGetTokenUrl(server));

  if (tokenResponse.status !== 200) {
    output.appendLine('rtfr.createConfigFile: fetching token failed.');

    vscode.window
      .showErrorMessage(
        'Create config failed because fetching token from server failed.',
      )
      .then(
        () => {},
        err => err && output.appendLine(err.toString()),
      );

    return;
  }

  let token = await tokenResponse.text();

  let configFilePath = Path.posix.resolve(workspacePath, CONFIG_FILENAME);

  await vscode.workspace.fs.writeFile(
    vscode.Uri.file(configFilePath),
    new TextEncoder().encode(
      `${JSON.stringify(
        {
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
}

async function showREADMEsCommand(): Promise<void> {
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
      let cache = cacheManager.getCache(workspacePosixPath);

      if (!cache) {
        continue;
      }

      let config = configManager.getConfig(workspacePosixPath);

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
            workspacePosixPath,
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
        await Promise.all(
          readmeFilePathsSplitByWorkspace.map(async readmeFilePaths => {
            return [
              {
                label: readmeFilePaths[0],
                kind: vscode.QuickPickItemKind.Separator,
              },
              ...(await Promise.all(
                readmeFilePaths.slice(1).map(async readmeFilePath => ({
                  label: Path.posix.basename(readmeFilePath),
                  description:
                    Path.posix.dirname(readmeFilePath) === '.'
                      ? undefined
                      : Path.posix.dirname(readmeFilePath),
                  workspacePosixPath: readmeFilePaths[0],
                  detail: await getMarkdownTitle(
                    Path.posix.resolve(readmeFilePaths[0], readmeFilePath),
                  ),
                })),
              )),
            ] as (vscode.QuickPickItem & {workspacePosixPath: string})[];
          }),
        ),
      ),
      {
        placeHolder:
          readmeFilePathsSplitByWorkspace.length > 0
            ? 'Search README files by name'
            : 'No README files associated with this file',
        matchOnDescription: true,
        matchOnDetail: true,
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

        if (eventWithFilePath.filePath.endsWith('.git')) {
          return;
        }

        let uri = vscode.Uri.file(eventWithFilePath.filePath);

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

        await configService.loadConfigAndGetCacheFile(addedWorkspacePath);

        let simpleGitObject: SimpleGit | undefined = getSimpleGitObject(
          posixPathToPath(addedWorkspacePath),
        );

        if (!simpleGitObject) {
          continue;
        }

        gitObjectManager.setGitObject(addedWorkspacePath, simpleGitObject);
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

        if (cacheManager.getCache(removedWorkspacePath)) {
          cacheManager.deleteCache(removedWorkspacePath);
        }

        if (gitObjectManager.getGitObject(removedWorkspacePath)) {
          gitObjectManager.deleteGitObject(removedWorkspacePath);
        }

        configManager.deleteConfig(removedWorkspacePath);
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

            let config = configManager.getConfig(workspacePosixPath);

            if (!config) {
              continue;
            }

            if (
              globMatch(
                filePath,
                workspacePosixPath,
                config.readme || [],
                config.ignore || [],
                workspacePosixPath,
              )
            ) {
              await readmeService.readREADMEFile(filePath, workspacePosixPath);
            }
          }
        }

        await hintIfNotRead(filePath);
      }
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'rtfr.createConfigFile',
      createConfigCommand,
    ),
  );

  for (let workspaceFolder of vscode.workspace.workspaceFolders || []) {
    let workspacePosixPath = workspaceFolder.uri.path;
    let workspacePath = posixPathToPath(workspacePosixPath);

    let simpleGitObject: SimpleGit | undefined =
      getSimpleGitObject(workspacePath);

    if (!simpleGitObject) {
      continue;
    }

    gitObjectManager.setGitObject(workspacePosixPath, simpleGitObject);
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
        vscode.Uri.file(absolutePath),
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
    vscode.commands.registerCommand('rtfr.showREADMEs', showREADMEsCommand),
  );

  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider([{pattern: '**'}], {
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
            let cache = cacheManager.getCache(workspacePosixPath);

            if (!cache) {
              continue;
            }

            let config = configManager.getConfig(workspacePosixPath);

            for (let readme of cache.files) {
              if (
                globMatch(
                  filePath,
                  Path.posix.dirname(
                    Path.posix.join(workspacePosixPath, readme.path),
                  ),
                  readme.filesPatterns,
                  config.ignore || [],
                  workspacePosixPath,
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
    }),
  );
}

export function deactivate(): void {}
