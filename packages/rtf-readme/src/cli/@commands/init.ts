import * as Path from 'path';

import {Command, command, metadata, option} from 'clime';
import inquirer, {DistinctQuestion} from 'inquirer';
import * as _ from 'lodash';

import {
  Config,
  DEFAULT_READMES_TO_BE_CONSIDERED,
  commitInputValidate,
  serverConfigValidate,
  tokenValidate,
  writeToConfigFile,
} from '../../library';
import {READMECliOptions} from '../@options';

export class InitOptions extends READMECliOptions {
  @option({
    flag: 'i',
    description: "The commit which rtfr command's process starts from.",
  })
  init!: string;
  @option({
    flag: 's',
    description:
      'The certralizing server. Format: http(s)://(ip or domain name):port',
  })
  server!: string;
  @option({
    flag: 't',
    description: 'The token for server authentication.',
  })
  token!: string;
}

const promptList = [
  {
    type: 'input',
    message:
      'Please input server config(format: http(s)://(ip or domain name):port):',
    name: 'server',
    validate: serverConfigValidate,
  },
  {
    type: 'input',
    message: 'Server token to modify or get cache file:',
    name: 'token',
    validate: tokenValidate,
  },
  {
    type: 'input',
    message:
      'Please input the commit hash which rtfr starts from (empty if not needed):',
    name: 'init',
    validate: commitInputValidate,
  },
] as readonly DistinctQuestion[];

@command({
  description: 'rtf-README project init',
})
export default class extends Command {
  @metadata
  async execute(options: InitOptions): Promise<void> {
    let answers = await inquirer.prompt(
      promptList.filter(prompt => !options[prompt.name! as keyof InitOptions]),
    );

    for (let [key, value] of Object.entries(answers)) {
      options[key as keyof InitOptions] = value as string;
    }

    if (commitInputValidate(options.init) !== true) {
      throw new Error('Commit hash is in wrong format.');
    } else if (serverConfigValidate(options.server) !== true) {
      throw new Error('Server config is in wrong format.');
    }

    options.init = options.init.toLowerCase();

    let workspacePath = options.dir
      ? Path.resolve(process.cwd(), options.dir)
      : process.cwd();

    let config: Config = {
      init: options.init === '' ? undefined : options.init,
      server: options.server,
      token: options.token,
      ignore: ['**/node_modules/**'],
      readme: DEFAULT_READMES_TO_BE_CONSIDERED,
    };

    await writeToConfigFile(workspacePath, config);
  }
}
