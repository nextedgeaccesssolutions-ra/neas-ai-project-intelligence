import { describe, expect, it } from 'vitest';
import { gridToRows, headerRowIndex } from '../lib/sheetSchema';
import { COLS } from '../lib/moduleIO';

const BOQ = COLS.boq;

describe('spreadsheet import header matching', () => {
  it('reads the standard headers', () => {
    const rows = gridToRows(BOQ, [['Item', 'Description', 'Category', 'Unit', 'Qty', 'Unit cost (PHP)'], ['1', 'Mobilization', 'Other', 'lot', '1', '5000']]);
    expect(rows[0]).toMatchObject({ item: '1', description: 'Mobilization', unit: 'lot', qty: '1', unit_cost_php: '5000' });
  });
  it('maps common other names for the same columns', () => {
    const rows = gridToRows(BOQ, [['Item No.', 'Item Description', 'UOM', 'Quantity', 'Unit Price'], ['1.1', 'Rope access technician', 'day', '4', '3500']]);
    expect(rows[0]).toMatchObject({ item: '1.1', description: 'Rope access technician', unit: 'day', qty: '4', unit_cost_php: '3500' });
  });
  it('ignores a BOM, extra spaces and capitals', () => {
    const rows = gridToRows(BOQ, [['﻿  DESCRIPTION ', ' qty '], ['Scaffold', '2']]);
    expect(rows[0]).toMatchObject({ description: 'Scaffold', qty: '2' });
  });
  it('finds the header row below a title row', () => {
    const grid = [['NEAS Bill of Quantities - Project X'], [''], ['Item', 'Scope of Work', 'Unit', 'Qty'], ['1', 'Window cleaning', 'lot', '1']];
    expect(headerRowIndex(BOQ, grid)).toBe(2);
    expect(gridToRows(BOQ, grid)).toEqual([{ item: '1', description: 'Window cleaning', unit: 'lot', qty: '1' }]);
  });
  it('keeps the first of two columns with the same meaning', () => {
    const rows = gridToRows(BOQ, [['Description', 'Details'], ['Main text', 'other']]);
    expect(rows[0].description).toBe('Main text');
  });
  it('does not invent a description when the file has none', () => {
    const rows = gridToRows(BOQ, [['Item', 'Qty'], ['1', '2']]);
    expect(rows[0].description).toBeUndefined();
  });
});

describe('header row choice', () => {
  it('keeps row 1 as the header when a lower row only looks a little better', () => {
    const grid = [['Description', 'Amount note'], ['Item', 'Unit'], ['Mobilization', 'x']];
    expect(headerRowIndex(BOQ, grid)).toBe(0);
  });
});
