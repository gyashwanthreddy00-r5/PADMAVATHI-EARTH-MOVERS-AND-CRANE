import { toBase64 } from "./invoice-pdf.ts";

// Renders HTML to a PDF via Browserless's hosted headless-Chrome API and returns it
// base64-encoded. This uses the same real print engine a browser's own print-to-PDF
// uses, so the result matches Print/View exactly - unlike a canvas-rasterization
// approach, which only approximates the layout. Shared by every edge function that
// emails an invoice PDF so there is exactly one rendering path, not one per function.
export async function renderPdfViaBrowserless(html: string): Promise<string> {
  const apiKey = Deno.env.get("BROWSERLESS_API_KEY");
  if (!apiKey) throw new Error("BROWSERLESS_API_KEY is not configured.");
  // Browserless assigns each account a region-specific base URL shown on its dashboard
  // (e.g. https://production-sfo.browserless.io). Set BROWSERLESS_URL if yours differs
  // from the default global endpoint.
  const baseUrl = Deno.env.get("BROWSERLESS_URL") ?? "https://chrome.browserless.io";

  const response = await fetch(`${baseUrl}/pdf?token=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      html,
      options: {
        format: "A4",
        margin: { top: "10mm", bottom: "10mm", left: "10mm", right: "10mm" },
        printBackground: true,
      },
    }),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    throw new Error(`Browserless PDF render failed (${response.status}): ${errText.slice(0, 300)}`);
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  return toBase64(bytes);
}
