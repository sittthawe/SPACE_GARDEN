# SPACEGARDEN

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https%3A%2F%2Fgithub.com%2Fsittthawe%2FSPACE_GARDEN)

A full-stack photo album app with:

- public gallery page
- admin login panel
- image upload and delete actions
- local disk storage for development
- Cloudflare R2 storage for deployed images and album metadata

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

If you do not set one, the app uses a built-in development default. For safety, always set `ADMIN_PASSWORD` in every environment.

## Storage modes

### Local mode (default)

By default:

- uploaded files go into `uploads/`
- album metadata is stored in `data/album.json`
- set `STORAGE_DIR` if you want uploads and album data stored somewhere else
- local mode is best for development, not for production deploys
- on Render, use a persistent disk mount for `STORAGE_DIR` so uploads survive deploys and restarts

### Cloudflare R2 mode

If these environment variables are present, the app switches to R2 automatically:

```bash
R2_ACCOUNT_ID=your-cloudflare-account-id
R2_BUCKET=your-r2-bucket-name
R2_ACCESS_KEY_ID=your-r2-access-key
R2_SECRET_ACCESS_KEY=your-r2-secret-key
```

Optional R2 settings:

```bash
R2_ALBUM_KEY=album.json
R2_UPLOAD_PREFIX=uploads
```

Notes:

- when R2 mode is enabled, both uploaded images and album metadata are stored in R2
- the app still serves images from `/uploads/...`, so your bucket does not need to be public
- set `STORAGE_MODE=local` to force local disk mode even if R2 env vars exist
- set `STORAGE_MODE=r2` to require R2 mode explicitly

## Test

```bash
npm test
```

## Deploy

This app is ready to run on a Node host such as Render.

Recommended environment variables for an R2-backed deploy:

```bash
ADMIN_PASSWORD=your-password
HOST=0.0.0.0
PORT=10000
R2_ACCOUNT_ID=your-cloudflare-account-id
R2_BUCKET=your-r2-bucket-name
R2_ACCESS_KEY_ID=your-r2-access-key
R2_SECRET_ACCESS_KEY=your-r2-secret-key
R2_ALBUM_KEY=album.json
R2_UPLOAD_PREFIX=uploads
```

Important:

- the included `render.yaml` mounts a persistent disk at `/opt/render/project/src/storage` and sets `STORAGE_DIR` there
- if you do not set the R2 secrets, uploads stay on that disk and survive deploys and restarts
- if you do set the R2 secrets, the app switches to R2 automatically and stores both images and album metadata outside the app filesystem
- local uploaded files and `data/album.json` are now ignored in git so gallery content stays out of the repository

