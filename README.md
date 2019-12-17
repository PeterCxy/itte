# 言って (Itte)

A toy comment system that runs on Cloudflare Workers.

My project consists of mostly spaghetti code to play with CF workers, so unless you are willing to debug some random issues with unreadable code, you should probably not use this.

Most of the styles used in this project come from Isso, a truly self-hosted comment system.

### Deployment

You need access to Cloudflare Workers KV to use this worker.

Create a KV data store, then create `wrangler.toml`

```toml
name = "<a cool name>"
type = "javascript"
account_id = "<your account id>"
workers_dev = true
route = ""
zone_id = "<your zone id>"

[[kv-namespaces]]
binding = "KV"
id = "<your KV id>"
```

Add a key `secret_cursor` to your KV data store, with some random value (recommended: `openssl rand -hex 32`).

Modify variable `CORS_ALLOW_ORIGIN` in `index.js` to include your website domain.

Run `wrangler publish`.

Then modify your website page as follows

```html
<head>
  ...
  <script src="https://your_worker.domain/itte.js"></script>
</head>
<body>
  ...
  <section id="itte-thread" data-path="https://your.worker.domain/current/page/path"></section>
</body>
```