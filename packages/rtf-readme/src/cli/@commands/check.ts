import * as crypto from 'crypto';
import * as FS from 'fs';
import * as Path from 'path';

import chalk from 'chalk';
import {Command, command, metadata} from 'clime';
import * as _ from 'lodash';
import minimatch from 'minimatch';
import fetch from 'node-fetch';
import simpleGit, {SimpleGit} from 'simple-git';
import table from 'text-table';

import {
  CONFIG_FILENAME,
  Cache,
  Config,
  MAGIC_GIT_INITIAL_COMMIT,
  README_FILE_NAMES,
  getFilesPatternsOfREADME,
  getServeUrl,
  pathToPosixPath,
  posixPathToPath,
} from '../../library';
import {READMECliOptions} from '../@options';

let errorStringForAlignment: string[][] = [];

@command({
  description: 'Return error when README has not been read if needed',
})
export default class extends Command {
  @metadata
  async execute(options: READMECliOptions): Promise<void> {
    let workspacePath = options.dir
      ? Path.resolve(process.cwd(), options.dir)
      : process.cwd();

    let configFilePath = Path.join(workspacePath, CONFIG_FILENAME);
    let config: Config;

    try {
      config = JSON.parse(FS.readFileSync(configFilePath).toString());
    } catch (e) {
      console.error('read config failed');

      console.error(e);

      return;
    }

    let cache: Cache;

    try {
      cache = (await (await fetch(getServeUrl(config))).json()) as Cache;
    } catch (e) {
      console.warn('No cache file got.');

      cache = {users: []};
    }

    let simpleGitObject = simpleGit(workspacePath);

    let readmePaths = walkThroughFilesToGetREADME(workspacePath);

    if (!readmePaths || readmePaths.length === 0) {
      return;
    }

    let workspacePosixPath = pathToPosixPath(workspacePath);

    let readmeFilesPatterns: {
      readmePosixRelativePath: string;
      filesPatterns: string[];
    }[] = [];

    for (let readmePath of readmePaths) {
      let readmeContent = (await FS.promises.readFile(readmePath)).toString();

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

    let commitHashsLength = commitHashs.length;

    if (config.init) {
      let initIndex = commitHashs.findIndex(
        commitHash => commitHash === config.init,
      );

      if (initIndex !== -1) {
        commitHashs = commitHashs.slice(0, initIndex + 1);
      }
    }

    let fromInitialCommit =
      commitHashsLength === commitHashs.length
        ? commitHashsLength <= 100
        : false;

    commitHashs = commitHashs.slice(0, 100);

    let md5ToReportedFilesMap: Map<
      string,
      _.Dictionary<string | _.Dictionary<string>>[]
    > = new Map();

    let hasReported = false;

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
          let readmeDirPath = Path.posix.dirname(
            Path.posix.join(
              workspacePosixPath,
              readmeFilesPattern.readmePosixRelativePath,
            ),
          );

          for (let filesPattern of readmeFilesPattern.filesPatterns) {
            let readmePosixRelativePath =
              readmeFilesPattern.readmePosixRelativePath;
            let md5String = getMD5OfCertainFileInGitAndREADME(
              user,
              readmePosixRelativePath,
            );
            let result = md5ToReportedFilesMap.get(md5String);

            if (
              _.find(result, {
                user,
                readmePath: readmePosixRelativePath,
              })
            ) {
              continue;
            }

            if (
              minimatch(
                Path.posix.join(workspacePosixPath, commitFile),
                Path.posix.join(readmeDirPath, filesPattern),
              )
            ) {
              let latestCommitRead = cache.users
                ?.find(
                  userToMatch =>
                    user.name === userToMatch.name &&
                    user.email === userToMatch.email,
                )
                ?.files?.find(
                  file => file.path === readmePosixRelativePath,
                )?.commit;

              let readmeCommitsByThisUser = _.compact(
                (
                  await simpleGitObject.raw(
                    'log',
                    '-1',
                    `--author=${user.name} <${user.email}>`,
                    '--pretty=format:%H',
                    readmePosixRelativePath,
                  )
                ).split('\n'),
              );

              let readmeCommits =
                latestCommitRead || readmeCommitsByThisUser[0]
                  ? _.compact(
                      (
                        await simpleGitObject.raw(
                          'log',
                          '-1',
                          '--pretty=format:%H',
                          readmePosixRelativePath,
                        )
                      ).split('\n'),
                    )
                  : undefined;

              let latestCommitReadToReadmeNowCommitCount = 1;

              if (latestCommitRead) {
                latestCommitReadToReadmeNowCommitCount = Number(
                  await simpleGitObject.raw(
                    'rev-list',
                    `${latestCommitRead}..${readmeCommits![0]}`,
                    '--count',
                  ),
                );
              }

              let readmeCommitToReadmeNowCommitCount = 1;

              if (readmeCommitsByThisUser[0]) {
                readmeCommitToReadmeNowCommitCount = Number(
                  await simpleGitObject.raw(
                    'rev-list',
                    `${readmeCommitsByThisUser[0]}..${readmeCommits![0]}`,
                    '--count',
                  ),
                );
              }

              if (
                latestCommitReadToReadmeNowCommitCount > 0 &&
                readmeCommitToReadmeNowCommitCount > 0
              ) {
                hasReported = true;

                reportError(user, readmePosixRelativePath);

                if (result) {
                  result.push({
                    user,
                    readmePath: readmePosixRelativePath,
                  });
                } else {
                  md5ToReportedFilesMap.set(md5String, [
                    {
                      user,
                      readmePath: readmePosixRelativePath,
                    },
                  ]);
                }
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
                `${commitHash}^:${readmeFilesPatterns[readmeIndex].readmePosixRelativePath}`,
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

    if (hasReported) {
      flushErrors();

      throw new Error("There're some READMEs not read");
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

async function getUserByCommit(
  simpleGitObject: SimpleGit,
  commitHash: string,
): Promise<{name: string; email: string}> {
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
): Promise<string[]> {
  return _.compact(
    (
      await simpleGitObject.raw(
        'diff',
        '--name-only',
        initialCommit ? MAGIC_GIT_INITIAL_COMMIT : `${commitHash}^`,
        commitHash,
      )
    ).split('\n'),
  );
}

function reportError(
  user: {name: string; email: string},
  readmePosixRelativePath: string,
): void {
  errorStringForAlignment.push([
    'User:',
    `${chalk.green(`${user.name} <${user.email}>`)},`,
    'README:',
    chalk.yellow(`./${posixPathToPath(readmePosixRelativePath)}`),
  ]);
}

function flushErrors(): void {
  console.error(table(errorStringForAlignment));
}

function getMD5OfCertainFileInGitAndREADME(
  user: {name: string; email: string},
  readmePosixRelativePath: string,
): string {
  return md5(md5(user.name) + md5(user.email) + md5(readmePosixRelativePath));
}

function md5(content: string): string {
  return crypto.createHash('md5').update(content).digest('hex');
}
