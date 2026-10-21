export interface BirdContactCustomData {
  role?: string;
  subrol?: string;
  membership?: boolean;
  membership_status?: "active" | "grace_period" | "expired" | "none";
  membership_level?: string;
  membership_expiry?: string;
  member_number?: string;
  city?: string;
  document_number?: string;
  [key: string]: unknown;
}

export interface SyncContactParams {
  email: string;
  primerNombre?: string | null;
  primerApellido?: string | null;
  phone?: string | null;
  role?: string | null;
  subrol?: string | null;
  membershipLevel?: string | null;
  membershipExpired?: boolean;
  membershipExpiryDate?: Date | string | null;
  membershipGracePeriodEnd?: Date | string | null;
  memberNumber?: string | null;
  city?: string | null;
  documentNumber?: string | null;
  externalId?: string | null;
  targetAudienceId?: string | null;
}

export interface SyncContactResult {
  success: boolean;
  contactId?: string;
  status?: "created" | "updated" | "failed";
  audienceId?: string;
  error?: string;
}

export interface SyncBatchResult {
  total: number;
  synced: number;
  failed: number;
  errors: Array<{ email: string; error: string }>;
}
