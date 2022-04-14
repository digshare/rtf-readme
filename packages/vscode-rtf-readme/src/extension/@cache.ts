import * as _ from 'lodash';
import {READMEInfo, UserInfo} from 'rtf-readme';

interface RTFREADMECache {
  files: READMEInfo[];
  users: UserInfo[];
}

export class Cache {
  private _files: READMEInfo[];
  private _users: UserInfo[];

  constructor(cache: RTFREADMECache) {
    this._files = cache.files;
    this._users = cache.users;
  }

  get files(): READMEInfo[] {
    return this._files;
  }

  get users(): UserInfo[] {
    return this._users;
  }

  addOrReplaceFile(file: READMEInfo): void {
    let readmeInfoIndex = _.findIndex(this._files, {
      path: file.path,
    });

    if (readmeInfoIndex === -1) {
      this._files.push(file);
    } else {
      this._files[readmeInfoIndex] = file;
    }
  }

  removeFile(file: Partial<READMEInfo>): void {
    _.remove(this._files, file);
  }
}

let workspacePathToRTFREADMECacheDict: {[path: string]: Cache} = {};

export class CacheManager {
  get entries(): [string, Cache][] {
    return Object.entries(workspacePathToRTFREADMECacheDict);
  }

  getCache(workspacePosixPath: string): Cache {
    return workspacePathToRTFREADMECacheDict[workspacePosixPath];
  }

  setCache(workspacePosixPath: string, cache: Cache): void {
    workspacePathToRTFREADMECacheDict[workspacePosixPath] = cache;
  }

  deleteCache(workspacePosixPath: string): void {
    delete workspacePathToRTFREADMECacheDict[workspacePosixPath];
  }
}

export let cacheManager = new CacheManager();
