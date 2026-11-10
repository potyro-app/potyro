# create-potyro

Start a [Potyro](https://potyro.app) app: one command makes a folder with an app in it that packs,
tests and typechecks.

```sh
npm create potyro@latest my-app
cd my-app
npm install
npm run build      # → dist/my-app.potyro-app.zip
```

In Potyro, **Add an app → From this device** installs the zip. Then follow
[Your first Potyro app](https://potyro.com/docs/start/your-first-app/).

`npm create potyro@latest my-app -- --title "My app"` names the app something other than its folder.

The project depends on [`potyro`](https://www.npmjs.com/package/potyro), which has `defineApp`, the
types and `potyro pack`. Node 20 or newer. The documentation is at
[potyro.com/docs](https://potyro.com/docs/).

## Licence

Apache-2.0; the files in `template/`, which become your project, are MIT No Attribution, so an app
started from them carries no notice of ours. The source is at
[github.com/potyro-app/potyro](https://github.com/potyro-app/potyro), in `packages/create-potyro`.
