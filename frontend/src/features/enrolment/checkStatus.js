/**
 * A school's termly enrolment, as the programme officer sees it on Enrolment checks.
 * TO_CHECK: the statuses that are waiting for the officer.
 */
export const ENROLMENT_STATUS = {
  verified: { tone: 'success', label: 'Verified' },
  not_verified: { tone: 'warning', label: 'To check' },
  changed: { tone: 'warning', label: 'Changed since checked' },
  discrepancy: { tone: 'danger', label: 'Discrepancy' },
  not_entered: { tone: 'neutral', label: 'Not entered' },
};

export const TO_CHECK = ['not_verified', 'changed', 'discrepancy'];
