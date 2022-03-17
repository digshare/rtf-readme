# rtf-readme

This project is used to hint users to read README files when they read or change the files that the README has some information for. It is also used to modify cache on the server side by reading command, which means you've read certain README. It can be used to create a config file named ".rtfrrc" as well.

You can use "rtfr --help" to get more information about the commands.

## Usage Example:

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
   * What you can get by subcommand "new" or fetched from "rtfr" server,
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

## License

MIT License.
