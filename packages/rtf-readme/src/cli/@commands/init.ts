import * as Path from 'path';

import {Command, ExpectedError, command, metadata, option} from 'clime';
import inquirer, {DistinctQuestion} from 'inquirer';
import * as _ from 'lodash';
import fetch from 'node-fetch';

import {
  Config,
  DEFAULT_READMES_TO_BE_CONSIDERED,
  DEFAULT_RTF_README_SERVER,
  getGetTokenUrl,
  serverConfigValidate,
  writeToConfigFile,
} from '../../library';
import {READMECliOptions} from '../@options';

export class InitOptions extends READMECliOptions {
  @option({
    flag: 's',
    description: 'The URL of rtf-README server.',
    validator: value => {
      let validateResult = serverConfigValidate(value as string);

      if (validateResult !== true) {
        throw new ExpectedError(validateResult);
      }
    },
  })
  server!: string;
}

const promptList = [
  {
    type: 'input',
    message: 'Please enter server URL:',
    name: 'server',
    default: DEFAULT_RTF_README_SERVER,
    validate: serverConfigValidate,
  },
] as readonly DistinctQuestion[];

@command({
  description: 'Generate rtf-README config file',
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

    let tokenResponse = await fetch(getGetTokenUrl(options.server));

    if (tokenResponse.status !== 200) {
      throw new ExpectedError('fetching token failed.');
    }

    let token = await tokenResponse.text();

    let workspacePath = options.dir
      ? Path.resolve(process.cwd(), options.dir)
      : process.cwd();

    let config: Config = {
      server: options.server,
      token,
      ignore: ['**/node_modules/**'],
      readme: DEFAULT_READMES_TO_BE_CONSIDERED,
    };

    await writeToConfigFile(workspacePath, config);
  }
}
