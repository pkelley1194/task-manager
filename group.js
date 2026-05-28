// ── GROUP PROJECTS — Phase 3 ───────────────────────────────────────────────
// This module is inlined into index.html at build time.
// All functions are exported to window by the main script.

export function initGroup({ db, currentUser, currentUserDoc, addNotification,
  collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc,
  query, where, orderBy, onSnapshot, serverTimestamp, fmtDue, fmtTime,
  diffDays, PALETTE, getColor }) {

  let groupProjects = [];
  let myMemberships = {}; // projectId -> 'lead'|'member'|'pending'|null
  let openGroup = {};
  let editingGroupProjId = null;
  let selGroupColor = 'purple';
  let groupUnsubs = [];

  const $ = id => document.getElementById(id);

  // ── SUBSCRIBE ────────────────────────────────────────────────────────────
  function subscribeGroupProjects() {
    unsubGroup();
    // All group projects (we filter visibility client-side)
    const unsub = onSnapshot(
      query(collection(db, 'groupProjects'), orderBy('createdAt', 'desc')),
      async snap => {
        groupProjects = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        await refreshMemberships();
        if (document.getElementById('view-group')?.style.display !== 'none') renderGroupProjects();
      }
    );
    groupUnsubs.push(unsub);
  }

  async function refreshMemberships() {
    myMemberships = {};
    for (const p of groupProjects) {
      const leads = p.leads || [];
      const members = p.members || [];
      if (leads.includes(currentUser.uid)) myMemberships[p.id] = 'lead';
      else if (members.includes(currentUser.uid)) myMemberships[p.id] = 'member';
      else {
        // Check for pending join request
        try {
          const reqSnap = await getDoc(doc(db, 'groupProjects', p.id, 'joinRequests', currentUser.uid));
          if (reqSnap.exists() && reqSnap.data().status === 'pending') myMemberships[p.id] = 'pending';
        } catch(e) {}
      }
    }
  }

  function unsubGroup() {
    groupUnsubs.forEach(u => u());
    groupUnsubs = [];
  }

  // ── RENDER GROUP TAB ─────────────────────────────────────────────────────
  function renderGroupProjects() {
    const el = $('view-group');
    if (!el) return;

    // Separate: my projects (lead/member) vs discoverable
    const mine = groupProjects.filter(p => myMemberships[p.id] === 'lead' || myMemberships[p.id] === 'member');
    const discoverable = groupProjects.filter(p =>
      !myMemberships[p.id] && !p.isPrivate
    );

    el.innerHTML = `
      <div class="page-header">
        <h2>Group Projects</h2>
        <button class="btn btn-primary" onclick="openGroupProjModal(null)"><i class="ti ti-plus"></i> New group project</button>
      </div>

      ${mine.length ? `
        <div style="margin-bottom:28px">
          <div style="font-size:13px;font-weight:600;color:var(--text-2);margin-bottom:12px;text-transform:uppercase;letter-spacing:.04em">My projects</div>
          ${mine.map(p => renderGroupCard(p, true)).join('')}
        </div>
      ` : ''}

      <div>
        <div style="font-size:13px;font-weight:600;color:var(--text-2);margin-bottom:12px;text-transform:uppercase;letter-spacing:.04em">Discover projects</div>
        ${discoverable.length
          ? discoverable.map(p => renderGroupCard(p, false)).join('')
          : `<div class="empty"><i class="ti ti-users"></i><p>No public projects to discover</p></div>`
        }
      </div>
    `;
  }

  function renderGroupCard(p, isMember) {
    const col = getColor(p.color || 'purple');
    const role = myMemberships[p.id];
    const leads = p.leads || [];
    const members = p.members || [];
    const memberCount = leads.length + members.length;
    const isLead = role === 'lead';
    const isPending = role === 'pending';
    const isOpen = openGroup[p.id];

    let statusBadge = '';
    if (isLead) statusBadge = `<span style="font-size:11px;font-weight:600;padding:2px 8px;border-radius:20px;background:#EEEDFE;color:#3C3489">Lead</span>`;
    else if (role === 'member') statusBadge = `<span style="font-size:11px;font-weight:600;padding:2px 8px;border-radius:20px;background:var(--surface2);color:var(--text-2)">Member</span>`;
    else if (isPending) statusBadge = `<span style="font-size:11px;font-weight:600;padding:2px 8px;border-radius:20px;background:#FAEEDA;color:#633806">Request pending</span>`;
    if (p.isPrivate) statusBadge += `<span style="font-size:11px;padding:2px 8px;border-radius:20px;background:var(--surface2);color:var(--text-3);margin-left:4px"><i class="ti ti-lock" style="font-size:10px"></i> Private</span>`;

    const actions = isMember
      ? `<button class="btn btn-sm" onclick="openGroupProjView('${p.id}')"><i class="ti ti-arrow-right"></i> Open</button>
         ${isLead ? `<button class="btn btn-sm" onclick="openGroupProjModal('${p.id}')"><i class="ti ti-pencil"></i></button>` : ''}`
      : isPending
        ? `<button class="btn btn-sm" disabled>Request sent</button>`
        : `<button class="btn btn-sm btn-primary" onclick="requestJoin('${p.id}','${p.name}')"><i class="ti ti-user-plus"></i> Request to join</button>`;

    return `<div class="project-card" style="margin-bottom:10px">
      <div style="display:flex;align-items:center;gap:12px;padding:14px 16px;">
        <div class="project-stripe" style="background:${col.accent}"></div>
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:3px">
            <span style="font-size:14px;font-weight:600">${p.name}</span>
            ${statusBadge}
          </div>
          ${p.goal ? `<div style="font-size:12px;color:var(--text-2);margin-bottom:3px">${p.goal}</div>` : ''}
          <div style="font-size:11px;color:var(--text-3)">${memberCount} member${memberCount!==1?'s':''}</div>
        </div>
        <div style="display:flex;gap:6px;align-items:center;flex-shrink:0">${actions}</div>
      </div>
    </div>`;
  }

  // ── GROUP PROJECT DETAIL VIEW ─────────────────────────────────────────────
  async function openGroupProjView(pid) {
    const p = groupProjects.find(x => x.id === pid);
    if (!p) return;
    const role = myMemberships[pid];
    const isLead = role === 'lead';
    const col = getColor(p.color || 'purple');

    // Load members info
    const allUids = [...(p.leads||[]), ...(p.members||[])];
    const memberDocs = await Promise.all(allUids.map(uid => getDoc(doc(db,'users',uid))));
    const memberMap = {};
    memberDocs.forEach(d => { if(d.exists()) memberMap[d.id] = d.data(); });

    // Load deliverables
    const delSnap = await getDocs(
      query(collection(db,'groupProjects',pid,'deliverables'), orderBy('createdAt','asc'))
    );
    const deliverables = delSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    // Load join requests (leads only)
    let joinRequests = [];
    if (isLead) {
      const reqSnap = await getDocs(
        query(collection(db,'groupProjects',pid,'joinRequests'), where('status','==','pending'))
      );
      joinRequests = reqSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    }

    // Load my work items for each deliverable assigned to me
    const myDeliverables = deliverables.filter(d => d.assigneeUid === currentUser.uid);
    const workItemsMap = {};
    for (const del of myDeliverables) {
      const wiSnap = await getDocs(
        query(collection(db,'groupProjects',pid,'deliverables',del.id,'workItems'), orderBy('createdAt','asc'))
      );
      workItemsMap[del.id] = wiSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    }

    const el = $('view-group');
    el.innerHTML = `
      <div class="page-header">
        <div style="display:flex;align-items:center;gap:10px">
          <button class="btn btn-sm" onclick="renderGroupProjects()"><i class="ti ti-arrow-left"></i></button>
          <div>
            <h2 style="margin-bottom:2px">${p.name}</h2>
            ${p.goal ? `<div style="font-size:13px;color:var(--text-2)">${p.goal}</div>` : ''}
          </div>
        </div>
        <div class="page-actions">
          ${isLead ? `<button class="btn" onclick="openDeliverableModal('${pid}',null,${JSON.stringify(allUids)},${JSON.stringify(memberMap)})"><i class="ti ti-plus"></i> Assign deliverable</button>
          <button class="btn btn-primary" onclick="openGroupProjModal('${pid}')"><i class="ti ti-pencil"></i> Edit project</button>` : ''}
          <button class="btn" onclick="doGroupExport('${pid}')"><i class="ti ti-file-text"></i> Export to Word</button>
        </div>
      </div>

      ${joinRequests.length ? `
        <div style="background:#FAEEDA;border:1px solid #EF9F27;border-radius:var(--radius);padding:14px 16px;margin-bottom:18px">
          <div style="font-size:13px;font-weight:600;color:#633806;margin-bottom:10px"><i class="ti ti-user-plus"></i> Join requests (${joinRequests.length})</div>
          ${joinRequests.map(r => `
            <div style="display:flex;align-items:center;gap:10px;padding:7px 0;border-top:1px solid rgba(186,117,23,0.2)">
              <span style="flex:1;font-size:13px;font-weight:500">${r.displayName||r.email}</span>
              <span style="font-size:12px;color:#633806">${fmtTime(r.requestedAt)}</span>
              <button class="btn btn-sm btn-success" onclick="handleJoinRequest('${pid}','${r.id}','approved','${r.displayName||r.email}')"><i class="ti ti-check"></i> Approve</button>
              <button class="btn btn-sm btn-danger" onclick="handleJoinRequest('${pid}','${r.id}','declined','${r.displayName||r.email}')"><i class="ti ti-x"></i> Decline</button>
            </div>
          `).join('')}
        </div>
      ` : ''}

      ${isLead ? renderLeadDeliverableView(pid, deliverables, memberMap, allUids) : renderMemberDeliverableView(pid, deliverables, workItemsMap)}

      ${isLead ? renderMemberList(pid, p, memberMap, allUids) : ''}
    `;
  }

  function renderLeadDeliverableView(pid, deliverables, memberMap, allUids) {
    if (!deliverables.length) return `<div class="empty"><i class="ti ti-clipboard-list"></i><p>No deliverables yet</p><p style="font-size:12px">Assign work to project members to get started.</p></div>`;

    const byAssignee = {};
    deliverables.forEach(d => {
      const uid = d.assigneeUid || 'unassigned';
      if (!byAssignee[uid]) byAssignee[uid] = [];
      byAssignee[uid].push(d);
    });

    return Object.entries(byAssignee).map(([uid, dels]) => {
      const member = memberMap[uid];
      const name = member?.displayName || member?.email || 'Unassigned';
      return `<div style="margin-bottom:20px">
        <div style="font-size:13px;font-weight:600;color:var(--text-2);margin-bottom:10px;display:flex;align-items:center;gap:8px">
          <div style="width:24px;height:24px;border-radius:50%;background:var(--surface3);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:600">${name[0].toUpperCase()}</div>
          ${name}
          <span style="font-size:11px;color:var(--text-3);font-weight:400">${dels.length} deliverable${dels.length!==1?'s':''}</span>
        </div>
        ${dels.map(d => renderDeliverableRow(pid, d, true, memberMap, allUids)).join('')}
      </div>`;
    }).join('');
  }

  function renderMemberDeliverableView(pid, deliverables, workItemsMap) {
    const mine = deliverables.filter(d => d.assigneeUid === currentUser.uid);
    if (!mine.length) return `<div class="empty"><i class="ti ti-clipboard-list"></i><p>No deliverables assigned to you yet</p></div>`;
    return mine.map(d => renderDeliverableRow(pid, d, false, {}, [], workItemsMap[d.id] || [])).join('');
  }

  function renderDeliverableRow(pid, d, isLead, memberMap, allUids, workItems = []) {
    const statusColors = { pending: { bg:'var(--surface2)', color:'var(--text-2)' }, inprogress: { bg:'#E6F1FB', color:'#0C447C' }, complete: { bg:'#E1F5EE', color:'#085041' } };
    const sc = statusColors[d.status] || statusColors.pending;
    const statusLabel = { pending:'Not started', inprogress:'In progress', complete:'Complete' }[d.status] || d.status;
    const df = d.deadline ? fmtDue(d.deadline) : null;

    const wiDone = workItems.filter(w => w.done).length;
    const wiTotal = workItems.length;

    return `<div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:14px 16px;margin-bottom:10px;${d.atRiskFlag?'border-color:#EF9F27;':''}" id="del-${d.id}">
      <div style="display:flex;align-items:flex-start;gap:10px">
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px">
            <span style="font-size:14px;font-weight:600">${d.name}</span>
            <span style="font-size:11px;font-weight:600;padding:2px 8px;border-radius:20px;background:${sc.bg};color:${sc.color}">${statusLabel}</span>
            ${d.urgentFlag ? `<span style="font-size:11px;font-weight:600;padding:2px 8px;border-radius:20px;background:#FCEBEB;color:#A32D2D"><i class="ti ti-flame" style="font-size:10px"></i> Urgent</span>` : ''}
            ${d.atRiskFlag ? `<span style="font-size:11px;font-weight:600;padding:2px 8px;border-radius:20px;background:#FAEEDA;color:#633806"><i class="ti ti-alert-triangle" style="font-size:10px"></i> At risk</span>` : ''}
          </div>
          ${d.description ? `<div style="font-size:13px;color:var(--text-2);margin-bottom:6px;line-height:1.5">${d.description}</div>` : ''}
          ${d.atRiskFlag && d.atRiskMessage ? `<div style="font-size:12px;color:#633806;background:#FAEEDA;border-radius:var(--radius-sm);padding:6px 10px;margin-bottom:6px"><i class="ti ti-message"></i> "${d.atRiskMessage}"</div>` : ''}
          <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
            ${df ? `<span style="font-size:12px;color:${df.cls==='overdue'?'#A32D2D':'var(--text-2)'}"><i class="ti ti-calendar" style="font-size:12px"></i> ${df.label}</span>` : ''}
            ${!isLead && wiTotal > 0 ? `<span style="font-size:12px;color:var(--text-2)"><i class="ti ti-checklist" style="font-size:12px"></i> ${wiDone}/${wiTotal} work items</span>` : ''}
            ${isLead && wiTotal > 0 ? `<span style="font-size:12px;color:var(--text-2)"><i class="ti ti-checklist" style="font-size:12px"></i> ${wiDone}/${wiTotal} done</span>` : ''}
          </div>
        </div>
        <div style="display:flex;flex-direction:column;gap:6px;flex-shrink:0;align-items:flex-end">
          ${isLead
            ? `<button class="btn btn-sm" onclick="openDeliverableModal('${pid}','${d.id}',${JSON.stringify(allUids)},${JSON.stringify(memberMap)})"><i class="ti ti-pencil"></i></button>
               <select style="width:auto;font-size:12px;padding:4px 8px" onchange="updateDeliverableStatus('${pid}','${d.id}',this.value)">
                 <option${d.status==='pending'?' selected':''} value="pending">Not started</option>
                 <option${d.status==='inprogress'?' selected':''} value="inprogress">In progress</option>
                 <option${d.status==='complete'?' selected':''} value="complete">Complete</option>
               </select>`
            : `<button class="btn btn-sm" onclick="toggleAtRisk('${pid}','${d.id}',${!d.atRiskFlag},'${d.name}')">${d.atRiskFlag ? '<i class="ti ti-flag-off"></i> Clear flag' : '<i class="ti ti-flag"></i> Flag at risk'}</button>
               <select style="width:auto;font-size:12px;padding:4px 8px" onchange="updateDeliverableStatus('${pid}','${d.id}',this.value)">
                 <option${d.status==='pending'?' selected':''} value="pending">Not started</option>
                 <option${d.status==='inprogress'?' selected':''} value="inprogress">In progress</option>
                 <option${d.status==='complete'?' selected':''} value="complete">Complete</option>
               </select>`
          }
        </div>
      </div>
      ${!isLead ? renderWorkItems(pid, d.id, workItems) : ''}
    </div>`;
  }

  function renderWorkItems(pid, delId, workItems) {
    return `<div style="border-top:1px solid var(--border);margin-top:12px;padding-top:12px">
      <div style="font-size:12px;font-weight:600;color:var(--text-2);margin-bottom:8px">My work items (private)</div>
      ${workItems.map(w => `
        <div style="display:flex;align-items:center;gap:8px;padding:5px 0">
          <div class="done-check${w.done?' checked':''}" onclick="toggleWorkItem('${pid}','${delId}','${w.id}',${!w.done})"><i class="ti ti-check"></i></div>
          <span style="flex:1;font-size:13px;${w.done?'text-decoration:line-through;color:var(--text-3)':''}">${w.name}</span>
          ${w.due ? `<span style="font-size:11px;color:var(--text-3)">${fmtDue(w.due)?.label||''}</span>` : ''}
          <button class="icon-btn" onclick="deleteWorkItem('${pid}','${delId}','${w.id}')" style="font-size:14px"><i class="ti ti-x"></i></button>
        </div>
      `).join('')}
      <div style="display:flex;gap:6px;margin-top:8px">
        <input type="text" id="wi-input-${delId}" placeholder="Add a work item…" style="flex:1;font-size:13px;padding:6px 10px" onkeydown="if(event.key==='Enter')addWorkItem('${pid}','${delId}')">
        <button class="btn btn-sm" onclick="addWorkItem('${pid}','${delId}')"><i class="ti ti-plus"></i></button>
      </div>
    </div>`;
  }

  function renderMemberList(pid, p, memberMap, allUids) {
    const leads = p.leads || [];
    const members = p.members || [];
    return `<div style="margin-top:24px">
      <div style="font-size:13px;font-weight:600;color:var(--text-2);margin-bottom:12px;text-transform:uppercase;letter-spacing:.04em">Members (${allUids.length})</div>
      ${allUids.map(uid => {
        const m = memberMap[uid];
        const isLead = leads.includes(uid);
        const isMe = uid === currentUser.uid;
        return `<div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--border)">
          <div style="width:28px;height:28px;border-radius:50%;background:var(--surface3);display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:600;flex-shrink:0">${(m?.displayName||m?.email||'?')[0].toUpperCase()}</div>
          <span style="flex:1;font-size:13px;font-weight:500">${m?.displayName||m?.email||uid}${isMe?' (you)':''}</span>
          <span style="font-size:11px;font-weight:600;padding:2px 8px;border-radius:20px;${isLead?'background:#EEEDFE;color:#3C3489':'background:var(--surface2);color:var(--text-2)'}">${isLead?'Lead':'Member'}</span>
          ${!isMe ? `<div style="display:flex;gap:4px">
            ${isLead
              ? `<button class="btn btn-sm" onclick="changeGroupRole('${pid}','${uid}','member','${p.name}')">Make Member</button>`
              : `<button class="btn btn-sm" onclick="changeGroupRole('${pid}','${uid}','lead','${p.name}')">Make Lead</button>`
            }
            <button class="btn btn-sm btn-danger" onclick="removeMember('${pid}','${uid}','${m?.displayName||'this user'}')"><i class="ti ti-x"></i></button>
          </div>` : ''}
        </div>`;
      }).join('')}
    </div>`;
  }

  // ── ACTIONS ───────────────────────────────────────────────────────────────
  async function requestJoin(pid, projectName) {
    const p = groupProjects.find(x => x.id === pid);
    if (!p) return;
    await setDoc(doc(db, 'groupProjects', pid, 'joinRequests', currentUser.uid), {
      uid: currentUser.uid, email: currentUser.email,
      displayName: currentUserDoc.displayName || currentUser.email,
      requestedAt: serverTimestamp(), status: 'pending'
    });
    // Notify all leads
    for (const leadUid of (p.leads || [])) {
      await addNotification(leadUid, `${currentUserDoc.displayName || currentUser.email} requested to join "${projectName}"`);
    }
    myMemberships[pid] = 'pending';
    renderGroupProjects();
  }

  async function handleJoinRequest(pid, uid, status, name) {
    const p = groupProjects.find(x => x.id === pid);
    await updateDoc(doc(db, 'groupProjects', pid, 'joinRequests', uid), { status, resolvedAt: serverTimestamp() });
    if (status === 'approved') {
      const newMembers = [...(p.members || []), uid];
      await updateDoc(doc(db, 'groupProjects', pid), { members: newMembers });
      await addNotification(uid, `Your request to join "${p.name}" was approved!`);
    } else {
      await addNotification(uid, `Your request to join "${p.name}" was declined.`);
    }
    openGroupProjView(pid);
  }

  async function updateDeliverableStatus(pid, delId, status) {
    const p = groupProjects.find(x => x.id === pid);
    await updateDoc(doc(db, 'groupProjects', pid, 'deliverables', delId), { status });
    if (status === 'complete') {
      for (const leadUid of (p?.leads || [])) {
        if (leadUid !== currentUser.uid) {
          const delSnap = await getDoc(doc(db, 'groupProjects', pid, 'deliverables', delId));
          const delName = delSnap.data()?.name || 'A deliverable';
          await addNotification(leadUid, `"${delName}" marked complete by ${currentUserDoc.displayName || currentUser.email} in "${p.name}"`);
        }
      }
    }
    openGroupProjView(pid);
  }

  async function toggleAtRisk(pid, delId, flagVal, delName) {
    let atRiskMessage = '';
    if (flagVal) {
      atRiskMessage = prompt('Optional: add a short message for the lead (e.g. "Waiting on external feedback")') || '';
    }
    await updateDoc(doc(db, 'groupProjects', pid, 'deliverables', delId), { atRiskFlag: flagVal, atRiskMessage });
    const p = groupProjects.find(x => x.id === pid);
    if (flagVal) {
      for (const leadUid of (p?.leads || [])) {
        await addNotification(leadUid, `⚠️ "${delName}" flagged at risk by ${currentUserDoc.displayName || currentUser.email}${atRiskMessage ? ': "'+atRiskMessage+'"' : ''}`);
      }
    } else {
      for (const leadUid of (p?.leads || [])) {
        await addNotification(leadUid, `✓ At-risk flag cleared on "${delName}" by ${currentUserDoc.displayName || currentUser.email}`);
      }
      await addNotification(currentUser.uid, `At-risk flag cleared on "${delName}"`);
    }
    openGroupProjView(pid);
  }

  async function addWorkItem(pid, delId) {
    const input = document.getElementById('wi-input-' + delId);
    const name = input?.value?.trim();
    if (!name) return;
    await addDoc(collection(db, 'groupProjects', pid, 'deliverables', delId, 'workItems'), {
      name, done: false, due: '', createdAt: serverTimestamp(), ownerUid: currentUser.uid
    });
    input.value = '';
    openGroupProjView(pid);
  }

  async function toggleWorkItem(pid, delId, wiId, val) {
    await updateDoc(doc(db, 'groupProjects', pid, 'deliverables', delId, 'workItems', wiId), { done: val });
    openGroupProjView(pid);
  }

  async function deleteWorkItem(pid, delId, wiId) {
    await deleteDoc(doc(db, 'groupProjects', pid, 'deliverables', delId, 'workItems', wiId));
    openGroupProjView(pid);
  }

  async function changeGroupRole(pid, uid, newRole, projectName) {
    const p = groupProjects.find(x => x.id === pid);
    let leads = [...(p.leads || [])];
    let members = [...(p.members || [])];
    if (newRole === 'lead') {
      leads = [...new Set([...leads, uid])];
      members = members.filter(m => m !== uid);
    } else {
      members = [...new Set([...members, uid])];
      leads = leads.filter(l => l !== uid);
    }
    await updateDoc(doc(db, 'groupProjects', pid), { leads, members });
    await addNotification(uid, `Your role in "${projectName}" has been changed to ${newRole}.`);
    openGroupProjView(pid);
  }

  async function removeMember(pid, uid, name) {
    if (!window.confirm(`Remove ${name} from this project?`)) return;
    const p = groupProjects.find(x => x.id === pid);
    await updateDoc(doc(db, 'groupProjects', pid), {
      leads: (p.leads || []).filter(l => l !== uid),
      members: (p.members || []).filter(m => m !== uid),
    });
    await addNotification(uid, `You have been removed from "${p.name}".`);
    openGroupProjView(pid);
  }

  // ── GROUP PROJECT MODAL ───────────────────────────────────────────────────
  function openGroupProjModal(id) {
    editingGroupProjId = id;
    const p = id ? groupProjects.find(x => x.id === id) : null;
    const modal = document.getElementById('group-proj-modal');
    document.getElementById('gpf-name').value = p?.name || '';
    document.getElementById('gpf-goal').value = p?.goal || '';
    document.getElementById('gpf-due').value = p?.due || '';
    document.getElementById('gpf-private').checked = p?.isPrivate || false;
    selGroupColor = p?.color || 'purple';
    buildGroupColorPicker();
    document.getElementById('gpf-delete-btn').style.display = p ? '' : 'none';
    modal.classList.add('open');
    setTimeout(() => document.getElementById('gpf-name').focus(), 50);
  }

  function closeGroupProjModal() {
    document.getElementById('group-proj-modal').classList.remove('open');
    editingGroupProjId = null;
  }

  function buildGroupColorPicker() {
    document.getElementById('group-color-picker').innerHTML = PALETTE.map(p =>
      `<div class="color-opt${selGroupColor===p.name?' sel':''}" style="background:${p.accent}" onclick="setGroupColor('${p.name}')" title="${p.name}"></div>`
    ).join('');
  }

  async function saveGroupProject() {
    const name = document.getElementById('gpf-name').value.trim();
    if (!name) return;
    const data = {
      name,
      goal: document.getElementById('gpf-goal').value,
      due: document.getElementById('gpf-due').value,
      color: selGroupColor,
      isPrivate: document.getElementById('gpf-private').checked,
    };
    if (editingGroupProjId) {
      await updateDoc(doc(db, 'groupProjects', editingGroupProjId), data);
    } else {
      const ref = await addDoc(collection(db, 'groupProjects'), {
        ...data,
        leads: [currentUser.uid],
        members: [],
        createdBy: currentUser.uid,
        createdAt: serverTimestamp(),
      });
      myMemberships[ref.id] = 'lead';
    }
    closeGroupProjModal();
    if(window.toast) window.toast('Project saved', 'success');
    renderGroupProjects();
  }

  async function deleteGroupProject() {
    if (!editingGroupProjId) return;
    if (!window.confirm('Delete this project? This cannot be undone.')) return;
    await deleteDoc(doc(db, 'groupProjects', editingGroupProjId));
    closeGroupProjModal();
    if(window.toast) window.toast('Project saved', 'success');
    renderGroupProjects();
  }

  // ── DELIVERABLE MODAL ─────────────────────────────────────────────────────
  let currentDelPid = null, editingDelId = null, currentDelMembers = [], currentDelMemberMap = {};

  function openDeliverableModal(pid, delId, memberUids, memberMap) {
    currentDelPid = pid; editingDelId = delId;
    currentDelMembers = memberUids; currentDelMemberMap = memberMap;
    const del = delId ? null : null; // will load async
    document.getElementById('df-name').value = '';
    document.getElementById('df-desc').value = '';
    document.getElementById('df-deadline').value = '';
    document.getElementById('df-urgent').checked = false;
    // Populate assignee dropdown
    document.getElementById('df-assignee').innerHTML =
      `<option value="">Select member…</option>` +
      memberUids.map(uid => {
        const m = memberMap[uid];
        return `<option value="${uid}">${m?.displayName || m?.email || uid}</option>`;
      }).join('');
    if (delId) loadDeliverableForEdit(pid, delId);
    document.getElementById('del-modal').classList.add('open');
    setTimeout(() => document.getElementById('df-name').focus(), 50);
  }

  async function loadDeliverableForEdit(pid, delId) {
    const snap = await getDoc(doc(db, 'groupProjects', pid, 'deliverables', delId));
    if (!snap.exists()) return;
    const d = snap.data();
    document.getElementById('df-name').value = d.name || '';
    document.getElementById('df-desc').value = d.description || '';
    document.getElementById('df-deadline').value = d.deadline || '';
    document.getElementById('df-urgent').checked = d.urgentFlag || false;
    document.getElementById('df-assignee').value = d.assigneeUid || '';
  }

  function closeDeliverableModal() {
    document.getElementById('del-modal').classList.remove('open');
    currentDelPid = null; editingDelId = null;
  }

  async function saveDeliverable() {
    const name = document.getElementById('df-name').value.trim();
    if (!name) return;
    const assigneeUid = document.getElementById('df-assignee').value;
    if (!assigneeUid) { alert('Please select an assignee.'); return; }
    const data = {
      name, description: document.getElementById('df-desc').value,
      deadline: document.getElementById('df-deadline').value,
      urgentFlag: document.getElementById('df-urgent').checked,
      assigneeUid, status: 'pending', atRiskFlag: false, atRiskMessage: '',
    };
    const p = groupProjects.find(x => x.id === currentDelPid);
    if (editingDelId) {
      await updateDoc(doc(db, 'groupProjects', currentDelPid, 'deliverables', editingDelId), data);
    } else {
      await addDoc(collection(db, 'groupProjects', currentDelPid, 'deliverables'), {
        ...data, createdBy: currentUser.uid, createdAt: serverTimestamp()
      });
      await addNotification(assigneeUid, `You've been assigned "${name}" in "${p?.name || 'a group project'}"`);
    }
    closeDeliverableModal();
    if(window.toast) window.toast('Deliverable saved', 'success');
    openGroupProjView(currentDelPid);
  }

  // ── GROUP EXPORT ─────────────────────────────────────────────────────────
  async function doGroupExport(pid) {
    const p = groupProjects.find(x => x.id === pid);
    if (!p) return;
    const delSnap = await getDocs(
      query(collection(db,'groupProjects',pid,'deliverables'), orderBy('createdAt','asc'))
    );
    const deliverables = delSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const allUids = [...new Set([...(p.leads||[]), ...(p.members||[])])];
    const memberDocs = await Promise.all(allUids.map(uid => getDoc(doc(db,'users',uid))));
    const memberMap = {};
    memberDocs.forEach(d => { if (d.exists()) memberMap[d.id] = d.data(); });
    const payload = { type:'group', project:p, deliverables, memberMap };
    if (window.sendPrompt) {
      window.sendPrompt('__EXPORT_GROUP_WORKPLAN__' + JSON.stringify(payload));
    } else {
      alert('Open this app inside Claude to generate Word exports.');
    }
  }

  // ── EXPOSE ────────────────────────────────────────────────────────────────
  return {
    subscribeGroupProjects, unsubGroup, renderGroupProjects,
    openGroupProjView, requestJoin, handleJoinRequest,
    updateDeliverableStatus, toggleAtRisk,
    addWorkItem, toggleWorkItem, deleteWorkItem,
    changeGroupRole, removeMember,
    openGroupProjModal, closeGroupProjModal,
    saveGroupProject, deleteGroupProject,
    buildGroupColorPicker,
    setGroupColor: (c) => { selGroupColor = c; buildGroupColorPicker(); },
    openDeliverableModal, closeDeliverableModal, saveDeliverable,
    doGroupExport,
  };
}

// ── GROUP WORD EXPORT ────────────────────────────────────────────────────────
export async function exportGroupProjectDocx(pid, projectData, deliverables, memberMap) {
  // Gather data and send to Claude for docx generation
  const payload = {
    type: 'group',
    project: projectData,
    deliverables,
    memberMap,
  };
  if (window.sendPrompt) {
    window.sendPrompt('__EXPORT_GROUP_WORKPLAN__' + JSON.stringify(payload));
  } else {
    alert('Open this app inside Claude to generate Word exports.');
  }
}
