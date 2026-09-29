# Deployment overview

ABI runs as two services: the API on a persistent application host and the web
console on a frontend host. The repository includes a Render Blueprint for the
API and can be connected to a Vercel project for the console.

## Deploy the API

1. Connect the repository to Render and create the service from its Blueprint.
2. Complete the private environment setup requested by the host. Keep API
   credentials in the host's secret manager; do not add them to repository
   files or client-side variables.
3. Confirm the service is healthy in the Render dashboard and that its
   persistent storage is attached.

## Deploy the console

1. Connect the repository to Vercel and deploy the console project.
2. Set the private API origin and the shared registration setting in the
   Vercel project environment, matching the values configured for the API.
3. Redeploy the console after changing project environment settings.

## Verify the release

- Open the console and confirm account creation and email verification work.
- Confirm the API and console both report healthy in their hosting dashboards.
- Exercise a small sandbox payment and confirm ABI records the policy decision.
- Treat test-network results as development checks; complete a reviewed,
  funded end-to-end test before describing live settlement as verified.

## Production readiness

Before inviting external users, confirm persistent backups, account recovery,
email delivery, monitoring, incident ownership, and payment review procedures.
Configure all production-only values in the relevant hosting dashboards, and
verify them there without copying their values into source control.
