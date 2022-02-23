# rtf-readme README

This project contains two parts: vscode extension named "rtf-README" and cli named "rtfr".

This project is used to hint users to read README files when they read or change the files that the README has some information for.

To test this project, create a project. Add a README.md and "README pattern"(the format is shown below) into the README.md. Then commit the README file by user 'A'. Then, use user 'B' which is different from user 'A'.

- To test exetions, open the file in vscode that is contained in "README pattern" added in the README.md previously. Check whether the extension hints you.
- To test CLI, you use the command to check whether the CLI would report errors about the README.md and the files contained in "README pattern".

## Features

#### README pattern format:

[1] `<!-- README packages/**/*.ts -->`

[2]

```
  <!-- README
       packages/**/*.ts
       packages/**/*.tsx
  -->
```

### 1. Vscode extension.

This extension is used to help users find the situation that files are changed but the README concerning this file is not read.

### 2. CLI

The CLI program is used to find files changed while the relavant README is not read. It is also used to modify the cache file ".rtf-readme.json" by reading command, which means you've read certain README.

#### Usage Example:

[1] `rtfr check`

This is used to find the README which is not read while it needs to be read.

[2] `rtfr read dir/README.md`

This means you've read dir/README.md.

## Requirements

None.

## Extension Settings

None.

## Known Issues

## Release Notes
