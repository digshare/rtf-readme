import * as Path from 'path';

import fg from 'fast-glob';
import micromatch from 'micromatch';

export function globMatch(
  posixFilePath: string,
  dirPosixPath: string,
  patterns: string[],
  ignroePatterns: string[],
  workspacePosixPath: string,
): boolean {
  patterns = patterns.concat(
    ignroePatterns.map(pattern =>
      pattern.startsWith('!') ? pattern.slice(1) : `!${pattern}`,
    ),
  );

  let tasks = fg.generateTasks(patterns);

  return tasks.some(task => {
    let root = Path.posix.resolve(dirPosixPath, task.base);

    let relativePosixFilePath: string;

    if (posixFilePath.startsWith(root)) {
      relativePosixFilePath = Path.posix.relative(root, posixFilePath);

      let positivePatterns = convertPatternsToRe(task.positive);
      let negativePatterns = convertPatternsToRe(task.negative);

      if (task.base === '.') {
        if (
          reFilter(
            `./${relativePosixFilePath}`,
            positivePatterns,
            negativePatterns,
          )
        ) {
          return true;
        }
      }

      return (
        reFilter(
          Path.posix.join(task.base, relativePosixFilePath),
          positivePatterns,
          negativePatterns,
        ) ||
        reFilter(
          `/${Path.posix.relative(workspacePosixPath, posixFilePath)}`,
          positivePatterns,
          negativePatterns,
        )
      );
    } else {
      return false;
    }
  });
}

function makeRe(pattern: string): RegExp {
  return micromatch.makeRe(pattern, {dot: true});
}

function convertPatternsToRe(patterns: string[]): RegExp[] {
  return patterns.map(pattern => makeRe(pattern));
}

function reFilter(
  posixFilePath: string,
  positiveRe: RegExp[],
  negativeRe: RegExp[],
): boolean {
  return (
    isMatchToPatterns(posixFilePath, positiveRe) &&
    !isMatchToPatterns(posixFilePath, negativeRe)
  );
}

function isMatchToPatterns(filePath: string, patternsRe: RegExp[]): boolean {
  return matchAny(filePath, patternsRe) || matchAny(`${filePath}/`, patternsRe);
}

function matchAny(filePath: string, patternsRe: RegExp[]): boolean {
  return patternsRe.some(patternRe => patternRe.test(filePath));
}
