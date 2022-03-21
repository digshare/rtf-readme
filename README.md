# 📝 rtf-README

Prompt for unread doc changes.

## Features

- [VSCode Extension][vscode-extension] that prompt for unread doc changes.
- CLI command that checks if any recent changes are made without the author having read related docs.

## Getting Started with VSCode

1. Install [VSCode Extension][vscode-extension] and create config file using command `rtf-README: Create Config File`.

   > You will be asked to enter an rtf-README server address (defaults to `https://rtfr.mufan.com`) for storing commit hashes of READMEs that users read.
   >
   > You can also setup your own server using CLI `rtfr-serve` (provided by npm package `rtf-readme`).
   >
   > Also check out the `.rtfrrc` generated for common options.

2. Edit a `README.md` file and append the following code:

   ```html
   <!-- README ** -->
   ```

   Or in multiline to support multiple patterns.

   ```html
   <!--
     README
       **
   -->
   ```

   The pattern is relative to the markdown file, or `/` relative to `.rtfrrc`.

3. Add `enverse.vscode-rtf-readme` to VSCode Recommended Extensions (`.vscode/extensions.json`) so that your teammate would not forget to install the extension.

   ```json
   {
     "recommendations": ["enverse.vscode-rtf-readme"]
   }
   ```

4. Now, if anyone else (using VSCode with the extension) opened a file matched by `**` (obviously any file except for those ignored by `ignore` config option in `.rtfrrc`), they will get prompted to read the f\*\*\*ing README (with diff):

   <center>
     <img width="480" alt="rtf-README prompt" src="https://user-images.githubusercontent.com/970430/159254726-9a9918c2-9852-4954-90b1-d27c5e966d85.png">
   </center>

## Getting Started with CLI

1. Install npm package:

   ```bash
   yarn add -D rtf-readme
   # or
   npm install -D rtf-readme
   ```

2. Check the docs reading status:

   ```bash
   yarn rtfr check
   # or
   npx rtfr check
   ```

   You can add this to your CI/CD flow to make sure everyone read docs they are expected to read.

## License

MIT License.

[vscode-extension]: https://marketplace.visualstudio.com/items?itemName=enverse.vscode-rtf-readme
