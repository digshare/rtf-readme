import * as FS from 'fs';
import * as Path from 'path';

import {Command, command, metadata, param} from 'clime';
import * as _ from 'lodash';
import simpleGit from 'simple-git';

import {CACHE_FILENAME, UserInfo, pathToPosixPath} from '../../library';
import {READMECliOptions} from '../@options';

@command({
  description: 'Read README',
})
export default class extends Command {
  @metadata
  async execute(
    @param({
      description: 'Read this README',
      required: true,
    })
    readmePath: string,
    options: READMECliOptions,
  ): Promise<void> {
    let workspacePath = options.dir
      ? Path.resolve(process.cwd(), options.dir)
      : process.cwd();

    let cacheFilePath = Path.join(workspacePath, CACHE_FILENAME);
    let cacheFileContent!: string;

    try {
      cacheFileContent = FS.readFileSync(cacheFilePath).toString();
    } catch (e) {
      console.warn('No cache file');

      cacheFileContent = JSON.stringify({users: []});
    }

    let cache = JSON.parse(cacheFileContent) as {users: UserInfo[]};

    let simpleGitObject = simpleGit(workspacePath);

    let readmeFilePath = Path.resolve(workspacePath, readmePath);

    let username = (await simpleGitObject.getConfig('user.name')).value;
    let email = (await simpleGitObject.getConfig('user.email')).value;

    if (!username || !email) {
      throw Error('not a git user');
    }

    let logResult = await simpleGitObject.log({file: readmeFilePath});

    if (logResult.latest === null) {
      return;
    }

    let commit = logResult.latest.hash;

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
}

async function writeToCacheFile(
  workspacePath: string,
  cache: {users: UserInfo[]},
): Promise<void> {
  return new Promise<void>((resolve, reject) =>
    FS.writeFile(
      Path.join(workspacePath, CACHE_FILENAME),
      `${JSON.stringify(cache, undefined, 2)}\n`,
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
