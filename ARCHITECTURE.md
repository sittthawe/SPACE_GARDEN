# Architecture

This project is now organized as three clear layers:

- Frontend: browser UI in `public/index.html`, `public/admin.html`, `public/app.js`, and `public/admin.js`
- Backend: HTTP server and API routes in `server.js`
- Database: photo record CRUD, normalization, and database metadata in `database.js`

## How the layers work together

1. The frontend calls backend routes such as `/api/photos`, `/api/admin/login`, and `/api/admin/photos`.
2. The backend validates requests, handles auth, streams assets, and delegates photo record work to the database layer.
3. The database layer reads and writes album records through the configured storage adapter.
4. The storage adapter persists data either locally on disk or in Cloudflare R2.

## Database options

- `local`: album metadata is stored as JSON on disk and uploaded files are stored in the local uploads directory
- `r2`: album metadata and uploaded files are stored in Cloudflare R2 while the same backend API continues to serve them

This keeps the frontend stable even when the persistence layer changes.
