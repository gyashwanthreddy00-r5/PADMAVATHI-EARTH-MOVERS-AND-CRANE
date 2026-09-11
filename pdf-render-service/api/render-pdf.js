// Vercel Serverless Function: POST { html } -> real PDF bytes, rendered by an actual
// headless Chromium (via @sparticuz/chromium, a Chromium build sized for serverless
// environments) - the same rendering engine a normal Chrome browser uses for Print,
// so the result is byte-for-byte what Print/View would produce for the same HTML.
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';

export const config = {
  api: { bodyParser: { sizeLimit: '5mb' } },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  // Shared-secret check so this publicly-reachable endpoint can't be used by anyone
  // who finds the URL - set RENDER_API_KEY in Vercel's project environment variables,
  // and send the same value as the X-Api-Key header from the caller.
  const apiKey = req.headers['x-api-key'];
  if (!process.env.RENDER_API_KEY || apiKey !== process.env.RENDER_API_KEY) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const { html } = req.body || {};
  if (!html || typeof html !== 'string') {
    res.status(400).json({ error: 'Missing "html" in request body' });
    return;
  }

  let browser;
  try {
    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.status(200).send(pdfBuffer);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'PDF render failed' });
  } finally {
    if (browser) await browser.close();
  }
}
