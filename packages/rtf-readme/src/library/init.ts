export const DEFAULT_RTF_README_SERVER = 'https://rtfr.mufan.com';

export function serverConfigValidate(val: string): string | true {
  let errorString = 'You should input url whose protocol is http or https.';

  if (!val) {
    return errorString;
  }

  let url;

  try {
    url = new URL(val);
  } catch (e) {
    return `${errorString}\n${(e as any).toString()}`;
  }

  return url.protocol === 'http:' || url.protocol === 'https:'
    ? true
    : errorString;
}
