import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeObservation, validateObservation, isStale, compareUnitPrice, dedupeKey } from './price-engine.mjs';
const base = {productName:'Neutral-cure sealant',brand:'Example',sku:'EX-001',category:'Sealant',supplier:'Fixture Supplier',sourceUrl:'https://example.invalid/quote',observedAt:'2026-10-24T09:00:00Z',currency:'PHP',unit:'tube',unitPrice:180,vatBasis:'inclusive',deliveryBasis:'pickup',verificationStatus:'verified',verificationMethod:'written supplier quotation',verifiedBy:'QA fixture'};

test('normalizes a complete observation without losing provenance', () => { const o=normalizeObservation(base); assert.equal(o.currency,'PHP'); assert.equal(o.unitPrice,180); assert.equal(o.verificationStatus,'verified'); assert.ok(o.observedAt.endsWith('Z')); });
test('rejects verified prices without method and reviewer', () => { const r=validateObservation({...base,verificationMethod:'',verifiedBy:''}); assert.equal(r.valid,false); assert.ok(r.errors.some(x=>x.includes('verificationMethod'))); });
test('rejects invalid and negative prices', () => { assert.equal(validateObservation({...base,unitPrice:-1}).valid,false); assert.equal(validateObservation({...base,unitPrice:'NaN'}).valid,false); });
test('marks old observations stale', () => { assert.equal(isStale({observedAt:'2026-01-01T00:00:00Z'},new Date('2026-10-24T00:00:00Z')),true); });
test('prevents unit or VAT mismatched comparisons', () => { assert.throws(()=>compareUnitPrice(base,{...base,unit:'litre'}),/different units/); assert.throws(()=>compareUnitPrice(base,{...base,vatBasis:'exclusive'}),/VAT basis/); });
test('creates stable duplicate keys', () => { assert.equal(dedupeKey(base),dedupeKey({...base,brand:' Example '})); });
