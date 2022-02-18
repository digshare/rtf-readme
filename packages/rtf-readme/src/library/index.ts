export * from './git';
export * from './path-convert';
export * from './readme';

export const CACHE_FILENAME = '.rtf-readme.json';

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
}
