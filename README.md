# rtf-readme README

This project contains two parts: vscode extension named "rtf-README" and cli named "rtfr".

## Features

### 1. Vscode extension.

This extension is used to help users find files changed while the README concerning this file is not read.

#### README pattern：

[1] `<!-- README packages/**/*.ts -->`

[2]

```
  <!-- README
       packages/**/*.ts
       packages/**/*.tsx
  -->
```

### 2. CLI

The CLI program is used to find files changed while the relavant README is not read. It is also used to modify the cache file ".rtf-readme.json" by reading command, which means you've read certain README.

#### Usage Example:

[1] `rtfr .`

This is used to find the README which is not read while it needs to be read.

[2] `rtfr . --read dir/README.md`

This means you've read dir/README.md.

## Requirements

None.

## Extension Settings

None.

## Known Issues

## Release Notes
