export const INTEGRATION_KEYS = {
  HOSTINGER_MAIL: 'hostinger_mail',
  MICROSOFT_365: 'microsoft_365'
} as const;

export type IntegrationKey = (typeof INTEGRATION_KEYS)[keyof typeof INTEGRATION_KEYS];

export const HOSTINGER_MAIL_RECONCILIATION_JOB_NAME = 'hostinger-mail-reconciliation';
export const DOCUMENT_LINK_REACHABILITY_JOB_NAME = 'document-link-reachability-check';
