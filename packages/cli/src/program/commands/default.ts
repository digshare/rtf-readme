import {Command, command, option, Options, param} from 'clime';
import * as FS from 'fs';
import * as _ from 'lodash';
import * as Path from 'path';
import simpleGit from 'simple-git';

import {CONFIG_FILENAME, UserInfo, pathToPosixPath} from 'please-readme.lib';

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

    let configFilePath = Path.join(workspacePath, CONFIG_FILENAME);

    let configFileContent = FS.readFileSync(configFilePath).toString();

    let config = JSON.parse(configFileContent);

    if (options.read) {
      let readmeFilePath = Path.resolve(workspacePath, options.read);

      let simpleGitObject = simpleGit(workspacePath);

      let username = (await simpleGitObject.getConfig('user.name')).value;
      let email = (await simpleGitObject.getConfig('user.email')).value;
      let logResult = await simpleGitObject.log({file: readmeFilePath});
      let commit = logResult.latest === null ? '' : logResult.latest.hash;

      if (Array.isArray(config.users)) {
        let user = _.find(config.users, {name: username, email});

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
            unreadFiles: [],
          };

          config.users.push(user);
        } else {
          _.remove(user.unreadFiles, {path: readmeRelativePosixPath});

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

        await writeToConfigFile(workspacePath, config);
      } else {
        console.warn('invalid config file.');
      }

      return;
    }

    let hasReported = false;

    if (Array.isArray(config.users)) {
      for (let user of config.users) {
        if (Array.isArray(user?.unreadFiles) && user.unreadFiles.length > 0) {
          console.error('user', user.name, 'has not read the following files:');

          for (let unreadFile of user.unreadFiles) {
            console.error(unreadFile.path);
          }

          hasReported = true;
        }
      }
    } else {
      console.warn('invalid config file.');
    }

    if (hasReported) {
      throw Error('There are READMEs not read');
    }
  }
}

async function writeToConfigFile(
  workspacePath: string,
  config: {users: UserInfo[]},
): Promise<void> {
  return new Promise<void>((resolve, reject) =>
    FS.writeFile(
      Path.join(workspacePath, CONFIG_FILENAME),
      JSON.stringify(config, undefined, 2),
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
