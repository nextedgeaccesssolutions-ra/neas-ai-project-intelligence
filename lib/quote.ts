// Quotation approval workflow. Pure functions so the rules are unit-tested.
import type { Quotation } from './types';

export class WorkflowError extends Error {}

export function newQuotation(projectId: string, now: string): Quotation {
  return {
    projectId,
    number: `Q-${projectId}`,
    status: 'Draft',
    validityDays: 30,
    terms: '50% downpayment, balance upon completion. Prices in Philippine pesos.',
    approvedBy: null,
    approvedAt: null,
    issuedAt: null,
    approvedTotal: null,
    history: [{ at: now, action: 'Draft created', by: 'system' }],
  };
}

const log = (q: Quotation, at: string, action: string, by: string): Quotation => ({
  ...q,
  history: [...q.history, { at, action, by }],
});

export function submitQuote(q: Quotation, by: string, at: string, total: number): Quotation {
  if (q.status !== 'Draft') throw new WorkflowError(`Only a Draft can be submitted (now ${q.status}).`);
  if (!(total > 0)) throw new WorkflowError('Add BOQ lines before submitting: the total is zero.');
  return log({ ...q, status: 'Submitted' }, at, `Submitted for approval at ${total.toFixed(2)}`, by);
}

export function approveQuote(q: Quotation, by: string, at: string, total: number): Quotation {
  if (q.status !== 'Submitted') throw new WorkflowError(`Only a Submitted quotation can be approved (now ${q.status}).`);
  if (!by.trim()) throw new WorkflowError('Approver name is required.');
  return log({ ...q, status: 'Approved', approvedBy: by, approvedAt: at, approvedTotal: total }, at, 'Approved', by);
}

export function issueQuote(q: Quotation, by: string, at: string, currentTotal: number): Quotation {
  if (q.status !== 'Approved') throw new WorkflowError('A quotation must be Approved before it can be issued.');
  if (q.approvedTotal == null || Math.abs(q.approvedTotal - currentTotal) > 0.005)
    throw new WorkflowError('The BOQ changed after approval. Re-submit for approval.');
  return log({ ...q, status: 'Issued', issuedAt: at }, at, 'Issued to client', by);
}

export function returnToDraft(q: Quotation, by: string, at: string, reason: string): Quotation {
  if (q.status === 'Issued') throw new WorkflowError('An issued quotation is locked. Create a revision instead.');
  if (q.status === 'Draft') return q;
  return log({ ...q, status: 'Draft', approvedBy: null, approvedAt: null, approvedTotal: null }, at, `Returned to Draft: ${reason}`, by);
}

/** BOQ edits are blocked once issued, and reset Submitted/Approved quotes to Draft. */
export const boqLocked = (q: Quotation | undefined) => q?.status === 'Issued';
