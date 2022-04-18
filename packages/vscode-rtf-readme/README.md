# Vscode extension rtf-README.

This extension is used to help users find the situation that files are changed while the README concerning these files is not read.

Read [README.md](https://github.com/digshare/rtf-readme/blob/main/README.md) of the project which includes this extension to learn how to use this extension.

#### Contributes

(1) RTF-README: Show READMEs Associated To This File

This is a command that you can use to list READMEs that is relavant to current active file.

(2) RTF-README: Create Config File

This command could help you to create a config file used by extension and CLI.

Note: You can also create ".rtfrrc" manually, the format is shown below.

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
   * What you can get by command "rtfr-serve new" or that is fetched from "rtfr" server,
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

#### Other features

(1) Display on top of the active editor how many READMEs is associated current active file.

   <center>
     <img alt="rtf-README prompt" src="https://user-images.githubusercontent.com/10010805/163745300-75242ab7-aea2-4dec-9ae6-41298683e42a.png">
   </center>

(2) Show hint information message at the bottom right of vscode's window if you need to read some README.

   <center>
     <img width="480" alt="rtf-README prompt" src="https://user-images.githubusercontent.com/970430/159254726-9a9918c2-9852-4954-90b1-d27c5e966d85.png">
   </center>

## Extension Settings

None.

## Known Issues

#### 1. Computer becomes hot when using rtf-README extension.

This could be the result of error "System limit for number of file watchers reached".

#### 2. "FetchError: request to https://xxx.xxx.com failed, reason: certificate has expired"

If you see this error, you can simply turn off "Http: System Certificates" in vscode "Settings" to solve this problem.
