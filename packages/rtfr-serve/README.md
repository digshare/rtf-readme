# rtfr-serve

The CLI "rtfr-serve" is used to run a server and get a token which is supposed to be filled in '.rtfrrc'.

You can use "rtfr-serve --help" to get more information about the commands.

## Usage Example:

(1) "rtfr-serve 10000 -g"

This subcommand is used to run a server, which is for centralizing the infos of users' reading of READMEs.

This subcommand will show you a token if "-g" is followed.

(2) "rtfr-serve new"

This subcommand will show you a token.

Notice, this subcommand cannot be executed when the "serve" subcommand is executing, as the leveldb cannot be accessed by two programs at the same time.

## License

MIT License.
