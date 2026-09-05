import type { ExportCompanyInfo } from '@/lib/utils';
import { formatCurrency, formatDate } from '@/lib/utils';

export function exportToExcelProfessional(
  filename: string,
  title: string,
  company: ExportCompanyInfo,
  dateRange: string,
  headers: string[],
  dataRows: (string | number)[][],
  totalRow?: (string | number)[],
  currencyColumns: number[] = [],
  dateColumns: number[] = [],
  numericColumns: number[] = [],
): void {
  const numCols = headers.length;
  const rightAlignCols = new Set([...currencyColumns, ...numericColumns]);

  const colWidths: number[] = [];
  for (let i = 0; i < numCols; i++) {
    let maxW = headers[i].length;
    for (const row of dataRows) {
      const cellLen = String(row[i] ?? '').length;
      if (cellLen > maxW) maxW = cellLen;
    }
    if (totalRow && String(totalRow[i] ?? '').length > maxW) maxW = String(totalRow[i]).length;
    colWidths.push(Math.min(Math.max(maxW + 3, 10), 45));
  }

  const escapeHtml = (s: string) => s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  const formatCell = (val: string | number, colIdx: number): string => {
    const str = String(val ?? '');
    const escaped = escapeHtml(str);
    if (currencyColumns.includes(colIdx) && val !== '' && val != null) {
      const num = Number(val);
      if (!isNaN(num)) return `"${num.toFixed(2)}"`;
    }
    if (dateColumns.includes(colIdx) && str && str !== '-') {
      return escaped;
    }
    return escaped;
  };

  // Headers: always centered and bold
  const headerRowHtml = headers.map((h) =>
    `<th style="background:#000;color:#fff;padding:5px 6px;font-size:10px;text-align:center;border:1px solid #000;white-space:nowrap;font-weight:bold">${escapeHtml(h)}</th>`
  ).join('');

  // Data rows: right-align numeric/currency columns, left-align everything else
  const dataRowsHtml = dataRows.map((row) => {
    return '<tr>' + row.map((cell, i) => {
      const align = rightAlignCols.has(i) ? 'right' : 'left';
      return `<td style="padding:4px 6px;font-size:10px;text-align:${align};border:1px solid #ccc;white-space:nowrap">${formatCell(cell, i)}</td>`;
    }).join('') + '</tr>';
  }).join('');

  const totalRowHtml = totalRow
    ? '<tr>' + totalRow.map((cell, i) => {
        const align = rightAlignCols.has(i) ? 'right' : 'left';
        return `<td style="background:#000;color:#fff;padding:5px 6px;font-size:10px;font-weight:bold;text-align:${align};border:1px solid #000;white-space:nowrap">${escapeHtml(String(cell ?? ''))}</td>`;
      }).join('') + '</tr>'
    : '';

  const contactParts = [
    company.phone ? `Phone: ${company.phone}` : null,
    company.email ? `Email: ${company.email}` : null,
    company.gstin ? `GSTIN: ${company.gstin}` : null,
    company.pan ? `PAN: ${company.pan}` : null,
  ].filter(Boolean);

  const dataCount = dataRows.length;
  const autoFilterRange = `R1C1:R${dataCount + 1}C${numCols}`;

  const headerSpan = numCols;

  const html = `<!DOCTYPE html>
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta charset="utf-8">
<!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet>
<x:Name>${escapeHtml(title)}</x:Name>
<x:WorksheetOptions><x:Selected/><x:FreezePanes/><x:SplitHorizontal>1</x:SplitHorizontal><x:TopRowBottomPane>1</x:TopRowBottomPane><x:AutoFilter><x:FilterRange>${autoFilterRange}</x:FilterRange></x:AutoFilter>
<x:PageSetup><x:Layout x:Orientation="Landscape"/><x:PageMargins x:Left="0.4" x:Right="0.4" x:Top="0.5" x:Bottom="0.5"/><x:FitWidth>1</x:FitWidth><x:FitHeight>0</x:FitHeight></x:PageSetup>
</x:WorksheetOptions>
</x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]-->
<style>
br { mso-data-placement: same-cell; }
td, th { font-family: Arial, Helvetica, sans-serif; }
</style>
</head>
<body>
<table border="0" cellspacing="0" cellpadding="0" style="border-collapse:collapse">
<tr><td colspan="${headerSpan}" style="font-size:14px;font-weight:bold;color:#000;padding:3px 6px">${escapeHtml(company.company_name)}</td></tr>
${company.address ? `<tr><td colspan="${headerSpan}" style="font-size:10px;color:#333;padding:1px 6px">${escapeHtml(company.address)}</td></tr>` : ''}
${contactParts.length > 0 ? `<tr><td colspan="${headerSpan}" style="font-size:10px;color:#333;padding:1px 6px">${escapeHtml(contactParts.join('  |  '))}</td></tr>` : ''}
<tr><td colspan="${headerSpan}" style="font-size:12px;font-weight:bold;color:#000;padding:6px 6px 3px 6px">${escapeHtml(title)}</td></tr>
<tr><td colspan="${numCols}" style="font-size:9px;color:#555;padding:1px 6px">Date Range: ${escapeHtml(dateRange)}</td></tr>
<tr><td colspan="${numCols}" style="font-size:9px;color:#555;padding:1px 6px">Generated: ${escapeHtml(new Date().toLocaleString('en-IN'))}</td></tr>
<tr><td colspan="${numCols}" style="font-size:9px;color:#555;padding:1px 6px">Total Records: ${dataCount}</td></tr>
<tr><td colspan="${numCols}" style="height:6px"></td></tr>
</table>
<table border="1" cellspacing="0" cellpadding="0" style="border-collapse:collapse">
<colgroup>${colWidths.map(w => `<col width="${w * 7}">`).join('')}</colgroup>
<thead><tr>${headerRowHtml}</tr></thead>
<tbody>${dataRowsHtml}${totalRowHtml}</tbody>
</table>
</body>
</html>`;

  const blob = new Blob(['\ufeff' + html], { type: 'application/vnd.ms-excel;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.xls') ? filename : filename.replace(/\.csv$/, '') + '.xls';
  a.click();
  URL.revokeObjectURL(url);
}

export { formatCurrency, formatDate };
