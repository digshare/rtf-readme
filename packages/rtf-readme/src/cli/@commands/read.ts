import * as Path from 'path';

import {Command, ExpectedError, command, metadata, option, param} from 'clime';
import * as _ from 'lodash';
import fetch from 'node-fetch';
import simpleGit from 'simple-git';

import {
  CONFIG_FILENAME,
  GIT_USER_INFO_STRING_RE,
  TransformedConfig,
  UserInfo,
  getGitUserInfoFromString,
  getServeUrl,
  globMatch,
  pathToPosixPath,
  readConfigFile,
} from '../../library';
import {READMECliOptions} from '../@options';

export class ReadOptions extends READMECliOptions {
  @option({
    flag: 'a',
    description: 'Info of author who read README',
    validator: value => {
      if (typeof value !== 'string' || !GIT_USER_INFO_STRING_RE.test(value)) {
        throw new ExpectedError('Format of "author" is: "name <email>"');
      }
    },
  })
  author!: string;
}

@command({
  description: 'Read README and record this reading behavior.',
})
export default class extends Command {
  @metadata
  async execute(
    @param({
      description: 'Read this README',
      required: true,
    })
    readmePath: string,
    options: ReadOptions,
  ): Promise<void> {
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

    let simpleGitObject = simpleGit(workspacePath);

    let readmeFilePath = Path.resolve(workspacePath, readmePath);

    let workspacePosixPath = pathToPosixPath(workspacePath);
    let readmePosixFilePath = pathToPosixPath(readmeFilePath);

    if (
      globMatch(
        readmePosixFilePath,
        workspacePosixPath,
        config.ignore || [],
        [],
      )
    ) {
      console.warn('You read a README that is ignoerd by this program.');

      return;
    }

    if (
      !globMatch(readmePosixFilePath, workspacePath, config.readme || [], [])
    ) {
      console.warn(
        'This is not a README or you forget to add README pattern in .rtfrrc.',
      );

      return;
    }

    let username: string | null | undefined, email: string | null | undefined;

    if (options.author) {
      let userInfo = getGitUserInfoFromString(options.author.trim());

      username = userInfo?.name;
      email = userInfo?.email;
    } else {
      username = (await simpleGitObject.getConfig('user.name')).value;

      email = (await simpleGitObject.getConfig('user.email')).value;
    }

    if (!username || !email) {
      throw Error('Git user info is not configured or invalid');
    }

    let commits = _.compact(
      (
        await simpleGitObject.raw(
          'log',
          '-1',
          '--pretty=format:%H',
          readmeFilePath,
        )
      ).split('\n'),
    );

    if (commits.length === 0) {
      console.warn("This README hasn't been committed yet.");

      return;
    }

    let commit = commits[0];

    let readmeRelativePosixPath = pathToPosixPath(
      Path.relative(workspacePath, readmeFilePath),
    );

    let user: UserInfo = {
      name: username,
      email,
      files: [
        {
          path: readmeRelativePosixPath,
          commit,
        },
      ],
    };

    let response = await fetch(getServeUrl(config), {
      method: 'post',
      body: JSON.stringify(user),
      headers: {'Content-Type': 'application/json'},
    });

    let responseString = await response.text();

    if (responseString === 'ok') {
      // eslint-disable-next-line no-console
      console.log('success');

      return;
    }

    let responseObject = JSON.parse(responseString);

    let filesNeededToBeDeleted: {path: string; commit: string}[] = [];

    commits = _.compact(
      (
        await simpleGitObject.raw('log', '--pretty=format:%H', readmeFilePath)
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
        name: username,
        email,
        files: filesNeededToBeDeleted,
      }),
      headers: {'Content-Type': 'application/json'},
    });

    if ((await response.text()) !== 'ok') {
      throw new Error(
        'Delete repeated README record on the server side failed.',
      );
    }

    // eslint-disable-next-line no-console
    console.log('success');
  }
}
