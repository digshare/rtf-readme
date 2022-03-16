import simpleGit, {SimpleGit} from 'simple-git';

// To get files changed in the first commit.
export const MAGIC_GIT_INITIAL_COMMIT =
  '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

export const README_MAX_NUMBER_OF_COMMITS_CONSIDERED = 1000;

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

export async function getGitUserInfo(
  simpleGitObject: SimpleGit,
  commitHash?: string,
): Promise<{name: string; email: string}> {
  let usersRegExp = /(?:([^]+?)\s(<\S+\@\S+>))/;

  let userString: string;

  if (commitHash) {
    userString = await simpleGitObject.raw(
      '--no-pager',
      'show',
      '-s',
      '--format=%an <%ae>',
      commitHash,
    );
  } else {
    userString = await simpleGitObject.raw(
      '--no-pager',
      'show',
      '-s',
      '--format=%an <%ae>',
    );
  }

  let userInfo = userString.match(usersRegExp);

  let username = userInfo![1];
  let email = userInfo![2].match(/<([^]+)>/)![1];

  return {name: username, email};
}
