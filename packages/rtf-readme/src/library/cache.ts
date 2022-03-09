import * as FS from 'fs';
import * as Path from 'path';

export interface READMEInfo {
  path: string;
  filesPatterns: string[];
  commit: string;
}

export interface RawUserInfo {
  name: string;
  email: string;
}

export interface UserInfo extends RawUserInfo {
  files: {path: string; commit: string}[];
}

export interface Cache {
  users: UserInfo[];
}
