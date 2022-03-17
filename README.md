# rtf-readme README

This project contains three parts: vscode extension named "rtf-README" and clis named "rtfr"("rtf-readme") and "rtfr-serve".

## Brief Introduction

Consider a situation, where a colleague change the README file, and he/she wants everybody who's contributing to the same project to read this README before they modify some files which the README has some hints for, introduces some constraints on or has something else that is relevant to. Warn the contributors manually can be annoying, so we write this project to automatically and gracefully warn the contributors.

In brief, this project is used to hint users to read README files when they read or change the files that the README has some information for.

## Get Started

Following the steps below, you can learn how to use this project.

(1) Create a project, or you can use a project that already exists.

(2) Download "rtf-readme" from npmjs.com.

(3) Create a config file for the project, either using "rtfr init" or using "RTF-README: Create Config File" command of vscode extension "rtf-README". For newbies, you can just use the default server URL config.

(4) Write README pattern into some READMEs, commit these changes by user A, and then open some files by user B in vscode which some README is associated to. If user B has not read the associated README, you can see a hint at the bottom right of vscode window.

(5) You can use "rtfr check" command to see the list of READMEs needed to be read by certain user. You can also use "rtfr read" command to "read" a README or open the README in vscode to show that you've read the README.

## Overall Introduction

### 1. README pattern

To get the extension rtf-README or CLI work, you should write "README pattern" into some README.md firstly. The README pattern is in glob pattern, and means that when the files whose paths match the README pattern are opened or modified, the README.md should be read. Using rtf-README extension, you will be hinted to read README.md when you open or modify the matched file. Using the subcommand "check" of command "rtfr", you will be informed which README.md has not been read by some user after he/she has changed some file concerned by the README.md.

#### README pattern format:

[1] &lt;!-- README packages/\*\*/\*.ts --&gt;

[2]

```
  <!-- README
       packages/**/*.ts
       packages/**/*.tsx
  -->
```

### 2. [Vscode extension](./packages/vscode-rtf-readme/README.md).

### 3. CLI

The CLI "rtfr" is used to find files changed by certain user while the relevant README is not read. It can also be used to create a config file named ".rtfrrc".

The CLI "rtfr-serve" is used to run a server and get a token which is supposed to be filled in '.rtfrrc'.

You can use "rtfr --help" or "rtfr-serve --help" to get more information about the commands.

#### [1] ["rtfr-serve"](./packages/rtfr-serve/README.md):

#### [2] ["rtfr" or "rtf-readme"](./packages/rtf-readme/README.md)

## License

MIT License.
