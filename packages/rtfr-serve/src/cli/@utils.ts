import {nanoid} from 'nanoid';

import {getDBObject} from '../library';

export async function newDBRecordAndGetToken(
  optionsPath: string,
): Promise<string> {
  let token: string;
  let db = getDBObject(optionsPath);

  while (1) {
    token = nanoid();

    try {
      await db.get(token);
    } catch (e) {
      if (
        !(e as any)
          .toString()
          .startsWith('NotFoundError: Key not found in database')
      ) {
        console.error(e);
      }

      break;
    }
  }

  await db.put(token!, '[]');
  await db.put(`~${token!}`, '[]');

  return token!;
}
