export type AuditStatus = "pass" | "warn" | "fail" | "info";

export type AuditCheck = {
  id: string;
  status: AuditStatus;
  title: string;
  message: string;
  details?: Record<string, unknown>;
};

export type AuditSection = {
  title: string;
  checks: AuditCheck[];
};

export type AuditReport = {
  generatedAt: string;
  hostname: string;
  agentVersion: string;
  sections: AuditSection[];
  summary: Record<AuditStatus, number>;
};
