export const DEFAULT_CATEGORIES = [
  'Sealant', 'Interior paint', 'Exterior paint', 'Waterproofing', 'Primer', 'Filler', 'Protective coating', 'Accessories'
];

const required = ['productName', 'brand', 'sku', 'category', 'supplier', 'sourceUrl', 'observedAt', 'currency', 'unit', 'unitPrice'];

export function validateObservation(row) {
  const errors = [];
  for (const key of required) if (row[key] === undefined || row[key] === null || String(row[key]).trim() === '') errors.push(`${key} is required`);
  if (row.unitPrice !== undefined && (!Number.isFinite(Number(row.unitPrice)) || Number(row.unitPrice) < 0)) errors.push('unitPrice must be a non-negative number');
  if (row.currency && row.currency !== 'PHP') errors.push('Only PHP observations are currently accepted');
  if (row.observedAt && Number.isNaN(Date.parse(row.observedAt))) errors.push('observedAt must be a valid date');
  if (row.verificationStatus === 'verified' && !row.verificationMethod) errors.push('verificationMethod is required for verified observations');
  if (row.verificationStatus === 'verified' && !row.verifiedBy) errors.push('verifiedBy is required for verified observations');
  return { valid: errors.length === 0, errors };
}

export function normalizeObservation(row) {
  const result = {
    ...row,
    productName: String(row.productName ?? '').trim(),
    brand: String(row.brand ?? '').trim(),
    sku: String(row.sku ?? '').trim(),
    category: String(row.category ?? '').trim(),
    supplier: String(row.supplier ?? '').trim(),
    sourceUrl: String(row.sourceUrl ?? '').trim(),
    observedAt: row.observedAt ? new Date(row.observedAt).toISOString() : '',
    currency: row.currency || 'PHP',
    unit: String(row.unit ?? '').trim(),
    unitPrice: Number(row.unitPrice),
    location: String(row.location ?? 'Philippines').trim(),
    vatBasis: row.vatBasis || 'unknown',
    deliveryBasis: row.deliveryBasis || 'unknown',
    verificationStatus: row.verificationStatus || 'unverified',
    verificationMethod: row.verificationMethod || '',
    verifiedBy: row.verifiedBy || '',
    sourceDocumentRef: row.sourceDocumentRef || '',
    notes: row.notes || ''
  };
  const check = validateObservation(result);
  if (!check.valid) throw new Error(check.errors.join('; '));
  return result;
}

export function isStale(observation, now = new Date(), maxAgeDays = 14) {
  const t = Date.parse(observation.observedAt);
  return !Number.isFinite(t) || (now.getTime() - t) > maxAgeDays * 86400000;
}

export function compareUnitPrice(a, b) {
  if (a.unit !== b.unit || a.currency !== b.currency) throw new Error('Cannot compare prices with different units or currencies without an explicit conversion');
  if (a.vatBasis !== b.vatBasis) throw new Error('Cannot compare prices with different or unknown VAT basis');
  return Number(a.unitPrice) - Number(b.unitPrice);
}

export function dedupeKey(o) {
  return [o.brand, o.sku, o.supplier, o.unit, o.currency, o.observedAt, o.unitPrice].map(v => String(v ?? '').trim().toLowerCase()).join('|');
}
