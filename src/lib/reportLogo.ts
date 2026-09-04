const LOGO_URL = '/report-logo.png';
const LOGO_WIDTH = 48;
const LOGO_HEIGHT = 36;

let _logoDataUrl = '';
let _logoLoaded = false;

(async () => {
  try {
    const res = await fetch(LOGO_URL);
    if (!res.ok) throw new Error(`logo fetch ${res.status}`);
    const blob = await res.blob();
    _logoDataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
    _logoLoaded = true;
  } catch {
    // logo unavailable — exports will work without it
  }
})();

export function getReportLogoDataUrl(): string {
  return _logoLoaded ? _logoDataUrl : '';
}

export function getReportLogoHtml(): string {
  const dataUrl = getReportLogoDataUrl();
  if (!dataUrl) return '';
  return `<img src="${dataUrl}" width="${LOGO_WIDTH}" height="${LOGO_HEIGHT}" style="object-fit:contain;display:block" alt="logo"/>`;
}

export function getReportLogoUrl(): string {
  return LOGO_URL;
}

export function getReportLogoDimensions() {
  return { width: LOGO_WIDTH, height: LOGO_HEIGHT };
}
