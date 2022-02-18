import * as Path from 'path';

export function posixPathToPath(posixPath: string): string {
  let isAbsolutePath = Path.posix.isAbsolute(posixPath);

  let path = posixPath.split(Path.posix.sep).join(Path.sep);

  if (process.platform === 'win32' && isAbsolutePath) {
    path = path.slice(1);
  }

  return path;
}

export function pathToPosixPath(path: string): string {
  let isAbsolutePath = Path.isAbsolute(path);

  let posixPath = path.split(Path.sep).join(Path.posix.sep);

  if (!posixPath.startsWith('/') && isAbsolutePath) {
    posixPath = `/${posixPath}`;
  }

  return posixPath;
}
