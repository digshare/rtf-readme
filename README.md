# rtf-readme README

This project contains three parts: vscode extension named "rtf-README" and clis named "rtfr"("rtf-readme") and "rtfr-serve".

## Brief Introduction

Consider a situation, where a colleague change the README file, and he/she wants everybody who's contributing to the same project to read this README before they modify some files which the README has some hints for, introduces some constraints on or has something else that is relevant to. Warn the contributors manually can be annoying, so we write this project to automatically and gracefully warn the contributors.

In brief, this project is used to hint users to read README files when they read or change the files that the README has some information for.

## Usage Introduction

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

### 2. Vscode extension.

This extension is used to help users find the situation that files are changed but the README concerning these files is not read.

To use this extension, firstly, you should use command "rtfr-serve" of the CLI provided by the package [rtfr-serve](https://www.npmjs.com/package/rtfr-serve) to run a server. And secondly, you should use subcommand "init" provided by the package [rtf-readme](https://www.npmjs.com/package/rtf-readme) to create a config file named ".rtfrrc". The token you need when using subcommand "init" can be generated by command "rtfr-serve" followed by "-g" or its subcommand "new" .

### 3. CLI

The CLI "rtfr" is used to find files changed by certain user while the relevant README is not read. It can also be used to create a config file named ".rtfrrc".

The CLI "rtfr-serve" is used to run a server and get a token which is supposed to be filled in '.rtfrrc'.

You can use "rtfr --help" or "rtfr-serve --help" to get more information about the commands.

#### [1] "rtfr-serve" Usage Example:

(1) "rtfr-serve 10000 -g"

This subcommand is used to run a server, which is for centralizing the infos of users' reading of READMEs.

This subcommand will show you a token if "-g" is followed.

(2) "rtfr-serve new"

This subcommand will show you a token.

Notice, this subcommand cannot be executed when the "serve" subcommand is executing, as the leveldb cannot be accessed by two programs at the same time.

#### 2) "rtfr" or "rtf-readme" Usage Example:

(1) "rtfr init"

This subcommand is used to create a config file named ".rtfrrc" needed by extension and cli. You'd better run command "rtfr-serve" on the server side before executing this command.

You can also create ".rtfrrc" manually, the format is shown below.

```ts
interface RTFReadmeConfig {
  /**
   * The commit which you want the check command searchs from,
   */
  init?: string;
  /**
   * Server config, the format is "http(s)://xxx.xxx.xxx.xxx:ddddd".
   */
  server: string;
  /**
   * What you can get by subcommand "serve" or "new",
   */
  token: string;
  /**
   * The path of directory or file to be ignored when processing.
   */
  ignore?: string | string[];
  /**
   * The pattern of README file path to be included when processing.
   */
  readme?: string | string[];
}
```

(2) "rtfr read dir/README.md"

This means you've read dir/README.md. A config file '.rtfrrc' is needed before executing this subcommand.

(3) "rtfr check"

This is used to find the README which is not read while it needs to be read. A config file '.rtfrrc' is needed before executing this subcommand.

## Requirements

1. As the command "rtfr-serve" is dependent on "level" (the js version of leveldb), you are suggested to run "rtfr-serve" under Linux/WSL/MacOS.

## Extension Settings

None.

## Known Issues

#### 1. Computer becomes hot when using rtf-README extension.

This could be the result of error "System limit for number of file watchers reached".

#### 2. "FetchError: request to https://xxx.xxx.com failed, reason: certificate has expired"

If you see this error, you can simply turn off "Http: System Certificates" in vscode "Settings" to solve this problem.
