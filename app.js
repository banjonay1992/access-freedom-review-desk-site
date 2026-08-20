import {
  findDuplicates, getFindings, getPlace, getSession, getStaffMembership, listCategories,
  listQueue, markDuplicate, moderateFinding, onAuthChange, promoteCandidate, publishPlace,
  signIn, signOut,
  updatePassword,
} from './backend.js';
import { canCreateDraft, decisionLabel, escapeHtml, formatConfidence, isPasswordSetupUrl, queueSummary, safeHttpsUrl } from './state.js';

const ui = Object.fromEntries([...document.querySelectorAll('[id]')].map((element) => [element.id.replaceAll('-', '_'), element]));
const state = { session: null, staff: null, categories: [], queue: [], selected: null, findings: [], place: null, filter: 'all', search: '', decision: null, needsPasswordSetup: isPasswordSetupUrl(window.location.href) };
let toastTimer;

function toast(message, isError = false) {
  ui.toast.textContent = message;
  ui.toast.className = `toast show${isError ? ' error' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { ui.toast.className = 'toast'; }, 3600);
}

function errorMessage(error) {
  return error?.message?.replace(/^.*?: /, '') || 'Something went wrong. Please try again.';
}

function setBusy(button, busy, label = 'Working…') {
  if (!button) return;
  if (busy) { button.dataset.label = button.textContent; button.textContent = label; button.disabled = true; }
  else { button.textContent = button.dataset.label || button.textContent; button.disabled = false; }
}

async function establishSession(session) {
  state.session = session;
  if (!session) {
    ui.login_screen.classList.remove('hidden');
    ui.dashboard.classList.add('hidden');
    return;
  }
  const staff = await getStaffMembership(session.user.id);
  if (!staff) {
    await signOut();
    ui.login_error.textContent = 'This account is not an appointed Access Freedom moderator.';
    return;
  }
  state.staff = staff;
  if (state.needsPasswordSetup) {
    ui.sign_in_panel.classList.add('hidden');
    ui.password_setup_panel.classList.remove('hidden');
    ui.dashboard.classList.add('hidden');
    ui.login_screen.classList.remove('hidden');
    return;
  }
  ui.staff_email.textContent = session.user.email;
  ui.staff_role.textContent = staff.role;
  ui.staff_initials.textContent = (session.user.email?.slice(0, 2) || 'AF').toUpperCase();
  ui.login_screen.classList.add('hidden');
  ui.dashboard.classList.remove('hidden');
  state.categories = await listCategories();
  await loadQueue();
}

async function loadQueue({ keepSelection = true } = {}) {
  ui.queue_list.innerHTML = '<div class="loading">Loading the private queue…</div>';
  try {
    state.queue = await listQueue({ search: state.search, filter: state.filter });
    renderQueue();
    if (keepSelection && state.selected) {
      const fresh = state.queue.find((row) => row.id === state.selected.id);
      if (fresh) state.selected = fresh;
    }
  } catch (error) {
    ui.queue_list.innerHTML = `<div class="no-results">${escapeHtml(errorMessage(error))}</div>`;
  }
}

function renderQueue() {
  const summary = queueSummary(state.queue);
  ui.summary_places.textContent = summary.places;
  ui.summary_pending.textContent = summary.pending;
  ui.summary_conflicts.textContent = summary.conflicting;
  ui.summary_ready.textContent = summary.ready;
  ui.nav_count.textContent = summary.pending;
  if (!state.queue.length) {
    ui.queue_list.innerHTML = '<div class="no-results">No places match this view.</div>';
    return;
  }
  ui.queue_list.innerHTML = state.queue.map((row) => {
    const location = [row.town, row.postcode].filter(Boolean).join(' · ') || 'Cornwall';
    const badges = [
      row.pending_count ? `<span class="badge pending">${row.pending_count} to check</span>` : '',
      row.conflicting_count ? `<span class="badge conflicting">${row.conflicting_count} conflict</span>` : '',
      !row.pending_count && !row.conflicting_count ? '<span class="badge accepted">reviewed</span>' : '',
      `<span class="badge">${escapeHtml(row.category_label)}</span>`,
    ].join('');
    return `<button class="queue-card ${state.selected?.id === row.id ? 'active' : ''}" data-candidate="${row.id}">
      <div><h3>${escapeHtml(row.name)}</h3><div class="queue-meta">${escapeHtml(location)}</div><div class="queue-badges">${badges}</div></div><span class="queue-arrow">›</span>
    </button>`;
  }).join('');
  ui.queue_list.querySelectorAll('[data-candidate]').forEach((button) => button.addEventListener('click', () => selectCandidate(button.dataset.candidate)));
}

async function selectCandidate(id) {
  state.selected = state.queue.find((row) => row.id === id);
  renderQueue();
  ui.detail_panel.innerHTML = '<div class="loading">Opening evidence…</div>';
  try {
    [state.findings, state.place] = await Promise.all([
      getFindings(state.selected.id, state.selected.job_id),
      getPlace(state.selected.place_id),
    ]);
    renderDetail();
  } catch (error) {
    ui.detail_panel.innerHTML = `<div class="no-results">${escapeHtml(errorMessage(error))}</div>`;
  }
}

function findingTitle(finding) {
  if (finding.kind === 'accessibility_feature') return finding.feature_label || finding.feature_id;
  return ({ identity: 'Place identity', practical_note: 'Practical note', closure_signal: 'Closure information' })[finding.kind] || finding.kind;
}

function findingValue(finding) {
  if (finding.kind === 'accessibility_feature') {
    const detail = finding.value_text ? ` — ${finding.value_text}` : '';
    return `${finding.proposed_status?.replaceAll('_', ' ')}${detail}`;
  }
  return finding.value_text || finding.evidence_excerpt;
}

function renderFinding(finding) {
  const sourceUrl = safeHttpsUrl(finding.document_url);
  const actionButtons = ['pending', 'conflicting'].includes(finding.state) ? `<div class="finding-actions">
    <button class="accept" data-decision="accepted" data-finding="${finding.id}">✓ Accept</button>
    <button class="reject" data-decision="rejected" data-finding="${finding.id}">× Reject</button>
    <button data-decision="conflicting" data-finding="${finding.id}">! Conflict</button>
  </div>` : '';
  return `<article class="finding-card ${finding.state}">
    <div class="finding-top"><div class="finding-label">${escapeHtml(findingTitle(finding))}</div><span class="finding-status">${escapeHtml(decisionLabel(finding.state))}</span></div>
    <p class="finding-value"><strong>${escapeHtml(findingValue(finding))}</strong></p>
    ${finding.conditions ? `<p class="finding-conditions">Condition: ${escapeHtml(finding.conditions)}</p>` : ''}
    <div class="evidence-box"><blockquote>“${escapeHtml(finding.evidence_excerpt)}”</blockquote><div class="evidence-meta"><span>${escapeHtml(finding.source_kind.replaceAll('_', ' '))}</span><span>${formatConfidence(finding.confidence)} confidence</span>${sourceUrl ? `<a class="source-link" href="${escapeHtml(sourceUrl)}" target="_blank" rel="noopener noreferrer">Open source ↗</a>` : ''}</div></div>
    ${finding.review_notes ? `<div class="review-note">Review note: ${escapeHtml(finding.review_notes)}</div>` : ''}${actionButtons}
  </article>`;
}

function categoryOptions(selected) {
  return state.categories.map((category) => `<option value="${escapeHtml(category.id)}" ${category.id === selected ? 'selected' : ''}>${escapeHtml(category.label)}</option>`).join('');
}

function workflowMarkup() {
  const unresolved = state.findings.filter((finding) => ['pending', 'conflicting'].includes(finding.state)).length;
  if (state.place?.publication_state === 'published') return `<section class="published-banner"><h3>Published on the map</h3><p>This place passed the evidence gate and is now available to public discovery.</p></section>`;
  if (state.selected.state === 'promoted' && state.place) return `<section class="workflow-card"><p class="eyebrow">Final gate</p><h3>Draft place created</h3><p>${state.place.place_feature_claims?.length || 0} reviewed access claims are attached. Publishing will run the entrance, toilet, parking and evidence checks again.</p><label>Publication note<textarea id="publish-reason" rows="3">All findings and linked evidence checked by a moderator.</textarea></label><div class="workflow-actions"><span class="workflow-hint">The database will refuse an incomplete place.</span><button id="publish-place" class="button primary">Publish to map</button></div></section>`;
  const enabled = canCreateDraft(state.selected, state.findings);
  return `<section class="workflow-card"><p class="eyebrow">Place record</p><h3>Create the reviewed draft</h3><p>${unresolved ? `${unresolved} finding${unresolved === 1 ? '' : 's'} still need a decision.` : 'Every finding has a decision. Confirm the identity details before creating the place.'}</p><form id="draft-form"><div class="draft-grid">
    <label class="full">Place name<input id="draft-name" required value="${escapeHtml(state.selected.name)}" /></label>
    <label>Category<select id="draft-category">${categoryOptions(state.selected.category_id)}</select></label>
    <label>Postcode<input id="draft-postcode" required value="${escapeHtml(state.selected.postcode || '')}" /></label>
    <label class="full">Address<input id="draft-address" required value="${escapeHtml(state.selected.address_line_1 || '')}" /></label>
    <label class="full">Town<input id="draft-town" required value="${escapeHtml(state.selected.town || '')}" /></label>
  </div><div class="workflow-actions"><button id="open-duplicate" type="button" class="button secondary">Mark as duplicate</button><button class="button primary" type="submit" ${enabled ? '' : 'disabled'}>Create draft place</button></div></form></section>`;
}

function renderDetail() {
  const reviewed = state.findings.filter((finding) => !['pending', 'conflicting'].includes(finding.state)).length;
  const progress = state.findings.length ? Math.round(reviewed / state.findings.length * 100) : 100;
  const sourceUrl = safeHttpsUrl(state.selected.source_url);
  ui.detail_panel.innerHTML = `<header class="detail-head"><div class="detail-head-top"><div><p class="eyebrow">${escapeHtml(state.selected.category_label)}</p><h2>${escapeHtml(state.selected.name)}</h2><p>${escapeHtml([state.selected.address_line_1, state.selected.town, state.selected.postcode].filter(Boolean).join(', '))}</p></div>${sourceUrl ? `<a class="source-link" href="${escapeHtml(sourceUrl)}" target="_blank" rel="noopener noreferrer">Original record ↗</a>` : ''}</div><div class="progress-track"><span style="width:${progress}%"></span></div></header>
    <div class="detail-body"><div class="section-title"><h3>Research findings</h3><span>${reviewed} of ${state.findings.length} resolved</span></div><div class="finding-list">${state.findings.map(renderFinding).join('') || '<div class="no-results">No findings were returned.</div>'}</div>${workflowMarkup()}</div>`;
  ui.detail_panel.querySelectorAll('[data-decision]').forEach((button) => button.addEventListener('click', () => openDecision(button.dataset.finding, button.dataset.decision)));
  ui.detail_panel.querySelector('#draft-form')?.addEventListener('submit', createDraft);
  ui.detail_panel.querySelector('#open-duplicate')?.addEventListener('click', openDuplicateDialog);
  ui.detail_panel.querySelector('#publish-place')?.addEventListener('click', publishSelectedPlace);
}

function openDecision(id, decision) {
  const finding = state.findings.find((item) => item.id === id);
  state.decision = { finding, decision };
  ui.decision_title.textContent = `${decisionLabel(decision)} this finding?`;
  ui.decision_evidence.textContent = `“${finding.evidence_excerpt}”`;
  ui.decision_notes.value = decision === 'accepted' ? 'Direct statement checked against the linked source.' : '';
  ui.confirm_decision.textContent = decision === 'accepted' ? 'Accept finding' : decision === 'rejected' ? 'Reject finding' : 'Mark conflict';
  ui.decision_dialog.showModal();
}

async function saveDecision(event) {
  event.preventDefault();
  if (event.submitter?.value === 'cancel') { ui.decision_dialog.close(); return; }
  if (!state.decision) return;
  const notes = ui.decision_notes.value.trim();
  if (notes.length < 3) { ui.decision_notes.focus(); return; }
  setBusy(ui.confirm_decision, true);
  try {
    await moderateFinding(state.decision.finding.id, state.decision.decision, notes);
    ui.decision_dialog.close();
    toast('Decision saved to the audit trail.');
    await selectCandidate(state.selected.id);
    await loadQueue();
  } catch (error) { toast(errorMessage(error), true); }
  finally { setBusy(ui.confirm_decision, false); }
}

async function createDraft(event) {
  event.preventDefault();
  const button = event.submitter;
  setBusy(button, true, 'Creating draft…');
  try {
    const place = await promoteCandidate(state.selected.id, {
      name: document.querySelector('#draft-name').value.trim(), categoryId: document.querySelector('#draft-category').value,
      address: document.querySelector('#draft-address').value.trim(), town: document.querySelector('#draft-town').value.trim(), postcode: document.querySelector('#draft-postcode').value.trim(),
    });
    state.place = Array.isArray(place) ? place[0] : place;
    toast('Draft created with accepted evidence attached.');
    await loadQueue();
    await selectCandidate(state.selected.id);
  } catch (error) { toast(errorMessage(error), true); }
  finally { setBusy(button, false); }
}

async function publishSelectedPlace() {
  const reasonInput = document.querySelector('#publish-reason');
  const publishButton = document.querySelector('#publish-place');
  const reason = reasonInput.value.trim();
  if (reason.length < 3) { reasonInput.focus(); return; }
  setBusy(publishButton, true, 'Checking gate…');
  try {
    await publishPlace(state.place.id, reason);
    toast('Place published to the Access Freedom map.');
    await selectCandidate(state.selected.id);
  } catch (error) { toast(errorMessage(error), true); }
  finally { setBusy(publishButton, false); }
}

async function openDuplicateDialog() {
  ui.duplicate_search.value = state.selected.name;
  ui.duplicate_results.innerHTML = '<div class="loading">Searching candidates…</div>';
  ui.duplicate_dialog.showModal();
  await loadDuplicates();
}

async function loadDuplicates() {
  try {
    const rows = await findDuplicates(ui.duplicate_search.value, state.selected.id);
    ui.duplicate_results.innerHTML = rows.length ? rows.map((row) => `<button type="button" class="duplicate-option" data-canonical="${row.id}"><div><strong>${escapeHtml(row.name)}</strong><span>${escapeHtml([row.town, row.postcode, row.source_id].filter(Boolean).join(' · '))}</span></div><span>Choose ›</span></button>`).join('') : '<div class="no-results">No possible matches.</div>';
    ui.duplicate_results.querySelectorAll('[data-canonical]').forEach((button) => button.addEventListener('click', () => mergeDuplicate(button.dataset.canonical, button)));
  } catch (error) { ui.duplicate_results.innerHTML = `<div class="no-results">${escapeHtml(errorMessage(error))}</div>`; }
}

async function mergeDuplicate(canonicalId, button) {
  const reason = ui.duplicate_reason.value.trim();
  if (reason.length < 3) { ui.duplicate_reason.focus(); return; }
  setBusy(button, true, 'Merging…');
  try {
    await markDuplicate(state.selected.id, canonicalId, reason);
    ui.duplicate_dialog.close();
    state.selected = null;
    ui.detail_panel.innerHTML = '<div class="empty-detail"><div class="empty-icon">✓</div><h2>Duplicate linked</h2><p>The source record is preserved and points to the canonical candidate.</p></div>';
    toast('Duplicate merged without deleting its source history.');
    await loadQueue({ keepSelection: false });
  } catch (error) { toast(errorMessage(error), true); setBusy(button, false); }
}

ui.login_form.addEventListener('submit', async (event) => {
  event.preventDefault(); ui.login_error.textContent = '';
  const button = event.submitter; setBusy(button, true, 'Signing in…');
  try { await signIn(ui.email.value.trim(), ui.password.value); }
  catch (error) { ui.login_error.textContent = errorMessage(error); }
  finally { setBusy(button, false); }
});
ui.password_setup_form.addEventListener('submit', async (event) => {
  event.preventDefault();
  ui.password_setup_error.textContent = '';
  const password = ui.new_password.value;
  if (password !== ui.confirm_password.value) {
    ui.password_setup_error.textContent = 'Those passwords do not match.';
    ui.confirm_password.focus();
    return;
  }
  const button = event.submitter;
  setBusy(button, true, 'Saving securely…');
  try {
    await updatePassword(password);
    state.needsPasswordSetup = false;
    history.replaceState({}, document.title, `${location.pathname}${location.search.replace(/([?&])type=(invite|recovery)(&|$)/, '$1').replace(/[?&]$/, '')}`);
    ui.password_setup_panel.classList.add('hidden');
    ui.sign_in_panel.classList.remove('hidden');
    await establishSession(state.session);
  } catch (error) {
    ui.password_setup_error.textContent = errorMessage(error);
  } finally {
    setBusy(button, false);
  }
});
ui.sign_out.addEventListener('click', () => signOut());
ui.refresh_queue.addEventListener('click', () => loadQueue());
ui.queue_search.addEventListener('input', () => { clearTimeout(ui.queue_search._timer); ui.queue_search._timer = setTimeout(() => { state.search = ui.queue_search.value; loadQueue({ keepSelection: false }); }, 250); });
ui.queue_filters.querySelectorAll('[data-filter]').forEach((button) => button.addEventListener('click', () => {
  state.filter = button.dataset.filter;
  ui.queue_filters.querySelectorAll('button').forEach((item) => item.classList.toggle('active', item === button));
  loadQueue({ keepSelection: false });
}));
ui.decision_form.addEventListener('submit', saveDecision);
ui.duplicate_search.addEventListener('input', () => { clearTimeout(ui.duplicate_search._timer); ui.duplicate_search._timer = setTimeout(loadDuplicates, 250); });

onAuthChange((_event, session) => establishSession(session).catch((error) => toast(errorMessage(error), true)));
getSession().then(establishSession).catch((error) => { ui.login_error.textContent = errorMessage(error); });
