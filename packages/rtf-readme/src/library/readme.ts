import isGlob from 'is-glob';
import * as _ from 'lodash';

export function getFilesPatternsOfREADME(content: string): string[] {
  let filesPatterns: string[] = [];

  let readmeReg = /<!--\s*README(?:\s+([^]+?))??\s*-->/g;

  while (true) {
    let result = readmeReg.exec(content);

    if (!result) {
      break;
    }

    let patternReg = /\S+(?:[ \S]+\S)?/g;

    while (true) {
      let patternResult = patternReg.exec(result[1]);

      if (!patternResult) {
        break;
      }

      if (isGlob(patternResult[0])) {
        filesPatterns.push(patternResult[0]);
      } else {
        break;
      }
    }
  }

  filesPatterns = _.uniq(filesPatterns);

  return filesPatterns.map(filesPattern =>
    filesPattern.replace(/\\\\/g, '/').replace(/\\/g, '/'),
  );
}
