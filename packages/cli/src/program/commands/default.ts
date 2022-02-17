import * as childProcess from 'child_process';
import {Command, command, option, Options, param} from 'clime';
import * as FS from 'fs';
import * as _ from 'lodash';
import minimatch from 'minimatch';
import * as Path from 'path';
import simpleGit, {SimpleGit} from 'simple-git';

import {
  CACHE_FILENAME,
  UserInfo,
  pathToPosixPath,
  README_FILE_NAMES,
  getFilesPatternsOfREADME,
  MAGIC_GIT_INITIAL_COMMIT,
  posixPathToPath,
} from 'please-readme.lib';

class READMECliOptions extends Options {
  @option({
    flag: 'r',
    description: 'Read the fucking README',
  })
  read!: string;
}

@command({
  description: 'Return error when README has not been read if needed',
})
export default class extends Command {
  async execute(
    @param({
      description: 'The workspace path to check whether README has been read',
    })
    workspacePath: string,
    options: READMECliOptions,
  ) {
    workspacePath = workspacePath || process.cwd();

    if (!Path.isAbsolute(workspacePath)) {
      workspacePath = Path.resolve(process.cwd(), workspacePath);
    }

    let cacheFilePath = Path.join(workspacePath, CACHE_FILENAME);
    let cacheFileContent!: string;

    try {
      cacheFileContent = FS.readFileSync(cacheFilePath).toString();
    } catch (e) {
      console.log('No cache file');

      cacheFileContent = JSON.stringify({users: []});
    }

    let cache = JSON.parse(cacheFileContent) as {users: UserInfo[]};

    let simpleGitObject = simpleGit(workspacePath);

    if (options.read) {
      let readmeFilePath = Path.resolve(workspacePath, options.read);

      let username = (await simpleGitObject.getConfig('user.name')).value;
      let email = (await simpleGitObject.getConfig('user.email')).value;

      if (!username || !email) {
        throw Error('not a git user');
      }

      let logResult = await simpleGitObject.log({file: readmeFilePath});
      let commit = logResult.latest === null ? '' : logResult.latest.hash;

      if (Array.isArray(cache.users)) {
        let user = _.find(cache.users, {name: username, email});

        let readmeRelativePosixPath = pathToPosixPath(
          Path.relative(workspacePath, readmeFilePath),
        );

        if (!user) {
          user = {
            name: username,
            email,
            files: [
              {
                path: readmeRelativePosixPath,
                commit,
              },
            ],
          };

          cache.users.push(user);
        } else {
          let file = _.find(user.files, {path: readmeRelativePosixPath});

          if (!file) {
            user.files.push({
              path: readmeRelativePosixPath,
              commit,
            });
          } else {
            file.commit = commit;
          }
        }

        await writeToCacheFile(workspacePath, cache);
      } else {
        console.warn('invalid cache file.');
      }

      return;
    }

    let readmePaths = walkThroughFilesToGetREADME(workspacePath);

    if (!readmePaths) {
      return;
    }

    let workspacePosixPath = pathToPosixPath(workspacePath);

    let readmeFilesPatterns: {
      readmePosixRelativePath: string;
      filesPatterns: string[];
    }[] = [];

    for (let readmePath of readmePaths) {
      let readmeContent = await new Promise<string>((resolve, reject) =>
        FS.readFile(readmePath, (err, data) => {
          if (err) {
            reject(err);
          } else {
            resolve(data.toString());
          }
        }),
      );

      readmeFilesPatterns.push({
        readmePosixRelativePath: pathToPosixPath(
          Path.relative(workspacePath, readmePath),
        ),
        filesPatterns: getFilesPatternsOfREADME(readmeContent),
      });
    }

    let commitHashs = _.compact(
      (await simpleGitObject.raw('log', '--pretty=format:%H')).split('\n'),
    );

    let fromInitialCommit = commitHashs.length <= 100;

    commitHashs = commitHashs.slice(0, 100);

    for (let i = 0; i < commitHashs.length; ++i) {
      let commitHash = commitHashs[i];

      let user = await getUserByCommit(simpleGitObject, commitHash);

      let commitFiles = await getCommitFiles(
        simpleGitObject,
        commitHash,
        fromInitialCommit && i === commitHashs.length - 1,
      );

      for (let commitFile of commitFiles) {
        for (let readmeFilesPattern of readmeFilesPatterns) {
          let posixRelativePath = Path.posix.relative(
            Path.posix.dirname(
              Path.posix.join(
                workspacePosixPath,
                readmeFilesPattern.readmePosixRelativePath,
              ),
            ),
            Path.posix.join(workspacePosixPath, commitFile),
          );

          for (let filesPattern of readmeFilesPattern.filesPatterns) {
            if (minimatch(posixRelativePath, filesPattern)) {
              let latestCommitRead = cache.users
                ?.find(
                  userToMatch =>
                    user.name === userToMatch.name &&
                    user.email === userToMatch.email,
                )
                ?.files?.find(
                  file =>
                    file.path === readmeFilesPattern.readmePosixRelativePath,
                )?.commit;

              // 找到该用户最后提交的README的commit，然后和latestCommitRead比较，得到用户读过的最新的commit。
              // 如果最新的commit在当前commit之后，那就不报错。
              // 如果最新的commit在当前commit之前，报错。

              let count1 = 1;

              if (latestCommitRead) {
                count1 = Number(
                  await simpleGitObject.raw(
                    'rev-list',
                    `${latestCommitRead}..${commitHash}`,
                    '--count',
                  ),
                );
              }

              let readmeCommitByThisUser = _.compact(
                (
                  await simpleGitObject.raw(
                    'log',
                    `--author=${user.name}`,
                    '--pretty=format:%H',
                    readmeFilesPattern.readmePosixRelativePath,
                  )
                ).split('\n'),
              );

              let count2 = 1;

              if (readmeCommitByThisUser[0]) {
                count2 = Number(
                  await simpleGitObject.raw(
                    'rev-list',
                    `${readmeCommitByThisUser[0]}..${commitHash}`,
                    '--count',
                  ),
                );
              }

              if (count1 > 0 && count2 > 0) {
                reportError(
                  workspacePosixPath,
                  commitFile,
                  readmeFilesPattern.readmePosixRelativePath,
                );
              }

              break;
            }
          }
        }
      }

      for (let commitFile of commitFiles) {
        let readmeIndex = readmeFilesPatterns.findIndex(
          readmeFilesPattern =>
            readmeFilesPattern.readmePosixRelativePath === commitFile,
        );

        if (readmeIndex !== -1) {
          if (fromInitialCommit && i === commitHashs.length - 1) {
            readmeFilesPatterns.splice(readmeIndex, 1);
          } else {
            try {
              let readmeContent = await simpleGitObject.show([
                `${commitHash + '^'}:${
                  readmeFilesPatterns[readmeIndex].readmePosixRelativePath
                }`,
              ]);

              readmeFilesPatterns[readmeIndex].filesPatterns =
                getFilesPatternsOfREADME(readmeContent);
            } catch (e) {
              readmeFilesPatterns.splice(readmeIndex, 1);
            }
          }
        }
      }
    }
  }
}

