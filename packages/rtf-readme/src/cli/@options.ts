import {Options, option} from 'clime';

export class READMECliOptions extends Options {
  @option({
    flag: 'd',
    description:
      'The workspace path to check whether README has been read. Default is current working directory.',
  })
  dir!: string;
}
