# pdf-render-service

Turns invoice HTML into a real PDF using headless Chromium, so the emailed PDF is
byte-for-byte identical to what Print/View shows in the browser.

## Deploy (one-time, ~5 minutes)

1. Push this folder to its own GitHub repo (or a subfolder of an existing one).
2. Go to vercel.com -> sign in with GitHub (free, no card).
3. "Add New Project" -> import the repo -> if it's a subfolder, set "Root Directory"
   to `pdf-render-service` in the import settings.
4. Before deploying, add one environment variable in the Vercel project settings:
   - `RENDER_API_KEY` = any long random string you make up (this is the shared
     secret the main app will send to prove it's allowed to call this function).
5. Deploy. Vercel gives you a URL like `https://pdf-render-service-xyz.vercel.app`.

## Use it

```
POST https://<your-project>.vercel.app/api/render-pdf
Headers: X-Api-Key: <the RENDER_API_KEY you set>
Body (JSON): { "html": "<!DOCTYPE html>...full invoice HTML..." }
Response: application/pdf (binary)
```

Once deployed, give the URL + API key to the main app (they'll be added as
`VITE_PDF_RENDER_URL` and `VITE_PDF_RENDER_KEY` in its `.env`), and
`src/lib/invoicePdf.ts` will call this instead of rendering in the browser.
