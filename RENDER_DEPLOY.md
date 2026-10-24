# Deploy Roll Call on Render

This repository deploys two Render services from `render.yaml`: a Node API and a static storefront. The static build reads the API service URL and writes it into the storefront's `rollcall-api-base` setting. The API gets the storefront URL for CORS and account/payment redirects.

## Deploy

1. Commit and push the repository, including `render.yaml`, `build-static.js`, and the repaired `package.json`, to the GitHub branch you want Render to deploy.
2. In Render, choose **New + → Blueprint**, connect `legacieweb/skateboard`, and select the branch. Render will read `render.yaml` and create both services.
3. Enter the requested secret values in the Blueprint form:
   - `IYONICDB_API_KEY` from your IyonicDB project.
   - `IYONIC_MAILER_API_KEY` and `MAIL_FROM_EMAIL` from your verified IyonicMailer sender setup.
   - `PAYSTACK_PUBLIC_KEY` and `PAYSTACK_SECRET_KEY` for the Paystack account.
   - `ADMIN_EMAIL` and a unique `ADMIN_PASSWORD` of at least 14 characters.
4. Apply the Blueprint and wait for both services to finish deploying. The Node service health check is `/api/health`; open the static service's `onrender.com` URL to use the shop.
5. Once the admin account has been provisioned, change `ADMIN_BOOTSTRAP_ENABLED` to `false` in the API service's Environment settings and redeploy. This prevents startup from resetting the admin password to the configured bootstrap password.
6. In Paystack, configure the webhook URL as `https://<your-api-service>.onrender.com/api/payments/webhook`.

The Render URLs are connected automatically through Blueprint service references. Do not set a localhost API URL for production. Keep API keys and admin credentials in Render's Environment settings; do not commit `.env` or paste secrets into `render.yaml`.

## Deployment notes

- `/api/health` reports whether database, mailer, and Paystack credentials are present. It does not guarantee that an upstream provider is reachable. If products fail to load with a 502 response, inspect the API service logs and check IyonicDB availability and credentials.
- Render's free web service may spin down after inactivity, which can make the first API request take longer. The storefront remains a static service.
- After changing build settings or secrets, redeploy the affected service. API URL references are applied during the static build.
