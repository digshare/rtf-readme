import * as FS from 'fs';
import * as Path from 'path';

export const CONFIG_FILENAME = '.rtfrrc';

export interface Config {
  init: string;
  server: string;
  token: string;
}

export async function writeToConfigFile(
  workspacePath: string,
  config: object,
): Promise<void> {
  return FS.promises.writeFile(
    Path.join(workspacePath, CONFIG_FILENAME),
    `${JSON.stringify(config, undefined, 2)}\n`,
  );
}

export function getServeUrl(config: Config): string {
  return `http://${config.server}/cache/${config.token}`;
}
