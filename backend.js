import { createClient } from "https://esm.sh/@supabase/supabase-js@2.112.3";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "./supabase-config.js";

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { autoRefreshToken: true, detectSessionInUrl: true, persistSession: true },
});

function unwrap({ data, error }) {
  if (error) throw error;
  return data;
}

export async function signIn(email, password) {
  return unwrap(await supabase.auth.signInWithPassword({ email, password }));
}

export async function signOut() {
  return unwrap(await supabase.auth.signOut());
}

export async function updatePassword(password) {
  return unwrap(await supabase.auth.updateUser({ password }));
}

export async function getSession() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session;
}

export function onAuthChange(callback) {
  return supabase.auth.onAuthStateChange((event, session) => callback(event, session));
}

export async function getStaffMembership(userId) {
  return unwrap(await supabase.from('staff_members').select('user_id,role').eq('user_id', userId).maybeSingle());
}

export async function listCategories() {
  return unwrap(await supabase.from('place_categories').select('id,label').eq('active', true).order('sort_order'));
}

export async function listQueue({ search = '', filter = 'all' } = {}) {
  let query = supabase
    .from('moderation_candidate_queue')
    .select('*')
    .eq('job_status', 'completed')
    .order('completed_at', { ascending: false })
    .limit(60);
  if (search.trim()) query = query.ilike('name', `%${search.trim().replaceAll('%', '')}%`);
  if (filter === 'pending') query = query.gt('pending_count', 0);
  if (filter === 'conflicts') query = query.gt('conflicting_count', 0);
  if (filter === 'ready') query = query.eq('pending_count', 0).eq('conflicting_count', 0);
  if (filter === 'drafts') query = query.eq('state', 'promoted');
  return unwrap(await query);
}

export async function getFindings(candidateId, jobId) {
  return unwrap(await supabase
    .from('moderation_finding_details')
    .select('*')
    .eq('candidate_id', candidateId)
    .eq('job_id', jobId)
    .order('created_at', { ascending: true }));
}

export async function getPlace(placeId) {
  if (!placeId) return null;
  return unwrap(await supabase
    .from('places')
    .select('*,place_feature_claims(id,feature_id,status,value_text,conditions,verification_state,moderation_state,evidence(id,source_name,source_url,caption,review_state))')
    .eq('id', placeId)
    .maybeSingle());
}

export async function moderateFinding(findingId, decision, notes) {
  return unwrap(await supabase.rpc('moderate_research_finding', {
    p_finding_id: findingId,
    p_decision: decision,
    p_notes: notes,
  }));
}

export async function promoteCandidate(candidateId, values) {
  return unwrap(await supabase.rpc('promote_candidate_to_draft', {
    p_candidate_id: candidateId,
    p_name: values.name,
    p_category_id: values.categoryId,
    p_address_line_1: values.address,
    p_town: values.town,
    p_postcode: values.postcode,
  }));
}

export async function publishPlace(placeId, reason) {
  return unwrap(await supabase.rpc('publish_moderated_place', {
    p_place_id: placeId,
    p_reason: reason,
  }));
}

export async function findDuplicates(search, excludeId) {
  let query = supabase
    .from('place_import_candidates')
    .select('id,name,town,postcode,source_id,state,place_id')
    .neq('id', excludeId)
    .is('duplicate_of_candidate_id', null)
    .order('name')
    .limit(12);
  if (search.trim()) query = query.ilike('name', `%${search.trim().replaceAll('%', '')}%`);
  return unwrap(await query);
}

export async function markDuplicate(duplicateId, canonicalId, reason) {
  return unwrap(await supabase.rpc('mark_candidate_duplicate', {
    p_duplicate_id: duplicateId,
    p_canonical_id: canonicalId,
    p_reason: reason,
  }));
}
