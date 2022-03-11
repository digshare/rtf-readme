import * as Path from 'path';

import {Command, Options, command, metadata, option} from 'clime';

import {newDBRecordAndGetToken} from '../@utils';

export class NewProjectOptions extends Options {
  @option({
    flag: 'd',
    description:
      'The directory path to save db data. Default is cwd()/rtf-readme-db.',
    default: './rtf-readme-db',
  })
  dir!: string;
}

@command({
  description: 'New project and get token on the server side.',
})
export default class extends Command {
  @metadata
  async execute(options: NewProjectOptions): Promise<string> {
    let workspacePath = options.dir
      ? Path.resolve(process.cwd(), options.dir)
      : process.cwd();

    return newDBRecordAndGetToken(workspacePath);
  }
}
