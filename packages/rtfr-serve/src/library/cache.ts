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
  commits?: string[];
}
