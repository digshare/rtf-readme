import * as Net from 'net';

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
  let errorString = 'The format is "http(s)://(ip or domain name):port"';

  if (!val) {
    return errorString;
  }

  let url;

  try {
    url = new URL(val);
  } catch (e) {
    return errorString;
  }

  return url.protocol === 'http:' || url.protocol === 'https:'
    ? true
    : errorString;
}

export function tokenValidate(val: string): string | true {
  if (!val) {
    return 'Token is required for config file';
  }

  return true;
}
