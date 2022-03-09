import http from 'http';
import * as Path from 'path';

import {Command, Options, command, metadata, option, param} from 'clime';
import {isLeft} from 'fp-ts/Either';
import * as t from 'io-ts';
import Koa from 'koa';
import bodyParser from 'koa-bodyparser';
import Router from 'koa-router';
import _ from 'lodash';

import {Cache, RawUserInfo, UserInfo, getDBObject} from '../../library';

import {newDBRecordAndGetToken} from './@utils';

const COOKIE_KEYS = ['rtf-readme-17', 'rtfr-serve'];

let UserInfo = t.type({
  name: t.string,
  email: t.string,
  files: t.array(
    t.type({
      path: t.string,
      commit: t.string,
    }),
  ),
});

export class ServeOptions extends Options {
  @option({
    flag: 'd',
    description:
      'The directory path to save db data. Default is cwd()/rtf-readme-db.',
    default: './rtf-readme-db',
  })
  dir!: string;
  @option({
    flag: 'g',
    description: 'If true, this program will generate a token.',
    toggle: true,
  })
  generate!: string;
}

@command({
  description: 'Run a server for centralizing rtf-README config',
})
export default class extends Command {
  @metadata
  async execute(
    @param({
      description: 'Server port',
      required: true,
    })
    port: number,
    options: ServeOptions,
  ): Promise<void> {
    let workspacePath = options.dir
      ? Path.resolve(process.cwd(), options.dir)
      : process.cwd();

    let token: string | undefined;

    if (options.generate) {
      try {
        token = await newDBRecordAndGetToken(workspacePath);

        // eslint-disable-next-line no-console
        console.log(token);
      } catch (e) {
        console.error('Generate token failed.');

        console.error(e);
      }
    }

    const db = getDBObject(workspacePath);

    const app = new Koa({
      keys: COOKIE_KEYS,
    });

    app.use(async (_ctx, next) => {
      try {
        await next();
      } catch (e) {
        console.error(e);
      }
    });

    app.use(bodyParser());

    const router = new Router();

    router.get('/cache/:token', async ctx => {
      let token = ctx.params.token;

      let users: RawUserInfo[] = JSON.parse(await db.get(token));

      let cache: Cache = {
        users: await Promise.all(
          users.map(async (user: {name: string; email: string}) => {
            let files: {path: string; commit: string}[] = JSON.parse(
              await db.get(userToString(user)),
            );

            return {
              ...user,
              files,
            };
          }),
        ),
      };

      ctx.body = JSON.stringify(cache);
    });

    router.post('/cache/:token', async ctx => {
      let token = ctx.params.token;

      let users = JSON.parse(await db.get(token));

      let userInfo = ctx.request.body as UserInfo;

      if (isLeft(UserInfo.decode(userInfo))) {
        ctx.body = 'userInfo in wrong format';

        return;
      }

      let rawUserInfo = {
        name: userInfo.name,
        email: userInfo.email,
      };

      let rawUserInfoString = userToString(rawUserInfo);

      if (_.find(users, rawUserInfo)) {
        let files = JSON.parse(await db.get(rawUserInfoString));

        let concatAndUniqFiles = _.uniqWith(
          userInfo.files.concat(files),
          _.isEqual,
        );
        let uniqFiles = _.uniqBy(concatAndUniqFiles, 'path');

        if (concatAndUniqFiles.length > uniqFiles.length) {
          ctx.body = {
            ...rawUserInfo,
            files: concatAndUniqFiles.filter(file =>
              userInfo.files.some(
                userInfoFile => userInfoFile.path === file.path,
              ),
            ),
          };
        } else {
          ctx.body = 'ok';
        }

        await db.put(rawUserInfoString, JSON.stringify(concatAndUniqFiles));
      } else {
        users = [...users, rawUserInfo];

        await db.put(token, JSON.stringify(users));

        await db.put(rawUserInfoString, JSON.stringify(userInfo.files));

        ctx.body = 'ok';
      }
    });

    // delete the input files
    router.put('/cache/:token', async ctx => {
      let token = ctx.params.token;

      await db.get(token);

      let userInfo = ctx.request.body as UserInfo;

      if (isLeft(UserInfo.decode(userInfo))) {
        ctx.body = 'userInfo in wrong format';

        return;
      }

      let rawUserInfoString = userToString(userInfo);
      let files = JSON.parse(await db.get(rawUserInfoString));

      for (let file of userInfo.files) {
        _.remove(files, file);
      }

      await db.put(rawUserInfoString, JSON.stringify(files));

      ctx.body = 'ok';
    });

    app.use(router.routes()).use(router.allowedMethods());

    http.createServer(app.callback()).listen(port);
  }
}

function userToString(user: RawUserInfo): string {
  return `{"name":"${user.name}","email":"${user.email}"}`;
}
