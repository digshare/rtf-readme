export const DEFAULT_RTF_README_SERVER = 'https://rtfr.mufan.com';

export function commitInputValidate(val: string): string | true {
  if (val === '') {
    return true;
  }

  if (val && val.match(/^[0-9a-zA-Z]{40}$/)) {
    return true;
  }

  return 'The commit hash string contains only 0-9, a-z and A-Z, and its length is 40.';
}

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
