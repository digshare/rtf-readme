import simpleGit, {SimpleGit} from 'simple-git';

export const MAGIC_GIT_INITIAL_COMMIT =
  '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

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
