export const BLOOD_GROUPS = ["O-", "O+", "A-", "A+", "B-", "B+", "AB-", "AB+"] as const;
export type BloodGroup = (typeof BLOOD_GROUPS)[number];

export interface Hospital {
  id: string;
  name: string;
  lat: number;
  lng: number;
}

export interface BloodBank {
  id: string;
  name: string;
  district: string | null;
  lat: number;
  lng: number;
  phone: string | null;
  pickup_hours: string | null;
  is_demo: boolean;
}

export type CallEvent =
  | "system"
  | "found"
  | "calling"
  | "confirmed"
  | "partial"
  | "declined"
  | "no_answer"
  | "proposed"
  | "voice"
  | "refused"
  | "held"
  | "cancelled";

export interface CallLogRow {
  id: number;
  request_id: string;
  bank_id: string | null;
  event: CallEvent | string;
  message: string | null;
  units_offered: number | null;
  created_at: string;
}

export interface HoldProposal {
  id: string;
  request_id: string;
  bank_id: string;
  blood_group: string;
  units: number;
  source: "agent" | "voice";
  status: "pending" | "approved" | "rejected" | "superseded";
  created_at: string;
}

export interface Hold {
  id: string;
  request_id: string;
  bank_id: string;
  blood_group: string;
  units: number;
  status: "active" | "fulfilled" | "cancelled" | "expired";
  expires_at: string;
  created_at: string;
}

export interface BankNeed {
  bank_id: string;
  name: string;
  district: string | null;
  lat: number;
  lng: number;
  blood_group: string;
  units: number;
  min_units: number;
  shortfall: number;
}

export function distanceKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export function fmtTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch {
    return iso;
  }
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString([], {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function errText(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object" && "message" in e) return String((e as { message: unknown }).message);
  return "Something went wrong. Please try again.";
}
