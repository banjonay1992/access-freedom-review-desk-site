export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export function safeHttpsUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

export function isPasswordSetupUrl(value) {
  try {
    const url = new URL(value);
    const queryType = url.searchParams.get('type');
    const hash = new URLSearchParams(url.hash.replace(/^#/, ''));
    return queryType === 'invite' || queryType === 'recovery' || hash.get('type') === 'invite' || hash.get('type') === 'recovery';
  } catch {
    return false;
  }
}

export function queueSummary(rows) {
  return rows.reduce((summary, row) => {
    summary.places += 1;
    summary.pending += Number(row.pending_count ?? 0);
    summary.conflicting += Number(row.conflicting_count ?? 0);
    summary.ready += Number(row.pending_count ?? 0) === 0 && Number(row.conflicting_count ?? 0) === 0 ? 1 : 0;
    return summary;
  }, { places: 0, pending: 0, conflicting: 0, ready: 0 });
}

export function canCreateDraft(candidate, findings) {
  if (!candidate || candidate.state === 'promoted' || candidate.duplicate_of_candidate_id) return false;
  const unresolved = findings.some((finding) => ['pending', 'conflicting'].includes(finding.state));
  return !unresolved;
}

export function decisionLabel(state) {
  return ({ accepted: 'Accepted', rejected: 'Rejected', conflicting: 'Needs resolution', pending: 'Awaiting review', superseded: 'Superseded' })[state] ?? state;
}

export function formatConfidence(value) {
  if (value == null || value === '') return '—';
  const number = Number(value);
  return Number.isFinite(number) ? `${Math.round(number * 100)}%` : '—';
}
