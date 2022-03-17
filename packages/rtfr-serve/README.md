# rtfr-serve

The CLI "rtfr-serve" is used to run a server and get a token which is supposed to be filled in '.rtfrrc'.

You can use "rtfr-serve --help" to get more information about the commands.

## Usage Example:

(1) "rtfr-serve 10000"

This subcommand is used to run a server, which is for centralizing the infos of users' reading of READMEs.

(2) "rtfr-serve new"

This subcommand will show you a token.

Notice, this subcommand cannot be executed when the "serve" subcommand is executing, as the leveldb cannot be accessed by two programs at the same time.

## License

MIT License.

## Requirements

1. As the command "rtfr-serve" is dependent on "level" (the js version of leveldb), you are suggested to run "rtfr-serve" under Linux/WSL/MacOS.
