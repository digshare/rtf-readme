import simpleGit, {SimpleGit} from 'simple-git';

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

// export async function testGit(simpleGitObject: SimpleGit, workspacePath: string): Promise<boolean> {
//   try {
//     await simpleGitObject.status();

//     return true;
//   } catch (e) {
//     let errorMsg = (e as any).toString();

//     console.error(
//       errorMsg
//         .startsWith('Error: fatal: not a git repository (or any of the parent directories): .git')
//       ? `not a git repository: ${workspacePath}\n` + errorMsg
//       : 'get git status failed.\n' + errorMsg
//     );

//     return false;
//   }
// }
