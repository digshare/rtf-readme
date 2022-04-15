let loadREADMEFilePromises: Promise<boolean>[] = [];

export function getLoadREADMEFilePromises(): Promise<boolean>[] {
  return loadREADMEFilePromises;
}

export function setLoadREADMEFilePromises(promises: Promise<boolean>[]): void {
  loadREADMEFilePromises = promises;
}
