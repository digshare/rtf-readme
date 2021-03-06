import simpleGit, {SimpleGit} from 'simple-git';

// To get files changed in the first commit.
export const MAGIC_GIT_INITIAL_COMMIT =
  '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

export const README_MAX_NUMBER_OF_COMMITS_CONSIDERED = 1000;

export const GIT_USER_INFO_STRING_RE = /^(?:([^]+?)\s(<\S+\@\S+>))$/;

export function getSimpleGitObject(
  workspacePath: string,
): SimpleGit | undefined {
  try {
    return simpleGit(workspacePath);
  } catch (e) {
    console.error('simple-git object construction failed.\n', e);

    return undefined;
  }
}

export function getGitUserInfoFromString(userString: string):
  | {
      name: string | undefined;
      email: string | undefined;
    }
  | undefined {
  let userInfo = userString.match(GIT_USER_INFO_STRING_RE);

  if (!userInfo) {
    return undefined;
  }

  let name = userInfo?.[1];
  let email = userInfo?.[2]?.match(/<([^]+)>/)?.[1];

  return {name, email};
}

export async function getGitUserInfo(
  simpleGitObject: SimpleGit,
  commitHash: string,
): Promise<{name: string; email: string}> {
  let userString: string;

  userString = await simpleGitObject.raw(
    '--no-pager',
    'show',
    '-s',
    '--format=%an <%ae>',
    commitHash,
  );

  let userInfo = getGitUserInfoFromString(userString.trim())!;

  let name = userInfo.name;
  let email = userInfo.email;

  return {name: name!, email: email!};
}
