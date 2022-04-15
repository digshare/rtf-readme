import {SimpleGit} from 'simple-git';

let workspacePathToGitDict: {[workspacePath: string]: SimpleGit} = {};

export class GitObjectManager {
  getGitObject(workspacePosixPath: string): SimpleGit {
    return workspacePathToGitDict[workspacePosixPath];
  }

  setGitObject(workspacePosixPath: string, simpleGitObject: SimpleGit): void {
    workspacePathToGitDict[workspacePosixPath] = simpleGitObject;
  }

  deleteGitObject(workspacePosixPath: string): void {
    delete workspacePathToGitDict[workspacePosixPath];
  }
}

export let gitObjectManager = new GitObjectManager();
