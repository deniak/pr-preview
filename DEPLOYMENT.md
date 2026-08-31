# Deployment

PR Preview is a small Node.js Express server that receives GitHub webhooks, builds spec previews, and uploads results to S3. It has no database and no persistent local state, so it runs on any host that can serve a long-running Node process on an HTTP port.

## Requirements

- Node.js 20 or newer (see `engines` in `package.json`)
- A public HTTPS endpoint for GitHub to POST webhooks to
- An AWS S3 bucket the app can write to
- A GitHub App registration (see below)
- Outbound HTTPS access to `api.github.com`, S3, and the spec-generator services listed in `lib/services.js`

Any host that satisfies those requirements will work: a container platform, a PaaS, a VM behind a reverse proxy, etc. The rest of this doc is written to be host-agnostic.

## GitHub App

PR Preview is delivered as a [GitHub App](https://docs.github.com/en/apps/creating-github-apps/about-creating-github-apps/about-creating-github-apps): repository owners install it once, GitHub then POSTs pull-request webhook events to a URL the app owns, and the app authenticates back to the GitHub API using a private key (as a JWT-signed App identity) plus per-installation access tokens. See [`lib/auth.js`](lib/auth.js) for the token exchange.

The public listing is at https://github.com/apps/pr-preview and the owner-only settings page is at https://github.com/settings/apps/pr-preview. See the [README](README.md) for the user-facing view (what it does for a PR author/reviewer).

There are two options for the GitHub side of the migration. Pick one before starting.

### Option A: keep the existing GitHub App (recommended)

Reuse https://github.com/apps/pr-preview. All existing installations (w3c, whatwg, wicg, w3ctag, and individual repos) keep working with no action from repo owners.

**What must change** (at https://github.com/settings/apps/pr-preview):

- **Webhook URL** → `https://<new-host>/github-hook`

**What must be re-supplied to the new host** (same values Heroku currently uses):

- `GITHUB_INTEGRATION_ID` — the numeric App ID at the top of the App settings page. Never changes.
- `GITHUB_INTEGRATION_KEY` — PEM contents of a private key. Existing keys stay valid; re-use the current one or generate a fresh one under "Private keys" and delete the old.
- `GITHUB_SECRET` — the webhook signing secret. Must match whatever is set on the App settings page.
- `GITHUB_TOKEN` — personal access token used as a fallback for unauthenticated calls.

**What does not change:** permissions, event subscriptions, installations, App slug/icon/homepage. Nothing repo owners need to do.

**Optional secret rotation.** The migration is a natural point to rotate `GITHUB_INTEGRATION_KEY`, `GITHUB_SECRET`, and `GITHUB_TOKEN` so any credentials leaked into Heroku's platform/logs are invalidated. If you rotate: generate the new values, put them in the new host's env, cut over the Webhook URL, then delete the old private key entry and revoke the old token.

**Optional ownership transfer.** If you also want the App to live under a different user or organization (e.g. handing off to a new maintainer or moving from a personal account to an org), transfer it at **Settings → Developer settings → GitHub Apps → pr-preview → Advanced → Transfer ownership**. Per [GitHub's docs](https://docs.github.com/en/apps/maintaining-github-apps/transferring-ownership-of-a-github-app), the destination can be any user or organization (not a team), and only the current owner or an app manager can initiate. In practice:

- **What carries over:** App ID (`GITHUB_INTEGRATION_ID` unchanged), private keys, webhook URL and secret, permissions and event subscriptions, and all installations — no repo owner has to reinstall.
- **What to watch for:** the app slug (`pr-preview`) only carries over if it doesn't collide on the new owner (a collision would rename the app and change its public URL); `GITHUB_TOKEN` is tied to a user account, not the App, so if the operator changes too, issue a fresh token from the new operator's account.
- Ownership transfer is independent of the host move: you can do it before, after, or not at all.

### Option B: register a new GitHub App

Only worth it if you want a clean identity separate from the Heroku-era app (e.g. a different owner account, or you've lost access to the current secrets and can't rotate them). This is a breaking change for every installation.

Register at Settings → Developer settings → GitHub Apps → New GitHub App:

- **Webhook URL**: `https://<new-host>/github-hook`
- **Webhook secret**: a random string; use the same value for `GITHUB_SECRET`
- **Permissions** (Repository):
  - Contents: Read (to fetch `.pr-preview.json` and source files)
  - Pull requests: Read & write (to update the PR body with preview links)
  - Metadata: Read (granted automatically)
- **Subscribe to events**: Pull request
- **Private key**: generate one and save the `.pem`; its contents go into `GITHUB_INTEGRATION_KEY`
- Note the numeric **App ID**; it goes into `GITHUB_INTEGRATION_ID`

Also generate a personal access token (fine-grained, `Contents: Read` on target repos is enough) and set it as `GITHUB_TOKEN`.

**Migration cost of Option B:** every org and repo currently using PR Preview must install the new app (the old one keeps running against Heroku until you shut that down). Plan communication with w3c, whatwg, wicg, and w3ctag before choosing this route.

## AWS S3

PR Preview writes preview and diff HTML to S3 and serves the resulting URLs from the PR comment. It uses **two** buckets, dispatched at runtime by the PR owner (see `lib/models/pr.js:200` and `lib/cache.js`):

1. **Default bucket** — used for every repo *except* those owned by `whatwg`. Credentials come from `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`; bucket name comes from `AWS_BUCKET_NAME`. Preview URLs are direct S3 URLs: `https://<bucket>.s3.amazonaws.com/<key>`.
2. **WHATWG bucket** — used only when the PR owner is `whatwg`. Credentials come from `WHATWG_AWS_ACCESS_KEY_ID` / `WHATWG_AWS_SECRET_ACCESS_KEY`; bucket "name" comes from `WHATWG_AWS_BUCKET_NAME`. **This env var holds a hostname, not a plain S3 bucket name** — the URL is built as `https://<WHATWG_AWS_BUCKET_NAME>/<key>` (see `lib/cache.js:17-20`). In production this hostname points at the bucket through a fronting layer (CloudFront distribution and/or a Route 53 alias) so that WHATWG-hosted previews live under a WHATWG-owned domain. Whatever the fronting layer is today, it just needs to keep resolving to the same bucket.

Required S3 permissions on each bucket for the credentials in use:

- `s3:PutObject`
- `s3:GetObject`
- `s3:HeadObject`

Objects should be publicly readable (previews are served directly to browsers from the URLs above), typically via a bucket policy that grants `s3:GetObject` to `*`.

Set `ALLOW_MULTIPLE_AWS_BUCKETS=no` to disable the WHATWG bucket path entirely and route every PR through the default bucket — useful if you don't have WHATWG credentials or want to simplify the deploy.

### Option A: keep the existing S3 buckets (recommended)

Nothing about the host move requires touching S3. Both buckets can stay exactly where they are; just re-supply the same six env vars (`AWS_*`, `WHATWG_AWS_*`) to the new host. No object copy, no DNS change, no fronting-layer change, no impact on existing preview URLs already linked from open PR comments.

**Optional credential rotation.** As with the GitHub secrets, the migration is a good time to rotate the IAM access keys so any keys leaked into Heroku's platform/logs are invalidated: issue new keys in the same IAM users, put them in the new host's env, cut over, then deactivate the old keys.

### Option B: move a bucket to a different AWS account

Only worth it if bucket ownership itself needs to change (e.g. moving off a personal AWS account onto an org account, or handing WHATWG's bucket back to WHATWG's own AWS account). S3 buckets **cannot be transferred** between accounts — the move is a copy + cutover:

1. Create a new bucket in the destination account. Bucket names are global, so pick a new name unless you plan to delete the source bucket first.
2. Copy objects across: `aws s3 sync s3://<old-bucket> s3://<new-bucket>` from a role with read on the source and write on the destination, or use S3 Batch Replication for large buckets.
3. Apply the same public-read bucket policy and CORS config to the new bucket.
4. If the bucket had a fronting layer (the WHATWG case), repoint CloudFront's origin and/or the Route 53 record at the new bucket. The `WHATWG_AWS_BUCKET_NAME` env var stays the same because it holds the hostname, not the bucket name.
5. Update the app's env vars (`AWS_BUCKET_NAME` or the WHATWG credentials) to point at the new bucket / new IAM user.
6. Leave the old bucket up read-only for a grace period so previously-posted preview URLs keep resolving; delete once you're sure nothing links to them.


## Environment variables

Provide these via whatever mechanism your host offers (platform env vars, secrets manager, systemd unit, container env, etc.).

### GitHub App credentials (required)

- `GITHUB_SECRET` — webhook signature validation secret
- `GITHUB_INTEGRATION_ID` — GitHub App ID (used to sign JWTs)
- `GITHUB_INTEGRATION_KEY` — GitHub App private key (PEM contents, including BEGIN/END lines)
- `GITHUB_TOKEN` — GitHub API token used as a fallback for unauthenticated calls

### AWS credentials for the default S3 bucket (required)

- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `AWS_BUCKET_NAME`

### AWS credentials for the WHATWG bucket

Used when the PR owner is `whatwg`. Set `ALLOW_MULTIPLE_AWS_BUCKETS=no` (see below) to skip these and use the default bucket for everyone.

- `WHATWG_AWS_ACCESS_KEY_ID`
- `WHATWG_AWS_SECRET_ACCESS_KEY`
- `WHATWG_AWS_BUCKET_NAME`

### Runtime configuration

- `NODE_ENV` — set to `production` for live operation (gates webhook signature verification and PR comment writes)
- `PORT` — HTTP port for the Express server (defaults to `5000`)
- `ALLOW_MULTIPLE_AWS_BUCKETS` — set to `no` to force use of the default bucket only and ignore `WHATWG_*` credentials
- `STARTUP_QUEUE` — JSON array of PRs to process on startup

### Debugging

- `DISPLAY_STACK_TRACES` — set to `yes` to include stack traces in logs
- `DEBUG_SIMPLE_GITHUB` — set to `yes` to enable GitHub API debugging
- `DEBUG_WATTSI` — set to `yes` to log Wattsi client output

## Running the app

Standard Node app lifecycle:

```
npm ci --omit=dev
npm start          # runs `node index.js`
```

The server listens on `PORT` (defaults to `5000`) and exposes:

- `POST /github-hook` — webhook receiver (signature-verified against `GITHUB_SECRET` when `NODE_ENV=production`)
- `POST /config` — form endpoint used by the config-testing page

Set `NODE_ENV=production` in the deployed environment. This gates webhook signature verification and comment writes.

## Post-deploy checklist

1. Point the GitHub App's webhook URL at the new host.
2. Verify a webhook delivery in the GitHub App's Advanced tab (it should return 200 with an ISO timestamp body).
3. Update the form action in `docs/config.html` (line 61) to the new host so the config tester posts to the right place.
4. Trigger a real PR event on a repository that has a `.pr-preview.json` file and confirm the comment updates.

## Local development

Set `NODE_ENV=dev` and create an `env.js` file at the repo root (gitignored) that sets `process.env.*` values before the app boots. `index.js` requires it automatically when `NODE_ENV=dev`:

```js
// env.js
process.env.GITHUB_SECRET = "…";
process.env.GITHUB_INTEGRATION_ID = "…";
process.env.GITHUB_INTEGRATION_KEY = "-----BEGIN RSA PRIVATE KEY-----\n…";
// …etc, per the Environment variables section above
```

Then `npm start`. Webhook signature verification is skipped when `NODE_ENV` is not `production`, so you can POST synthetic payloads to `/github-hook` for testing.
