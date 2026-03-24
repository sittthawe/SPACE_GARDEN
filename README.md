# SPACEGARDEN

A full-stack photo album app with:

- public gallery page
- admin login panel
- image upload and delete actions
- local disk storage for uploaded files

## Run it

```bash
npm start
```

For auto-reload during development:

```bash
npm run dev
```

Open:

- `http://127.0.0.1:3000/`
- `http://127.0.0.1:3000/admin`

## Admin password

Set an admin password before starting the server:

```bash
$env:ADMIN_PASSWORD="your-password"
npm start
```

If you do not set one, the app falls back to:

```text
admin123
```

## Storage

- uploaded files go into `uploads/`
- album metadata is stored in `data/album.json`
- set `STORAGE_DIR` if you want uploads and album data stored somewhere else

## Test

```bash
npm test
```

## Deploy

This app is ready to run on a Node host such as Render.

Recommended environment variables:

```bash
ADMIN_PASSWORD=your-password
HOST=0.0.0.0
PORT=10000
STORAGE_DIR=/opt/render/project/src/storage
```

Important:

- this app stores uploads on disk
- on platforms with ephemeral storage, uploads are lost after restart or redeploy
- for Render, attach a persistent disk and mount it under `/opt/render/project/src/storage`
