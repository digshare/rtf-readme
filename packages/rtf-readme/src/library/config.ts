import * as FS from 'fs';
import * as Path from 'path';

export const CONFIG_FILENAME = '.rtfrrc';

export interface Config {
  init?: string;
  server: string;
  token: string;
  ignore?: string | string[];
  readme?: string | string[];
}

export interface TransformedConfig {
  init?: string;
  server: string;
  token: string;
  ignore?: string[];
  readme?: string[];
}

export const DEFAULT_READMES_TO_BE_CONSIDERED = ['**/README.md'];

export async function readConfigFile(path: string): Promise<TransformedConfig> {
  let config = JSON.parse(
    (await FS.promises.readFile(path)).toString(),
  ) as Config;

  return {
    init: config.init,
    server: config.server,
    token: config.token,
    ignore: Array.isArray(config.ignore)
      ? ['.git/**', ...config.ignore]
      : typeof config.ignore === 'string'
      ? ['.git/**', config.ignore]
      : undefined,
    readme: Array.isArray(config.readme)
      ? config.readme.length === 0
        ? DEFAULT_READMES_TO_BE_CONSIDERED
        : config.readme
      : config.readme
      ? [config.readme]
      : undefined,
  };
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
  let slash = getSlash(config.server);

  return `${config.server}${slash}cache/${config.token}`;
}

export function getGetTokenUrl(server: string): string {
  let slash = getSlash(server);

  return `${server}${slash}token`;
}

export function getCacheCommitsUrl(config: Config): string {
  let slash = getSlash(config.server);

  return `${config.server}${slash}cache-commits/${config.token}`;
}

function getSlash(server: string): string {
  return server.endsWith('/') ? '' : '/';
}
