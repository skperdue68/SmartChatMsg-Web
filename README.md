# SmartChatMsg Web

Optional local companion for the SmartChatMsg ESO addon. Full scheduling remains available in the addon; this application offers a larger editor and schedule overview using the same SavedVariables data.

## Development status

The event timeline redesign is being implemented alongside the addon. Current foundations include a local Node server, branded workspace shell, and restricted Lua data parser. Complete event editing, schedule overview, migration and saving are not yet implemented. Do not use this development build to replace your live SavedVariables.

## Run locally

Requires Node 22 or newer. No packages are required for the server.

```sh
npm start
```

Open http://127.0.0.1:4173. Set PORT to choose another port. The server binds only to loopback. Files are selected in the browser and are not uploaded to a server or third party.

```sh
npm test
```

Never commit real account SavedVariables. Always exit ESO and back up the latest file before installing generated settings.
