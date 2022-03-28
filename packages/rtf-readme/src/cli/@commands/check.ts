import * as Crypto from 'crypto';
import * as FS from 'fs';
import * as Path from 'path';

import chalk from 'chalk';
import {Command, ExpectedError, command, metadata} from 'clime';
import * as _ from 'lodash';
import fetch from 'node-fetch';
import simpleGit, {SimpleGit} from 'simple-git';
import table from 'text-table';
import wcwidth from 'wcwidth';

import {
  CONFIG_FILENAME,
  Cache,
  MAGIC_GIT_INITIAL_COMMIT,
  README_MAX_NUMBER_OF_COMMITS_CONSIDERED,
  TransformedConfig,
  getFilesPatternsOfREADME,
  getGitUserInfo,
  getServeUrl,
  globMatch,
  pathToPosixPath,
  posixPathToPath,
  readConfigFile,
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
    let config: TransformedConfig;

    try {
      config = await readConfigFile(configFilePath);
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

    let workspacePosixPath = pathToPosixPath(workspacePath);

    let readmePaths = walkThroughFilesToGetREADME(
      workspacePath,
      workspacePosixPath,
      config.readme || [],
      config.ignore || [],
    );

    if (!readmePaths || readmePaths.length === 0) {
      return;
    }

    let readmePosixRelativePaths = readmePaths.map(readmePath =>
      pathToPosixPath(Path.relative(workspacePath, readmePath)),
    );

    let commitHashToPosixRelativePathToReadmeContentMapMap: Map<
      string,
      Map<string, string>
    > = new Map();

    let readmePosixRelativePathToreadmeCommitHashs: Map<string, string[]> =
      new Map();

    for (let readmePosixRelativePath of readmePosixRelativePaths) {
      readmePosixRelativePathToreadmeCommitHashs.set(
        readmePosixRelativePath,
        _.compact(
          (
            await simpleGitObject.raw(
              'log',
              `-${README_MAX_NUMBER_OF_COMMITS_CONSIDERED}`,
              '--format=%H',
              readmePosixRelativePath,
            )
          ).split('\n'),
        ),
      );
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

    for (let i = commitHashs.length - 1; i >= 0; --i) {
      let commitHash = commitHashs[i];

      let commitFiles = await getCommitFiles(
        simpleGitObject,
        commitHash,
        fromInitialCommit && i === commitHashs.length - 1,
      );

      let parents = (
        await simpleGitObject.raw(
          'show',
          '--no-patch',
          '--format=%P',
          commitHash,
        )
      )
        .trim()
        .split(' ');

      if (parents.length < 2) {
        let readmeInfos = await Promise.all(
          readmePosixRelativePaths.map(async readmePosixRelativePath => {
            let content: string;

            if (
              commitHashToPosixRelativePathToReadmeContentMapMap
                .get(parents[0])
                ?.has(readmePosixRelativePath)
            ) {
              content = commitHashToPosixRelativePathToReadmeContentMapMap
                .get(parents[0])!
                .get(readmePosixRelativePath)!;
            } else {
              try {
                content = await simpleGitObject.raw(
                  'show',
                  `${commitHash}:${readmePosixRelativePath}`,
                );
              } catch (e) {
                content = '';
              }
            }

            return {
              readmePosixRelativePath,
              filePatterns: getFilesPatternsOfREADME(content),
              commits: readmePosixRelativePathToreadmeCommitHashs.get(
                readmePosixRelativePath,
              )!,
            };
          }),
        );

        let relevantReadmeFilesPatterns = readmeInfos.filter(readmeInfo => {
          return (
            readmeInfo.filePatterns.length > 0 &&
            commitFiles.some(commitFile =>
              globMatch(
                Path.posix.join(workspacePosixPath, commitFile),
                Path.posix.dirname(
                  Path.posix.join(
                    workspacePosixPath,
                    readmeInfo.readmePosixRelativePath,
                  ),
                ),
                readmeInfo.filePatterns,
                config.ignore || [],
                workspacePosixPath,
              ),
            )
          );
        });

        let user = await getGitUserInfo(simpleGitObject, commitHash);

        for (let readmeFilesPattern of relevantReadmeFilesPatterns) {
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

          let commits = readmeFilesPattern.commits;

          let latestCommitsRead = cache.users
            ?.find(
              userToMatch =>
                user.name === userToMatch.name &&
                user.email === userToMatch.email,
            )
            ?.files?.filter(
              file =>
                file.path === readmePosixRelativePath &&
                commits.findIndex(commit => file.commit === commit) !== -1,
            )
            .map(file => file.commit);

          latestCommitsRead?.sort(
            (a, b) =>
              commits.findIndex(commit => commit === a) -
              commits.findIndex(commit => commit === b),
          );
          let latestCommitRead = latestCommitsRead?.[0];

          let readmeCommitsByThisUser = _.compact(
            (
              await simpleGitObject.raw(
                'log',
                '-1',
                '--pretty=format:%H',
                `--author=${user.name} <${user.email}>`,
                commitHash,
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
                      commitHash,
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

            reportError(user, readmePosixRelativePath, commitHash);
          }
        }
      }

      for (let readmePosixRelativePath of readmePosixRelativePaths) {
        if (
          commitFiles.includes(readmePosixRelativePath) ||
          parents.length > 1
        ) {
          let posixRelativePathToReadmeContentMap: Map<string, string>;

          if (
            !commitHashToPosixRelativePathToReadmeContentMapMap.has(commitHash)
          ) {
            posixRelativePathToReadmeContentMap = new Map();

            commitHashToPosixRelativePathToReadmeContentMapMap.set(
              commitHash,
              posixRelativePathToReadmeContentMap,
            );
          } else {
            posixRelativePathToReadmeContentMap =
              commitHashToPosixRelativePathToReadmeContentMapMap.get(
                commitHash,
              )!;
          }

          try {
            posixRelativePathToReadmeContentMap.set(
              readmePosixRelativePath,
              await simpleGitObject.raw(
                'show',
                `${commitHash}:${readmePosixRelativePath}`,
              ),
            );
          } catch (e) {
            // nothing
          }
        } else {
          let posixRelativePathToReadmeContentMap: Map<string, string>;

          if (
            !commitHashToPosixRelativePathToReadmeContentMapMap.has(commitHash)
          ) {
            posixRelativePathToReadmeContentMap = new Map();

            commitHashToPosixRelativePathToReadmeContentMapMap.set(
              commitHash,
              posixRelativePathToReadmeContentMap,
            );
          } else {
            posixRelativePathToReadmeContentMap =
              commitHashToPosixRelativePathToReadmeContentMapMap.get(
                commitHash,
              )!;
          }

          if (
            commitHashToPosixRelativePathToReadmeContentMapMap
              .get(parents[0])
              ?.has(readmePosixRelativePath)
          ) {
            posixRelativePathToReadmeContentMap.set(
              readmePosixRelativePath,
              commitHashToPosixRelativePathToReadmeContentMapMap
                .get(parents[0])!
                .get(readmePosixRelativePath)!,
            );
          }
        }
      }
    }

    if (hasReported) {
      flushErrors();

      throw new ExpectedError("There're some READMEs not read");
    }
  }
}

function walkThroughFilesToGetREADME(
  path: string,
  workspacePosixPath: string,
  readmePatterns: string[],
  ignorePatterns: string[],
): string[] | undefined {
  try {
    let stat = FS.statSync(path);

    if (stat.isFile()) {
      if (
        globMatch(
          path,
          workspacePosixPath,
          readmePatterns,
          ignorePatterns,
          workspacePosixPath,
        )
      ) {
        return [path];
      } else {
        return undefined;
      }
    } else {
      let readmePaths: string[] = [];

      for (let fileName of FS.readdirSync(path)) {
        if (
          globMatch(
            Path.posix.join(pathToPosixPath(path), fileName),
            workspacePosixPath,
            ignorePatterns,
            [],
            workspacePosixPath,
          )
        ) {
          continue;
        }

        readmePaths = _.concat(
          readmePaths,
          walkThroughFilesToGetREADME(
            Path.join(path, fileName),
            workspacePosixPath,
            readmePatterns,
            ignorePatterns,
          ) || [],
        );
      }

      return readmePaths;
    }
  } catch (e) {
    console.error('walkThroughFilesToGetREADME Error:', e);

    return undefined;
  }
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
  commitHash: string,
): void {
  errorStringForAlignment.push(['Commit:', chalk.magenta(commitHash)]);
  errorStringForAlignment.push([
    'User:',
    `${chalk.green(`${user.name} <${user.email}>`)},`,
    'README:',
    chalk.yellow(`./${posixPathToPath(readmePosixRelativePath)}`),
  ]);
}

function flushErrors(): void {
  console.error(table(errorStringForAlignment, {stringLength: wcwidth}));
}

function getMD5OfCertainFileInGitAndREADME(
  user: {name: string; email: string},
  readmePosixRelativePath: string,
): string {
  return md5(md5(user.name) + md5(user.email) + md5(readmePosixRelativePath));
}

function md5(content: string): string {
  return Crypto.createHash('md5').update(content).digest('hex');
}
