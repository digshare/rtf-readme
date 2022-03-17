# Vscode extension rtf-README.

This extension is used to help users find the situation that files are changed but the README concerning these files is not read.

To use this extension, firstly, you should use command "rtfr-serve" of the CLI provided by the package [rtfr-serve](https://www.npmjs.com/package/rtfr-serve) to run a server. And secondly, you should use subcommand "init" provided by the package [rtf-readme](https://www.npmjs.com/package/rtf-readme) to create a config file named ".rtfrrc".

#### Contributes

(1) RTF-README: Show READMEs Associated To This File

This is a command that you can use to list READMEs that is relavant to current active file.

(2) RTF-README: Create Config File

This command could help you to create a config file used by extension and CLI.

#### Other features

(1) Display on top of the active editor how many READMEs is associated current active file.

(2) Show hint information message at the bottom right of vscode's window if you need to read some README.

## Extension Settings

None.

## Known Issues

#### 1. Computer becomes hot when using rtf-README extension.

This could be the result of error "System limit for number of file watchers reached".

#### 2. "FetchError: request to https://xxx.xxx.com failed, reason: certificate has expired"

If you see this error, you can simply turn off "Http: System Certificates" in vscode "Settings" to solve this problem.
