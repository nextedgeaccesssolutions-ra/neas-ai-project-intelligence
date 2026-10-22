export type ProjectStatus = 'draft' | 'active' | 'on-hold' | 'completed';

export interface Project {
  id: string;
  /** human project code (cloud mode: PRJ-2026-001); device mode uses id as the code */
  code?: string;
  name: string;
  client: string;
  site: string;
  status: ProjectStatus;
  contractValue: number | null; // PHP
  createdAt: string;
}

export interface Activity {
  id: string;
  projectId: string;
  name: string;
  start: string; // YYYY-MM-DD
  end: string; // YYYY-MM-DD, inclusive
  weight: number; // % of project
}

export interface FieldReport {
  id: string;
  projectId: string;
  activityId: string;
  date: string; // YYYY-MM-DD
  actualPct: number; // cumulative % complete of the activity
  notes: string;
  createdAt: string;
  /** cloud mode: review state */
  status?: 'draft' | 'submitted' | 'approved' | 'rejected';
  clientVisible?: boolean;
}

export type BoqCategory = 'Labor' | 'Materials' | 'Equipment' | 'Subcontract' | 'Other';
export const BOQ_CATEGORIES: BoqCategory[] = ['Labor', 'Materials', 'Equipment', 'Subcontract', 'Other'];

export interface BoqLine {
  id: string;
  projectId: string;
  item: string; // item no., e.g. 1.01
  description: string;
  category: BoqCategory;
  unit: string;
  qty: number;
  unitCost: number; // PHP, direct cost
}

export interface CostSettings {
  overheadPct: number;
  contingencyPct: number;
  insurancePct: number;
  bondPct: number;
  warrantyPct: number;
  markupPct: number;
  vatPct: number;
  vatMode: 'exclusive' | 'exempt';
}

/** Quotation workflow: Draft → Submitted → Approved → Issued. Only Approved can be Issued. */
export type QuoteStatus = 'Draft' | 'Submitted' | 'Approved' | 'Issued';

export interface Quotation {
  projectId: string;
  number: string;
  status: QuoteStatus;
  validityDays: number;
  terms: string;
  approvedBy: string | null;
  approvedAt: string | null;
  issuedAt: string | null;
  /** totals frozen at approval; editing the BOQ afterwards returns the quote to Draft */
  approvedTotal: number | null;
  history: { at: string; action: string; by: string }[];
}

export type EvidenceKind = 'Before' | 'During' | 'After' | 'Inspection' | 'Safety' | 'Defect';
/** How the location was obtained: never invented; "manual" is typed in by a person. */
export type GpsStatus = 'captured' | 'manual' | 'unavailable' | 'denied' | 'not_requested';
export interface GpsFix {
  lat: number;
  lng: number;
  /** device-reported horizontal accuracy in metres (null when unknown) */
  accuracy: number | null;
  altitude?: number | null;
  heading?: number | null;
  /** when the fix was taken (device clock, ISO) */
  at: string;
}

export interface Evidence {
  id: string;
  projectId: string;
  activityId: string;
  kind: EvidenceKind;
  caption: string;
  takenAt: string;
  bytes: number;
  /** cloud mode: object path in the private bucket */
  storagePath?: string;
  editCount?: number;
  gps?: GpsFix | null;
  gpsStatus?: GpsStatus;
  /** structural location, separate from GPS: facade, tower, turbine component… */
  workArea?: string;
  /** building / floor / elevation / grid */
  locationDetail?: string;
  /** shared by a BEFORE and an AFTER photo of the same spot */
  pairId?: string | null;
  /** human-readable photo reference, e.g. BEF-20261023-1A2B */
  ref?: string;
}

export interface AppState {
  version: 1;
  activeProjectId: string;
  userName: string;
  projects: Project[];
  activities: Activity[];
  reports: FieldReport[];
  boq: BoqLine[];
  costSettings: Record<string, CostSettings>;
  quotations: Record<string, Quotation>;
  evidence: Evidence[];
  savedAt: string | null;
}

export const DEFAULT_COST_SETTINGS: CostSettings = {
  overheadPct: 10,
  contingencyPct: 5,
  insurancePct: 0,
  bondPct: 0,
  warrantyPct: 0,
  markupPct: 15,
  vatPct: 12,
  vatMode: 'exclusive',
};
