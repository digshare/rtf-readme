import {TransformedConfig, posixPathToPath, readConfigFile} from 'rtf-readme';

let workspacePathToConfigDict: {[path: string]: TransformedConfig} = {};

export class ConfigManager {
  getConfig(workspacePosixPath: string): TransformedConfig {
    return workspacePathToConfigDict[workspacePosixPath];
  }

  async readConfig(
    configPosixPath: string,
    workspacePosixPath: string,
  ): Promise<void> {
    workspacePathToConfigDict[workspacePosixPath] =
      ((await readConfigFile(
        posixPathToPath(configPosixPath),
      )) as TransformedConfig) || {};
  }

  deleteConfig(workspacePosixPath: string): void {
    delete workspacePathToConfigDict[workspacePosixPath];
  }
}

export let configManager = new ConfigManager();
