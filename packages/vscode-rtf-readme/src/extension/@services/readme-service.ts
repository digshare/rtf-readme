import * as Path from 'path';

import * as _ from 'lodash';
import {
  UserInfo,
  getFilesPatternsOfREADME,
  globMatch,
  posixPathToPath,
} from 'rtf-readme';

import * as vscode from 'vscode';

import {Cache, CacheManager} from '../@cache';
import {ConfigManager} from '../@config';
import {GitObjectManager} from '../@git-object';
import {getLoadREADMEFilePromises} from '../@load-readme-file';

export class READMEService {
  constructor(
    private output: vscode.OutputChannel,
    private configManager: ConfigManager,
    private cacheManager: CacheManager,
    private gitObjectManager: GitObjectManager,
    private updateCacheFileWithPromise: (
      workspacePath: string,
      userInfo: UserInfo,
    ) => void,
  ) {}

  walkThroughFilesToLoadREADME = async (
    workspacePosixPath: string,
    path: string,
    fileType?: vscode.FileType,
  ): Promise<void> => {
    if (!fileType) {
      try {
        let stat = await vscode.workspace.fs.stat(vscode.Uri.file(path));

        fileType = stat.type;
      } catch (e) {
        this.output.appendLine(
          `walk through files error.\n${(e as any).toString()}`,
        );

        return;
      }
    }

    let config = this.configManager.getConfig(workspacePosixPath);

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
          workspacePosixPath,
        )
      ) {
        getLoadREADMEFilePromises().push(
          this.loadREADMEFile(path, workspacePosixPath),
        );
      }
    } else if (fileType === vscode.FileType.Directory) {
      for (let [
        fileName,
        newFileType,
      ] of await vscode.workspace.fs.readDirectory(vscode.Uri.file(path))) {
        let filePath = Path.posix.resolve(path, fileName);

        if (
          !globMatch(
            filePath,
            workspacePosixPath,
            config.ignore || [],
            [],
            workspacePosixPath,
          )
        ) {
          await this.walkThroughFilesToLoadREADME(
            workspacePosixPath,
            filePath,
            newFileType,
          );
        }
      }
    }
  };

  loadREADMEFile = async (
    absolutePosixPath: string,
    workspacePosixPath: string,
  ): Promise<boolean> => {
    let readmeContent = (
      await vscode.workspace.fs.readFile(vscode.Uri.file(absolutePosixPath))
    ).toString();
    let filesPatterns = getFilesPatternsOfREADME(readmeContent);

    if (filesPatterns.length === 0) {
      let relativePath = Path.posix.relative(
        workspacePosixPath,
        absolutePosixPath,
      );

      if (this.cacheManager.getCache(workspacePosixPath)) {
        this.cacheManager.getCache(workspacePosixPath).removeFile({
          path: relativePath,
        });
      }

      return false;
    }

    let relativePath = Path.posix.relative(
      workspacePosixPath,
      absolutePosixPath,
    );

    let commit: string | undefined;

    let simpleGitObject =
      this.gitObjectManager.getGitObject(workspacePosixPath);

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
        this.output.appendLine(`get log failed.\n${(e as any).toString()}`);
      }
    }

    if (!this.cacheManager.getCache(workspacePosixPath)) {
      this.cacheManager.setCache(
        workspacePosixPath,
        new Cache({
          files: [
            {
              path: relativePath,
              filesPatterns,
              commit,
            },
          ],
          users: [],
        }),
      );
    } else {
      this.cacheManager.getCache(workspacePosixPath).addOrReplaceFile({
        path: relativePath,
        filesPatterns,
        commit,
      });
    }

    return true;
  };

  readREADMEFile = async (
    absolutePath: string,
    workspacePosixPath: string,
  ): Promise<void> => {
    let simpleGitObject =
      this.gitObjectManager.getGitObject(workspacePosixPath);

    if (!simpleGitObject) {
      return;
    }

    let username = (await simpleGitObject.raw('config', 'user.name')).trim();
    let email = (await simpleGitObject.raw('config', 'user.email')).trim();

    if (!username || !email) {
      return;
    }

    let relativePath = Path.posix.relative(workspacePosixPath, absolutePath);

    let cache = this.cacheManager.getCache(workspacePosixPath);

    if (!cache) {
      cache = new Cache({
        files: [],
        users: [],
      });

      this.cacheManager.setCache(workspacePosixPath, cache);
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

    this.updateCacheFileWithPromise(workspacePosixPath, {
      name: user.name,
      email: user.email,
      files: [file],
    });

    this.output.appendLine(
      `${new Date().toLocaleString()}: README "${file.path}" read.`,
    );
  };

  deleteREADMEFile = (
    absolutePath: string,
    workspacePosixPath: string,
  ): void => {
    let readmes = this.cacheManager.getCache(workspacePosixPath).files;

    if (readmes) {
      this.cacheManager.getCache(workspacePosixPath).removeFile({
        path: Path.posix.relative(workspacePosixPath, absolutePath),
      });
    } else {
      this.output.appendLine(
        'Deleting a README file which is not inspected by rtf-README.',
      );
    }
  };
}
