import * as Path from 'path';

import fetch from 'node-fetch';
import {CONFIG_FILENAME, getServeUrl} from 'rtf-readme';

import * as vscode from 'vscode';

import {Cache, CacheManager} from '../@cache';
import {ConfigManager} from '../@config';
import {
  getLoadREADMEFilePromises,
  setLoadREADMEFilePromises,
} from '../@load-readme-file';

import {READMEService} from './readme-service';

export class ConfigService {
  constructor(
    private output: vscode.OutputChannel,
    private configManager: ConfigManager,
    private cacheManager: CacheManager,
    private readmeService: READMEService,
  ) {}

  loadConfigAndGetCacheFile = async (workspacePath: string): Promise<void> => {
    let configFilePath = Path.posix.resolve(workspacePath, CONFIG_FILENAME);
    let uri = vscode.Uri.file(configFilePath);

    try {
      let stat = await vscode.workspace.fs.stat(uri);

      if (stat.type === vscode.FileType.File) {
        await this.configManager.readConfig(uri.path, workspacePath);

        let config = this.configManager.getConfig(workspacePath);

        let response = await fetch(getServeUrl(config));

        this.cacheManager.setCache(
          workspacePath,
          new Cache({
            ...JSON.parse(await response.text()),
            files: [],
          }),
        );

        await this.readmeService.walkThroughFilesToLoadREADME(
          workspacePath,
          workspacePath,
        );

        await Promise.all(getLoadREADMEFilePromises());

        setLoadREADMEFilePromises([]);
      }
    } catch (e) {
      this.output.appendLine(
        `load config file and cache of workspace ${workspacePath} failed.\n${(
          e as any
        ).toString()}`,
      );
    }
  };

  deleteConfigFile = (workspacePath: string): void => {
    this.configManager.deleteConfig(workspacePath);

    this.cacheManager.deleteCache(workspacePath);
  };

  loadConfigAndGetCacheFiles = async (): Promise<void> => {
    let workspaceFolders = vscode.workspace.workspaceFolders;

    if (workspaceFolders) {
      for (let workspaceFolder of workspaceFolders) {
        await this.loadConfigAndGetCacheFile(workspaceFolder.uri.path);
      }
    }
  };
}
