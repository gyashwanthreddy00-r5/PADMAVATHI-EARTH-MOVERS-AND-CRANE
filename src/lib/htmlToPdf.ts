// Generic HTML -> base64 PDF conversion via html2pdf.js, using the same hidden-iframe
// render technique already used elsewhere in the app (see SettlementReport.tsx's
// invoice-PDF email attachment) — kept here as one small shared helper instead of a
// second copy, since Customer Statements now needs the same conversion for the
// Balance Statement PDF attachment.

let html2pdfLoader: Promise<typeof import('html2pdf.js')['default']> | null = null;
async function getHtml2pdf() {
  if (!html2pdfLoader) html2pdfLoader = import('html2pdf.js').then(m => (m as typeof import('html2pdf.js')).default);
  return html2pdfLoader;
}

/** Renders a full HTML document string to a base64-encoded PDF. */
export async function htmlToPdfBase64(html: string, filename: string): Promise<string> {
  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.top = '-10000px';
  iframe.style.left = '-10000px';
  iframe.style.width = '800px';
  iframe.style.height = '1200px';
  iframe.style.border = 'none';
  document.body.appendChild(iframe);

  const iframeDoc = iframe.contentWindow?.document;
  if (!iframeDoc) {
    if (iframe.parentNode) document.body.removeChild(iframe);
    throw new Error('Unable to create PDF document');
  }

  iframeDoc.open();
  iframeDoc.write(html);
  iframeDoc.close();

  await new Promise(resolve => { iframe.onload = resolve; });
  await new Promise(resolve => setTimeout(resolve, 500));
  try {
    await (iframe.contentWindow as unknown as { document: { fonts: { ready: Promise<unknown> } } }).document.fonts.ready;
  } catch { /* fonts API unavailable, proceed */ }
  await new Promise(resolve => setTimeout(resolve, 500));

  const target = iframeDoc.body;
  const opt = {
    margin: [10, 10, 10, 10] as [number, number, number, number],
    filename,
    image: { type: 'png' as const, quality: 1.0 },
    html2canvas: { scale: 2, useCORS: true, logging: false, backgroundColor: '#ffffff' },
    pagebreak: { mode: ['css', 'legacy'] as const },
    jsPDF: { unit: 'mm' as const, format: 'a4' as const, orientation: 'portrait' as const },
  };

  try {
    const html2pdf = await getHtml2pdf();
    const blob: Blob = await html2pdf().set(opt).from(target).outputPdf('blob');
    const arrayBuffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    let binary = '';
    const chunkSize = 8192;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.subarray(i, i + chunkSize);
      binary += String.fromCharCode(...chunk);
    }
    return btoa(binary);
  } finally {
    if (iframe.parentNode) document.body.removeChild(iframe);
  }
}
