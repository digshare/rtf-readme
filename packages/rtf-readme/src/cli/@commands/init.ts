import * as Net from 'net';
import * as Path from 'path';

import {Command, command, metadata, option} from 'clime';
import inquirer, {DistinctQuestion} from 'inquirer';
import * as _ from 'lodash';

import {Config, writeToConfigFile} from '../../library';
import {READMECliOptions} from '../@options';

export class InitOptions extends READMECliOptions {
  @option({
    flag: 'i',
    description: "The commit which rtfr command's process starts from.",
  })
  init!: string;
  @option({
    flag: 's',
    description: 'The certralizing server. Example: 199.199.199.199:8000',
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
    message: 'Please input the commit hash which rtfr starts from:',
    name: 'init',
    validate: commitInputValidate,
  },
  {
    type: 'input',
    message: 'Please input server config(example: 199.199.199.199:8000):',
    name: 'server',
    validate: serverConfigValidate,
  },
  {
    type: 'input',
    message: 'Server token to modify or get cache file:',
    name: 'token',
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
      init: options.init,
      server: options.server,
      token: options.token,
    };

    await writeToConfigFile(workspacePath, config);
  }
}

function commitInputValidate(val: string): string | boolean {
  if (val && val.match(/^[0-9a-zA-Z]{40}$/)) {
    return true;
  }

  return 'The commit hash string contains only 0-9, a-z and A-Z, and its length is 40.';
}

function serverConfigValidate(val: string): string | boolean {
  let errorString = 'The format is "ip:port", in which ip is ipv4.';

  if (!val) {
    return errorString;
  }

  let [ip, port] = val.trim().split(':');

  if (Net.isIPv4(ip) && port.match(/^\d{1,5}$/) && Number(port) <= 65535) {
    return true;
  }

  return errorString;
}
