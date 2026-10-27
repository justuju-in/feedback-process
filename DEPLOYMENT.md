# Environment-safe deployment setup

Production and staging must use separate backend services and separate MySQL
databases. Never point the staging frontend at the production backend.

## 1. Deploy separate backends and databases on Railway

1. Create one Railway project for production and another for staging.
2. Add a separate MySQL service to each Railway project.
3. For the backend service, set **Root Directory** to `/backend` and
   **Config File Path** to `/backend/railway.toml`.
4. Add these backend service variables in Railway. Reference the values from
   the Railway MySQL service for the five `DB_` variables.

```env
DB_HOST=<Railway MySQL host>
DB_PORT=<Railway MySQL port>
DB_USER=<Railway MySQL user>
DB_PASSWORD=<Railway MySQL password>
DB_NAME=<Railway MySQL database>
JWT_SECRET=<a long random secret>
FRONTEND_ORIGIN=https://<Vercel frontend domain>
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=<sender email>
SMTP_PASS=<Google App Password>
EMAIL_FROM=<sender email>
```

5. Import `backend/scripts/schema.sql` into each Railway MySQL database once.
6. Generate a public Railway domain for each backend and verify:
   `https://<backend-domain>/health`.

Never add real passwords, tokens, or SMTP credentials to Git.

## 2. Deploy the frontend on Vercel

1. Import the same GitHub repository into Vercel for production and staging.
2. Keep the repository root as the Vercel project Root Directory.
3. Configure the production frontend with:

```env
APP_ENV=production
API_PROXY_TARGET=https://<production Railway backend domain>
```

4. Configure the staging frontend with:

```env
APP_ENV=staging
API_PROXY_TARGET_STAGING=https://<staging Railway backend domain>
```

   Staging fails to build if `API_PROXY_TARGET_STAGING` is missing, preventing
   it from silently sending test data to production.
5. Deploy both frontends.
6. Set each backend's `FRONTEND_ORIGIN` to its matching frontend domain, then
   redeploy both backends.

The browser continues to call `/api`. The Next.js rewrite in
`next.config.mjs` forwards each environment to its own Railway backend.

## 3. Test each isolated environment

1. Register a user on the Vercel URL.
2. Open **Forgot password** and submit that registered email.
3. Open the reset link received by email.
4. Set the new password; the app should return to the Login page.
5. Log in with the new password.

After this deployment, normal users only need the Vercel website URL. They do
not need the repository, a local backend, MySQL, or SMTP configuration.
