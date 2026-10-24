# Deploy Roll Call on Render

The backend API is the existing Render service at `https://skateboard-wz0h.onrender.com`. The `render.yaml` deploys the static storefront separately and configures its production API URL to that backend.

## Redeploy the backend

The supplied startup log shows the server listening on localhost. Render needs the Node server to listen on all interfaces. This repository now defaults `HOST` to `0.0.0.0`; push the updated `server.js` and redeploy the existing backend service. Keep Render's assigned `PORT` setting intact.

In the backend service's Render Environment settings, set:

- `FRONTEND_URL` to the static storefront's `onrender.com` URL after it is created.
- `CORS_ORIGIN` to the same exact storefront origin, with no trailing slash.
- Provider configuration: `IYONICDB_API_KEY`, `IYONIC_MAILER_API_KEY`, `MAIL_FROM_EMAIL`, `PAYSTACK_PUBLIC_KEY`, and `PAYSTACK_SECRET_KEY`.
- `ADMIN_EMAIL` and a unique `ADMIN_PASSWORD` of at least 14 characters. Set `ADMIN_BOOTSTRAP_ENABLED=true` only while provisioning the admin, then set it to `false` and redeploy.

The server uses Render's `RENDER_EXTERNAL_URL` for verification links and payment callbacks. Configure Paystack's webhook as `https://skateboard-wz0h.onrender.com/api/payments/webhook`.

## Deploy the storefront

1. Push the repository changes to the GitHub branch connected to Render.
2. Create or update the static site using this Blueprint (`render.yaml`), with the repository root as its root directory.
3. Render runs `npm ci && npm run build` and publishes `dist/`. The generated `index.html` points to `https://skateboard-wz0h.onrender.com`.
4. Copy the resulting static site's `onrender.com` origin into the backend's `FRONTEND_URL` and `CORS_ORIGIN`, then redeploy the backend.

Check `https://skateboard-wz0h.onrender.com/api/health` to confirm the API responds. If product requests return 502 after the service is listening, check the API logs and its IyonicDB credentials/availability; the health endpoint reports configured credentials but does not validate upstream connectivity. Render free web services may spin down after inactivity, making the first request slower.

Keep secrets in Render's Environment settings. Do not commit `.env` or put API keys into `render.yaml`.
