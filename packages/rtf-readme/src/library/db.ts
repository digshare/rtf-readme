import level from 'level';

class DB {
  private static dirPathToDBMap: Map<string, level.LevelDB> = new Map();

  static getDBObject(dirPath: string): level.LevelDB {
    if (!this.dirPathToDBMap.get(dirPath)) {
      this.dirPathToDBMap.set(dirPath, level(dirPath));
    }

    return this.dirPathToDBMap.get(dirPath)!;
  }
}

export function getDBObject(dirPath: string): level.LevelDB {
  return DB.getDBObject(dirPath);
}
