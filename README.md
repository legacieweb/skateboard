# Roll Call shop

For the Render deployment steps, see [RENDER_DEPLOY.md](RENDER_DEPLOY.md). The backend runs at `https://skateboard-wz0h.onrender.com`; the Blueprint deploys the storefront separately and builds it with that API URL.

The storefront is a static site: publish `index.html`, `styles.css`, `shop.js`, and `account.js` on any static host. The Node service in `server.js` is API-only and connects to IyonicDB, IyonicMailer, and Paystack. For local work, start the backend with `npm start`; the static build defaults to the Render backend URL and can be overridden with `API_BASE_URL`. Set `FRONTEND_URL` and `CORS_ORIGIN` to the static site's exact HTTPS origin in the API service. Product catalog entries are managed in IyonicDB and existing products can be edited from the admin dashboard.

## Server configuration

Copy `.env.example` to `.env` and set these values on the server:

- `IYONICDB_API_KEY` and `IYONICDB_URL` for the IyonicDB project.
- `IYONIC_MAILER_API_KEY` and `IYONIC_MAILER_API_URL` for account verification, password resets, and order receipts. Verify a sending provider in IyonicMailer first.
- `MAIL_FROM_EMAIL` for the sender email address used in all outgoing emails. Defaults to `ADMIN_EMAIL`.
- `PAYSTACK_PUBLIC_KEY` for the Paystack browser popup and `PAYSTACK_SECRET_KEY` for server-side verification. Set `PAYSTACK_CURRENCY` to the currency enabled for the Paystack account.
- `ADMIN_EMAIL`, `ADMIN_PASSWORD`, and `ADMIN_BOOTSTRAP_ENABLED=true` to create or update the admin at startup. Use a unique password with at least 14 characters. The server resets that account's password to the configured value when it starts. Leave bootstrap disabled after provisioning if you do not want startup to reset it again.
- `PUBLIC_BASE_URL` to the HTTPS site address in production. This address is used for payment callbacks and verification email links.
- `HOST` to `0.0.0.0` when your hosting platform requires it. For a separately hosted frontend, set `CORS_ORIGIN` to that exact HTTPS origin and set the `rollcall-api-base` meta tag in the static `index.html` to the backend origin. Cross-origin accounts require HTTPS so secure session cookies can be used.

The supplied IyonicDB and IyonicMailer keys are kept in the local, ignored `.env` file. Never deploy `.env` through source control; configure the same values in the hosting provider's secret manager instead.

## Paystack setup

The server creates a pending order with its authoritative amount, then returns the public key and reference to Paystack InlineJS v2 to open the popup. The public key is designed for frontend use; the secret remains on the server for payment verification and webhook signature validation. Set the webhook URL to `https://YOUR_DOMAIN/api/payments/webhook`. Checkout stays disabled until both Paystack keys are set.

## Account and order behavior

Customers register with an email and password, then can sign in immediately. Verification links, password resets, and order receipts are sent through IyonicMailer. Product prices and inventory are read on the server from IyonicDB; the browser's cart values never determine the charged amount. Orders under $100 have an $8 shipping charge; orders of $100 or more ship free.

The admin dashboard is available to the configured admin account. It shows orders, customers, revenue, and inventory, and supports adding and editing existing products, including price, stock, media, shipping destinations, and estimated shipping time, as well as changing fulfillment status.
