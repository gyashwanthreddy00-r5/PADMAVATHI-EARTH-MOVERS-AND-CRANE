import { formatCurrency, formatDate, amountInWords } from '@/lib/utils';
import type { Quotation, CompanySettings } from '@/types';

function parseTerms(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const text = String(raw).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  let lines: string[];
  if (text.includes('\n')) {
    lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  } else {
    lines = text.trim().split(/(?=\d+\.\s)/).map(s => s.trim()).filter(Boolean);
  }
  return lines.map(l => l.replace(/^\d+\.\s*/, '').trim()).filter(Boolean);
}

const txt = (v: string | null | undefined): string => (v ?? '').replace(/\s+/g, ' ').trim();

const navy = '#0a2440';
const border = '#8e9aa6';

export function QuotationDocument({
  quotation,
  settings,
  signatureUrl,
  stampUrl,
}: {
  quotation: Quotation;
  settings: CompanySettings | null;
  signatureUrl?: string | null;
  stampUrl?: string | null;
}) {
  const allTerms = parseTerms(quotation.terms_and_conditions);

  const otherCharges = quotation.other_charges_json
    ?? (quotation.other_charges_description
      ? [{ description: quotation.other_charges_description, amount: quotation.other_charges_amount ?? 0 }]
      : []);

  const signatory = txt(settings?.authorized_signatory) || 'AUTHORIZED SIGNATORY';
  const companyName = txt(settings?.company_name) || 'Padmavathi Earth Movers and Crane Services';
  const companyAddress = txt(settings?.address) || 'H-NO 1-5-1118/24, ROAD NO.1 AND 2, PAKALA KUNTA, PANCHASHILA COLONY, OLD ALWAL, HYDERABAD - 500010';
  const companyGstin = txt(settings?.gstin) || '36ALVPA9612Q2ZA';
  const companyState = txt(settings?.state) || 'Telangana';
  const bankName = txt(settings?.bank_name) || 'Axis Bank LTD';
  const bankAcNo = txt(settings?.bank_account_number) || '914020039371713';
  const bankIfsc = txt(settings?.bank_ifsc) || 'UTIB0001378';

  const pageStyle: React.CSSProperties = {
    width: '100%',
    background: 'white',
    color: '#111',
    fontFamily: 'Noto Sans, Arial, sans-serif',
    fontSize: '12px',
    lineHeight: 1.6,
    padding: '28px 34px',
    boxSizing: 'border-box',
    position: 'relative',
    minHeight: 'auto',
  };

  const headingStyle: React.CSSProperties = {
    fontSize: '12px',
    fontWeight: 700,
    color: '#111',
    marginTop: '14px',
    marginBottom: '5px',
  };

  return (
    <div className="quotation-document" style={{ display: 'flex', flexDirection: 'column', gap: '0' }}>
      <div className="quotation-page page-1" style={pageStyle}>
        {/* Quotation title */}
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '14px' }}>
          <span style={{ fontSize: '18px', fontWeight: 700, color: navy, letterSpacing: '1px' }}>QUOTATION</span>
        </div>

        {/* Quotation meta — right aligned */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', fontSize: '11px', marginBottom: '10px' }}>
          <div style={{ textAlign: 'left' }}>
            <div>Quotation No: <b>{txt(quotation.quotation_number) || '-'}</b></div>
            <div>Date: <b>{formatDate(quotation.quotation_date)}</b></div>
            {quotation.valid_until && <div>Valid Until: <b>{formatDate(quotation.valid_until)}</b></div>}
          </div>
        </div>
        <div style={{ borderBottom: `0.5px solid ${border}`, marginBottom: '16px' }} />

        {/* TO */}
        <div style={{ fontSize: '12px', fontWeight: 700, marginBottom: '4px' }}>To:</div>
        <div style={{ fontSize: '11px', fontWeight: 700, marginBottom: '2px' }}>{txt(quotation.customer_name)}</div>
        {quotation.customer_address && <div style={{ fontSize: '10px', marginBottom: '2px', lineHeight: 1.5 }}>{txt(quotation.customer_address)}</div>}
        <div style={{ fontSize: '10px', marginBottom: '12px' }}>
          {[quotation.customer_phone && `Phone: ${quotation.customer_phone}`, quotation.customer_gstin && `GSTIN: ${quotation.customer_gstin}`, quotation.customer_email && `Email: ${quotation.customer_email}`].filter(Boolean).join('  |  ')}
        </div>

        {/* Subject — simple bold line, no box */}
        {quotation.subject && (
          <div style={{ fontSize: '11px', fontWeight: 700, marginBottom: '6px' }}>
            Sub: {txt(quotation.subject)}
          </div>
        )}

        {/* Reference details — simple text lines */}
        {(quotation.reference_no || quotation.site_location) && (
          <div style={{ fontSize: '10px', marginBottom: '12px', lineHeight: 1.7 }}>
            {quotation.reference_no && <div>Reference No: {txt(quotation.reference_no)}</div>}
            {quotation.site_location && <div>Work Location: {txt(quotation.site_location)}</div>}
          </div>
        )}

        {/* Body paragraph */}
        <div style={{ fontSize: '10px', marginBottom: '14px', lineHeight: 1.7 }}>
          With reference to the above subject, we hereby quote for the supply of our crane/services as per the charges detailed below.
        </div>

        {/* CHARGES DETAILS — only render if at least one active charge with amount > 0 */}
        {(() => {
          const activeCharges: { desc: string; amt: number }[] = [];
          if (quotation.service_amount_enabled !== false && (quotation.quotation_amount ?? 0) > 0)
            activeCharges.push({ desc: 'Service Amount', amt: quotation.quotation_amount ?? 0 });
          if (quotation.up_transportation_enabled && (quotation.up_transportation_amount ?? 0) > 0)
            activeCharges.push({ desc: txt(quotation.up_transportation_description) || 'Up & Down Transportation', amt: quotation.up_transportation_amount });
          otherCharges.forEach(c => { if ((c.amount ?? 0) > 0) activeCharges.push({ desc: txt(c.description) || 'Other Charges', amt: c.amount }); });

          if (activeCharges.length === 0) return null;

          const showSubtotal = activeCharges.length > 1 || quotation.gst_enabled;

          return (
            <>
              <div style={headingStyle}>CHARGES DETAILS</div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '10px', tableLayout: 'fixed' }}>
                <colgroup>
                  <col style={{ width: '70%' }} />
                  <col style={{ width: '30%' }} />
                </colgroup>
                <tbody>
                  <tr style={{ borderBottom: `1px solid ${navy}` }}>
                    <td style={{ padding: '4px 0', fontWeight: 700, fontSize: '10px' }}>Description</td>
                    <td style={{ padding: '4px 0', fontWeight: 700, textAlign: 'right', fontSize: '10px' }}>Amount</td>
                  </tr>
                  {activeCharges.map((c, i) => (
                    <tr key={i}>
                      <td style={{ padding: '4px 0' }}>{c.desc}</td>
                      <td style={{ padding: '4px 0', textAlign: 'right' }}>{formatCurrency(c.amt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Totals — right-aligned, all on same right edge */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', fontSize: '10px', marginTop: '10px', marginBottom: '6px' }}>
                <div style={{ width: '260px' }}>
                  {showSubtotal && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0' }}>
                      <span>Subtotal</span><span>{formatCurrency(quotation.subtotal)}</span>
                    </div>
                  )}
                  {quotation.gst_enabled && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0' }}>
                      <span>GST ({quotation.gst_percent}%)</span><span>{formatCurrency(quotation.gst_amount)}</span>
                    </div>
                  )}
                  <div style={{ borderTop: `0.5px solid ${navy}`, marginTop: '4px', paddingTop: '4px', display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: '11px' }}>
                    <span>GRAND TOTAL</span><span>{formatCurrency(quotation.grand_total)} RS</span>
                  </div>
                </div>
              </div>
              <div style={{ fontSize: '10px', fontStyle: 'italic', marginBottom: '14px' }}>Amount in Words: {amountInWords(quotation.grand_total)}</div>
            </>
          );
        })()}

        {/* Terms and Conditions */}
        {allTerms.length > 0 && (
          <>
            <div style={headingStyle}>TERMS AND CONDITIONS</div>
            {/<[a-z!]/i.test(quotation.terms_and_conditions ?? '') ? (
              <div
                style={{ fontSize: '10px', marginBottom: '12px', lineHeight: 1.7 }}
                dangerouslySetInnerHTML={{ __html: quotation.terms_and_conditions ?? '' }}
              />
            ) : (
              allTerms.map((term, i) => (
                <div key={i} style={{ fontSize: '10px', marginBottom: '4px', paddingLeft: '6px', lineHeight: 1.6 }}>{i + 1}. {term}</div>
              ))
            )}
          </>
        )}

        {/* Payment Terms */}
        {quotation.payment_terms && (
          <>
            <div style={headingStyle}>PAYMENT TERMS</div>
            <div
              style={{ fontSize: '10px', marginBottom: '12px', lineHeight: 1.7 }}
              dangerouslySetInnerHTML={{ __html: quotation.payment_terms.replace(/\n/g, '<br/>') }}
            />
          </>
        )}

        {/* NOTE */}
        <div style={headingStyle}>NOTE</div>
        <div style={{ fontSize: '10px', marginBottom: '16px', lineHeight: 1.7 }}>
          We should receive the work order as per our quotation terms and conditions &amp; payment has to be received on or before 7 days from the date of bill submission.
        </div>

        {/* Company Billing Details */}
        <div style={headingStyle}>COMPANY BILLING DETAILS</div>
        <div style={{ fontSize: '10px', fontWeight: 700, marginBottom: '2px' }}>{companyName}</div>
        <div style={{ fontSize: '10px', lineHeight: 1.8, marginBottom: '14px' }}>
          {companyAddress.split(',').map((line, i) => <div key={i}>{line.trim()}{i < companyAddress.split(',').length - 1 ? ',' : ''}</div>)}
          <div>GSTIN: {companyGstin}</div>
          <div>State Name: {companyState}.</div>
        </div>

        {/* Company Bank Details */}
        <div style={headingStyle}>COMPANY BANK DETAILS</div>
        <div style={{ fontSize: '10px', fontWeight: 700, marginBottom: '2px' }}>{companyName}</div>
        <div style={{ fontSize: '10px', lineHeight: 1.8, marginBottom: '20px' }}>
          <div>Bank Name: {bankName}</div>
          <div>A/C No: {bankAcNo}</div>
          <div>IFS Code: {bankIfsc}</div>
        </div>

        {/* Signature — right side, clean */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '24px' }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '10px', fontWeight: 700, marginBottom: '6px' }}>For {companyName}</div>
            {stampUrl ? (
              <img src={stampUrl} alt="Stamp" style={{ maxWidth: '150px', maxHeight: '60px', objectFit: 'contain', marginBottom: '4px' }} />
            ) : (
              <div style={{ width: '160px', marginBottom: '4px', height: '36px' }} />
            )}
            {signatureUrl && (
              <img src={signatureUrl} alt="Signature" style={{ maxWidth: '150px', maxHeight: '42px', objectFit: 'contain', marginBottom: '4px' }} />
            )}
            <div style={{ fontSize: '10px' }}>{signatory}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
