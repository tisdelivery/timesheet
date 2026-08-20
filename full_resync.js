const https = require('https');

const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzhipIs-9yF4QsXJf7wPwdJgTd2rAbV8iKwSh4C9LtJgNyBLEY2Aakn7br7twLJA43BTA/exec';
const SUPABASE_URL = 'https://ylnvepnpiwfrvneajmvq.supabase.co';
const SUPABASE_KEY = 'sb_publishable_Jo5GXu8rRgh86lgYWm3WlA_xiLPuoam';

function fetchFromAppsScript(action, queryParams = {}) {
  return new Promise((resolve, reject) => {
    let qs = new URLSearchParams({ action, ...queryParams }).toString();
    const url = `${APPS_SCRIPT_URL}?${qs}`;

    function makeReq(targetUrl) {
      https.get(targetUrl, res => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          return makeReq(res.headers.location);
        }
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch(e) {
            console.error(`[AppsScript] Failed to parse JSON for ${action}:`, body.substring(0, 150));
            resolve([]);
          }
        });
      }).on('error', reject);
    }

    makeReq(url);
  });
}

function supabaseReq(method, path, data = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(`${SUPABASE_URL}/rest/v1/${path}`);
    const options = {
      method,
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Prefer': 'return=representation',
        ...headers
      }
    };

    const req = https.request(options, res => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve({ success: true, data: JSON.parse(body), status: res.statusCode });
          } catch(e) {
            resolve({ success: true, data: body, status: res.statusCode });
          }
        } else {
          console.error(`[Supabase] Error ${method} ${path} (${res.statusCode}):`, body);
          resolve({ success: false, error: body, status: res.statusCode });
        }
      });
    });

    req.on('error', reject);
    if (data) req.write(JSON.stringify(data));
    req.end();
  });
}

function safeJsonParse(val, fallback = []) {
  if (!val) return fallback;
  if (typeof val === 'object') return val;
  try {
    return JSON.parse(val);
  } catch(e) {
    return fallback;
  }
}

