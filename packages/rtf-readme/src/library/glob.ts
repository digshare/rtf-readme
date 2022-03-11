import * as Path from 'path';

import fg from 'fast-glob';
import micromatch from 'micromatch';

export function globMatch(
  posixFilePath: string,
  dirPosixPath: string,
  patterns: string[],
  ignroePatterns: string[],
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

      if (task.base === '.') {
        if (
          reFilter(
            `./${relativePosixFilePath}`,
            convertPatternsToRe(task.positive),
            convertPatternsToRe(task.negative),
          )
        ) {
          return true;
        }
      }

      return reFilter(
        Path.posix.join(task.base, relativePosixFilePath),
        convertPatternsToRe(task.positive),
        convertPatternsToRe(task.negative),
      );
    } else {
      return false;
    }
  });
}

function makeRe(pattern: string): RegExp {
  return micromatch.makeRe(pattern);
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
