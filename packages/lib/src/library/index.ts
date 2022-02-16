export * from './git';
export * from './path-convert';
export * from './readme';

export const CACHE_FILENAME = '.rtf-readme.json';

export const README_FILE_NAMES = ['README.md'];

export const MAGIC_GIT_INITIAL_COMMIT =
  '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

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