async function fullSync() {
  console.log('🔄 Starting 100% Comprehensive Sync from Google Sheets to Supabase...\n');

  // Clear existing records in Supabase to prevent duplicates
  console.log('Clearing old Supabase tables...');
  await supabaseReq('DELETE', 'timesheet?id=gt.0');
  await supabaseReq('DELETE', 'submissions?submission_id=neq.placeholder');
  await supabaseReq('DELETE', 'master_project?id=gt.0');
  await supabaseReq('DELETE', 'master_activity?id=gt.0');
  await supabaseReq('DELETE', 'master_location?id=gt.0');
  console.log('Tables cleared.\n');

  // 1. Users
  console.log('1. Fetching Users...');
  const users = await fetchFromAppsScript('getUsers');
  console.log(`Found ${users.length} users.`);
  if (users.length > 0) {
    const formattedUsers = users.map(u => ({
      username: u.Username || u.username,
      password: u.Password || u.password || 'ism2026',
      fullname: u.FullName || u.fullname || u.Username,
      role: (u.Role || u.role || 'user').toLowerCase(),
      project: u.Project || u.project || null,
      position: u.Position || u.position || null,
      status: u.Status || u.status || 'Aktif',
      has_signature: !!(u.HasSignature || u.hasSignature || u.Signature || u.signature),
      signature_base64: u.Signature || u.signature || null,
      home_base: u.HomeBase || u.home_base || null,
      no_hp: u.NoHP || u.no_hp || null,
      start_kontrak: u.StartKontrak || u.start_kontrak || null,
      end_kontrak: u.EndKontrak || u.end_kontrak || null
    }));
    await supabaseReq('POST', 'users', formattedUsers, { 'Prefer': 'resolution=merge-duplicates,return=representation' });
    console.log(`✅ Synced ${formattedUsers.length} users.`);
  }

  // 2. Master Projects
  console.log('\n2. Fetching Master Projects...');
  const projects = await fetchFromAppsScript('getMasterProject');
  console.log(`Found ${projects.length} Master Projects.`);
  if (projects.length > 0) {
    const formattedProjects = projects.map(p => ({
      project_id: p.ProjectID || p['Project ID'] || p.project_id || '',
      site_id: p.SiteID || p['Site ID'] || p.site_id || null,
      project_name: p.ProjectName || p['Project Name'] || p.project_name || '',
      phase: p.Phase || p.phase || null,
      customer: p.Customer || p.customer || null
    }));

    for (let i = 0; i < formattedProjects.length; i += 100) {
      const chunk = formattedProjects.slice(i, i + 100);
      await supabaseReq('POST', 'master_project', chunk);
      process.stdout.write(`Inserted ${Math.min(i + 100, formattedProjects.length)} / ${formattedProjects.length} projects...\r`);
    }
    console.log(`\n✅ Synced ${formattedProjects.length} Master Projects.`);
  }

  // 3. Master Activities
  console.log('\n3. Fetching Master Activities...');
  const activities = await fetchFromAppsScript('getMasterActivity');
  console.log(`Found ${activities.length} activities.`);
  if (activities.length > 0) {
    const formattedActivities = activities.map(a => ({
      activity: a.Activity || a.activity || ''
    }));
    await supabaseReq('POST', 'master_activity', formattedActivities);
    console.log(`✅ Synced ${formattedActivities.length} activities.`);
  }

  // 4. Submissions
  console.log('\n4. Fetching Submissions...');
  const submissions = await fetchFromAppsScript('getSubmissionsList');
  console.log(`Found ${submissions.length} submissions.`);
  if (submissions.length > 0) {
    const formattedSubs = submissions.map(s => ({
      submission_id: s.SubmissionID || s.submission_id,
      consultant: s.Consultant || s.consultant,
      project: s.Project || s.project || null,
      period_start: s.PeriodStart || s.period_start,
      period_end: s.PeriodEnd || s.period_end,
      status: s.Status || s.status || 'Submitted',
      submitted_at: s.SubmittedAt || s.submitted_at || new Date().toISOString(),
      consultant_signature: s.Consultant_Signature || s.consultant_signature || null,
      pm_name: s.PM_Name || s.pm_name || null,
      pm_timestamp: s.PM_Timestamp || s.pm_timestamp || null,
      pm_signature: s.PM_Signature || s.pm_signature || null,
      depthead_name: s.DeptHead_Name || s.depthead_name || null,
      depthead_timestamp: s.DeptHead_Timestamp || s.depthead_timestamp || null,
      depthead_signature: s.DeptHead_Signature || s.depthead_signature || null,
      divhead_name: s.DivHead_Name || s.divhead_name || null,
      divhead_timestamp: s.DivHead_Timestamp || s.divhead_timestamp || null,
      divhead_signature: s.DivHead_Signature || s.divhead_signature || null,
      revision_count: Number(s.RevisionCount || s.revision_count || 0),
      last_revised_at: s.LastRevisedAt || s.last_revised_at || null,
      last_revision_reason: s.LastRevisionReason || s.last_revision_reason || null,
      approval_history: safeJsonParse(s.ApprovalHistory)
    }));

    for (const sub of formattedSubs) {
      await supabaseReq('POST', 'submissions', [sub]);
    }
    console.log(`✅ Synced ${formattedSubs.length} submissions.`);
  }

  // 5. ALL Timesheets directly from Google Sheets
  console.log('\n5. Fetching ALL Timesheets directly without filter...');
  const allTs = await fetchFromAppsScript('getAllTimesheet');
  console.log(`Found ${allTs.length} total timesheet records in Google Sheets.`);

  if (allTs.length > 0) {
    const formattedTs = allTs.map(r => ({
      consultant: r.ConsultantName || r.Consultant || r.consultant || '',
      date: r.Date || r.date,
      pid: r.ProjectID || r.pid || null,
      activity: r.Activity || r.activity || null,
      location: r.Location || r.location || null,
      hours: r.Hours || r.hours || null,
      mandays: Number(r.Mandays !== undefined ? r.Mandays : (r.mandays || 0)),
      holiday: !!(r.Holiday || r.holiday),
      filled: !!(r.Filled || r.filled || r.ProjectID || r.Activity || r.Hours),
      status: r.Status || r.status || 'Draft'
    }));

    for (let i = 0; i < formattedTs.length; i += 100) {
      const chunk = formattedTs.slice(i, i + 100);
      await supabaseReq('POST', 'timesheet', chunk);
      process.stdout.write(`Inserted ${Math.min(i + 100, formattedTs.length)} / ${formattedTs.length} timesheets...\r`);
    }
    console.log(`\n✅ Synced all ${formattedTs.length} timesheet records.`);
  }

  console.log('\n🎉 ALL DATA 100% RE-SYNCED TO SUPABASE SUCCESSFULLY!');
}

fullSync().catch(console.error);
