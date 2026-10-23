import type { WorkCalendar } from './schedule';

export type ProjectStatus ='draft' | 'active' | 'on-hold' | 'completed';

export interface Project {
  id: string;
  /** human project code (cloud mode: PRJ-2026-001); device mode uses id as the code */
  code?: string;
  name: string;
  client: string;
  site: string;
  status: ProjectStatus;
  contractValue: number | null; // PHP
  /** client's reference / PO number, planned start and completion (cloud mode) */
  referenceNo?: string;
  startDate?: string | null;
  endDate?: string | null;
  createdAt: string;
}

export interface Activity {
  id: string;
  projectId: string;
  name: string;
  start: string; // YYYY-MM-DD
  end: string; // YYYY-MM-DD, inclusive
  weight: number; // % of project
  /** original approved dates; only a Super Admin can change them (rebaseline) */
  baselineStart?: string | null;
  baselineEnd?: string | null;
  actualStart?: string | null;
  /** set only when the scope is confirmed complete */
  actualFinish?: string | null;
  /** latest approved estimate of working days still needed */
  remainingDays?: number | null;
  /** approved scope quantity for measurable work (e.g. 1000 m²) */
  quantityTotal?: number | null;
  quantityUnit?: string;
  delayReason?: string;
  /** number of evidence photos this scope must have (optional) */
  requiredPhotos?: number | null;
}

export type StopReason = 'weather' | 'wind' | 'client_instruction' | 'site_access' | 'safety' | 'equipment' | 'manpower' | 'material' | 'other';
export const STOP_REASONS: { value: StopReason; label: string }[] = [
  { value: 'weather', label: 'Rain or adverse weather' },
  { value: 'wind', label: 'High winds / unsafe conditions' },
  { value: 'client_instruction', label: 'Client instruction' },
  { value: 'site_access', label: 'Site access restriction' },
  { value: 'safety', label: 'Safety concern / permit suspended' },
  { value: 'equipment', label: 'Equipment breakdown' },
  { value: 'manpower', label: 'Manpower shortage' },
  { value: 'material', label: 'Material delay' },
  { value: 'other', label: 'Other (explain)' },
];

/** A STOP WORK event and, once confirmed, its RESTART. Never deleted or rewritten. */
export type GpsSource = 'exif' | 'device' | 'manual';

export interface ActivityStop {
  id: string;
  projectId: string;
  activityId: string;
  /** ISO timestamp */
  stoppedAt: string;
  reason: StopReason;
  remarks: string;
  supervisor: string;
  affectsSchedule: boolean;
  restartedAt: string | null;
  restartSupervisor: string;
  restartRemarks: string;
  safetyCleared: boolean;
  remainingDays: number | null;
}

export interface FieldReport {
  id: string;
  projectId: string;
  activityId: string;
  date: string; // YYYY-MM-DD
  actualPct: number; // cumulative % complete of the activity
  /** verified cumulative quantity in the activity's unit (measurable scopes) */
  completedQty?: number | null;
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

export type EvidenceKind = 'Before' | 'During' | 'After' | 'Inspection' | 'Safety' | 'Defect' | 'Reference';
/** building / site reference photo categories for the report cover */
export type CoverCategory = 'main_building' | 'site_overview' | 'exterior' | 'entrance' | 'roof_work_area' | 'other';
export const COVER_CATEGORIES: { value: CoverCategory; label: string }[] = [
  { value: 'main_building', label: 'Main building / structure' },
  { value: 'site_overview', label: 'Overall project site' },
  { value: 'exterior', label: 'Building exterior / elevation' },
  { value: 'entrance', label: 'Entrance / site identification' },
  { value: 'roof_work_area', label: 'Roof deck / work area' },
  { value: 'other', label: 'Other site reference' },
];
/** How the location was obtained: never invented; "manual" is typed in by a person. */
export type GpsStatus = 'captured' | 'manual' | 'unavailable' | 'no_photo_gps' | 'denied' | 'not_requested';
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
  /** where the coordinates came from: the camera's own EXIF GPS, the device position at capture, or typed in */
  gpsSource?: GpsSource | null;
  /** structural location, separate from GPS: facade, tower, turbine component… */
  workArea?: string;
  /** building / floor / elevation / grid */
  locationDetail?: string;
  /** shared by a BEFORE and an AFTER photo of the same spot */
  pairId?: string | null;
  /** human-readable photo reference, e.g. BEF-20261023-1A2B */
  ref?: string;
  /** report cover: category, whether it is on the cover, its order and the primary cover photo */
  coverCategory?: CoverCategory | null;
  isCover?: boolean;
  coverOrder?: number | null;
  coverPrimary?: boolean;
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
  /** per-project working calendars; a project without one uses DEFAULT_CALENDAR */
  calendars?: Record<string, WorkCalendar>;
  /** work stoppages and restarts */
  stops?: ActivityStop[];
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
