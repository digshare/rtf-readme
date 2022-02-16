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
} from 'please-readme.lib';

enum CommitType {
  READMEChangedCommitType,
  FilesChangedCommitType,
}

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

    console.log(readmePaths);

    if (!readmePaths) {
      return;
    }

    let usersString = await simpleGitObject.raw('shortlog', '-se', 'HEAD');
    let usersRegExp = /\d+\s+(?:([^]+?)\s(<\S+\@\S+>))/g;
    let users = [];

    while (true) {
      let userInfo = usersRegExp.exec(usersString);

      if (!userInfo) {
        break;
      }

      let username = userInfo[1];
      let email = userInfo[2].match(/<([^]+)>/)![1];
      users.push({name: username, email});
    }

    console.log(users);

    for (let readmePath of readmePaths) {
      console.log('readmePath', readmePath);

      for (let user of users) {
        console.log('user', user, readmePath);

        let readmeRelativePath = Path.relative(workspacePath, readmePath);
        let readmePosixRelativePath = pathToPosixPath(readmeRelativePath);

        let latestCommitRead = cache.users
          ?.find(
            userToMatch =>
              user.name === userToMatch.name &&
              user.email === userToMatch.email,
          )
          ?.files?.find(file => file.path === readmePosixRelativePath)?.commit;

        if (
          !!latestCommitRead &&
          !(await doesCommitExist(
            simpleGitObject,
            latestCommitRead,
            readmeRelativePath,
          ))
        ) {
          latestCommitRead = undefined;
        }

        if (!latestCommitRead) {
          let readmeCommitHashsByCurrentUser = _.compact(
            (
              await simpleGitObject.raw(
                'log',
                `--author=${user.name}`,
                '--pretty=format:%H',
                readmePosixRelativePath,
              )
            ).split('\n'),
          );

          let readmeCommitHashs = _.compact(
            (
              await simpleGitObject.raw(
                'log',
                '--pretty=format:%H',
                readmePosixRelativePath,
              )
            ).split('\n'),
          );

          let commitHashsByCurrentUser = _.compact(
            (
              await simpleGitObject.raw(
                'log',
                `--author=${user.name}`,
                '--pretty=format:%H',
              )
            ).split('\n'),
          );

          let commitHashs = _.compact(
            (
              await simpleGitObject.raw(
                'rev-list',
                `${
                  readmeCommitHashsByCurrentUser.length > 0
                    ? readmeCommitHashsByCurrentUser[0]
                    : MAGIC_GIT_INITIAL_COMMIT
                }..HEAD`,
              )
            ).split('\n'),
          ).reverse();

          let initialCommit = commitHashs[0];

          let commitHashsWithType = _.compact(
            commitHashs.map(commitHash => {
              if (commitHashsByCurrentUser.includes(commitHash)) {
                return {commitHash, type: CommitType.FilesChangedCommitType};
              }

              if (readmeCommitHashs.includes(commitHash)) {
                return {commitHash, type: CommitType.READMEChangedCommitType};
              }

              return undefined;
            }),
          );

          // if (readmeCommitHashsByCurrentUser.length === 0) {
          //   commitHashsWithType = commitHashsWithType.slice(
          //     Math.max(0, commitHashsWithType.length - 50),
          //     commitHashs.length,
          //   );
          // }

          await findREADMENotRead(
            commitHashsWithType,
            readmeCommitHashsByCurrentUser.length === 0 &&
              commitHashsWithType[0].commitHash === initialCommit,
          );
        } else {
          let commitHashs = (
            await simpleGitObject.raw('rev-list', `${latestCommitRead}..HEAD`)
          )
            .trim()
            .split('\n')
            .reverse();

          let readmeCommitHashsByCurrentUser = _.compact(
            (
              await simpleGitObject.raw(
                'log',
                `--author=${user.name}`,
                '--pretty=format:%H',
                readmePosixRelativePath,
              )
            ).split('\n'),
          );

          let commitHashsByCurrentUser = _.compact(
            (
              await simpleGitObject.raw(
                'log',
                `--author=${user.name}`,
                '--pretty=format:%H',
              )
            ).split('\n'),
          );

          let readmeCommitHashs = _.compact(
            (
              await simpleGitObject.raw(
                'log',
                '--pretty=format:%H',
                readmePosixRelativePath,
              )
            ).split('\n'),
          );

          if (
            readmeCommitHashsByCurrentUser.length > 0 &&
            commitHashs.includes(readmeCommitHashsByCurrentUser[0])
          ) {
            commitHashs = _.compact(
              (
                await simpleGitObject.raw(
                  'rev-list',
                  `${readmeCommitHashsByCurrentUser[0]}..HEAD`,
                )
              ).split('\n'),
            ).reverse();
          }

          let commitHashsWithType = _.compact(
            commitHashs.map(commitHash => {
              if (readmeCommitHashs.includes(commitHash)) {
                return {commitHash, type: CommitType.READMEChangedCommitType};
              }

              if (commitHashsByCurrentUser.includes(commitHash)) {
                return {commitHash, type: CommitType.FilesChangedCommitType};
              }

              return undefined;
            }),
          );

          await findREADMENotRead(commitHashsWithType);
        }

        async function findREADMENotRead(
          commitHashsWithType: {commitHash: string; type: CommitType}[],
          fromInitialCommit: boolean = false,
        ): Promise<void> {
          let filesPatterns: string[] = [];
          let left = 0;
          let leftCommitType = CommitType.READMEChangedCommitType;

          for (let i = 0; i < commitHashsWithType.length; ++i) {
            if (
              commitHashsWithType[i].type === CommitType.READMEChangedCommitType
            ) {
              if (
                i > left &&
                leftCommitType === CommitType.FilesChangedCommitType
              ) {
                let commitFiles = _.compact(
                  (
                    await simpleGitObject.raw(
                      'diff',
                      '--name-only',
                      left === 0 && fromInitialCommit
                        ? MAGIC_GIT_INITIAL_COMMIT
                        : commitHashsWithType[left].commitHash + '^',
                      commitHashsWithType[i - 1].commitHash,
                    )
                  ).split('\n'),
                );

                for (let commitFile of commitFiles) {
                  for (let filesPattern of filesPatterns) {
                    let commitFileRelativePath = pathToPosixPath(
                      Path.relative(
                        Path.dirname(readmePath),
                        Path.join(workspacePath, commitFile),
                      ),
                    );

                    if (minimatch(commitFileRelativePath, filesPattern)) {
                      console.error(
                        `File ${Path.join(
                          workspacePath,
                          commitFile,
                        )} changed but README ${Path.join(
                          workspacePath,
                          readmePosixRelativePath,
                        )} not read`,
                      );

                      break;
                    }
                  }
                }
              }

              leftCommitType = CommitType.READMEChangedCommitType;
              left = i;

              let commitFiles = _.compact(
                (
                  await simpleGitObject.raw(
                    'diff',
                    '--name-only',
                    i === 0 && fromInitialCommit
                      ? MAGIC_GIT_INITIAL_COMMIT
                      : commitHashsWithType[i].commitHash + '^',
                    commitHashsWithType[i].commitHash,
                  )
                ).split('\n'),
              );

              if (commitFiles.includes(readmePosixRelativePath)) {
                let readmeContent = await simpleGitObject.show([
                  `${commitHashsWithType[i].commitHash}:${readmePosixRelativePath}`,
                ]);

                filesPatterns = getFilesPatternsOfREADME(readmeContent);
              }
            } else {
              if (leftCommitType !== CommitType.FilesChangedCommitType) {
                left = i;
                leftCommitType = CommitType.FilesChangedCommitType;
              }
            }
          }

          if (
            left < commitHashsWithType.length &&
            leftCommitType === CommitType.FilesChangedCommitType
          ) {
            let commitFiles = _.compact(
              (
                await simpleGitObject.raw(
                  'diff',
                  '--name-only',
                  left === 0 && fromInitialCommit
                    ? MAGIC_GIT_INITIAL_COMMIT
                    : commitHashsWithType[left].commitHash + '^',
                  commitHashsWithType[commitHashsWithType.length - 1]
                    .commitHash,
                )
              ).split('\n'),
            );

            for (let commitFile of commitFiles) {
              for (let filesPattern of filesPatterns) {
                let commitFileRelativePath = pathToPosixPath(
                  Path.relative(
                    Path.dirname(readmePath),
                    Path.join(workspacePath, commitFile),
                  ),
                );

                if (minimatch(commitFileRelativePath, filesPattern)) {
                  console.error(
                    `File ${Path.join(
                      workspacePath,
                      commitFile,
                    )} changed but README ${Path.join(
                      workspacePath,
                      readmePosixRelativePath,
                    )} not read`,
                  );

                  break;
                }
              }
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

async function doesCommitExist(
  simpleGitObject: SimpleGit,
  commitHashToJudge: string,
  relativePath: string,
): Promise<boolean> {
  return (
    (await simpleGitObject.raw('log', '--pretty=format:%H', relativePath))
      .split('\n')
      .findIndex(commitHash => commitHash === commitHashToJudge) !== -1
  );
}

async function committedByThisUser(
  simpleGitObject: SimpleGit,
  commitHash: string,
  user: {name: string; email: string},
): Promise<boolean> {
  let [username, email] = (
    await simpleGitObject.raw('log', '--format=%an %ae', commitHash)
  )
    .trim()
    .split('\n')
    .slice(0, 1)[0]
    .split(' ');

  return username === user.name && email === user.email;
}

async function getFilesPatternsOfREADMEByCommit(
  simpleGitObject: SimpleGit,
  commitHash: string,
  relativePath: string,
): Promise<string[]> {
  let readmeContent = await simpleGitObject.show([
    `${commitHash}:${relativePath}`,
  ]);

  return getFilesPatternsOfREADME(readmeContent);
}
