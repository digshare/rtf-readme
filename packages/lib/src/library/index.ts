export * from './git';
export * from './path-convert';

export const CONFIG_FILENAME = '.rtf-readme.json';

export const README_FILE_NAMES = ['README.md'];

export interface READMEInfo {
  path: string;
  filesPatterns: string[];
  commit: string;
}

export interface UserInfo {
  name: string;
  email: string;
  files: {path: string; commit: string}[];
  unreadFiles: {path: string; commit: string}[];
}