function walkThroughFilesToGetREADME(path: string): string[] | undefined {
  try {
    let stat = FS.statSync(path);

    if (stat.isFile()) {
      if (README_FILE_NAMES.includes(Path.basename(path))) {
        return [path];
      } else {
        return undefined;
      }
    } else {
      let readmePaths: string[] = [];

      for (let file of FS.readdirSync(path)) {
        if (file === '.git' || file === 'node_modules') {
          continue;
        }

        readmePaths = _.concat(
          readmePaths,
          walkThroughFilesToGetREADME(Path.join(path, file)) || [],
        );
      }

      return readmePaths;
    }
  } catch (e) {
    console.error('walkThroughFilesToGetREADME Error:', e);

    return undefined;
  }
}

async function writeToCacheFile(
  workspacePath: string,
  cache: {users: UserInfo[]},
): Promise<void> {
  return new Promise<void>((resolve, reject) =>
    FS.writeFile(
      Path.join(workspacePath, CACHE_FILENAME),
      JSON.stringify(cache, undefined, 2),
      err => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      },
    ),
  );
}

async function getUserByCommit(simpleGitObject: SimpleGit, commitHash: string) {
  let usersRegExp = /(?:([^]+?)\s(<\S+\@\S+>))/;

  let userString = await simpleGitObject.raw(
    '--no-pager',
    'show',
    '-s',
    '--format=%an <%ae>',
    commitHash,
  );

  let userInfo = userString.match(usersRegExp);

  let username = userInfo![1];
  let email = userInfo![2].match(/<([^]+)>/)![1];

  return {name: username, email};
}

async function getCommitFiles(
  simpleGitObject: SimpleGit,
  commitHash: string,
  initialCommit: boolean,
) {
  return _.compact(
    (
      await simpleGitObject.raw(
        'diff',
        '--name-only',
        initialCommit ? MAGIC_GIT_INITIAL_COMMIT : commitHash + '^',
        commitHash,
      )
    ).split('\n'),
  );
}

function reportError(
  workspacePosixPath: string,
  commitFile: string,
  readmePosixRelativePath: string,
): void {
  console.error(
    `File ${posixPathToPath(
      Path.posix.join(workspacePosixPath, commitFile),
    )} changed but README ${posixPathToPath(
      Path.posix.join(workspacePosixPath, readmePosixRelativePath),
    )} not read`,
  );
}
