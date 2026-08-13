(function () {
  function qs() {
    return typeof apiContextQuery === "function" ? apiContextQuery() : "";
  }

  async function renderAnnouncementsPage(root) {
    const canEdit = state.user?.canEditAnnouncements === true;
    const data = await api(`/announcements${qs()}`);
    const items = data.announcements || [];
    root.innerHTML = `
      <div class="page-header">
        <div>
          <h1>Announcements</h1>
          <p class="muted">Company updates for this workspace</p>
        </div>
        ${canEdit ? `<button class="btn btn-primary" id="ann-new">+ New announcement</button>` : ""}
      </div>
      <div id="ann-list" class="card-list"></div>`;
    const list = root.querySelector("#ann-list");
    if (!items.length) {
      list.innerHTML = `<p class="muted">No announcements yet.</p>`;
    } else {
      list.innerHTML = items
        .map(
          (a) => `<button type="button" class="card" data-ann-id="${escapeHtml(a.id)}" style="width:100%;text-align:left;margin-bottom:.5rem">
            <strong>${escapeHtml(a.title || "")}</strong>
            <div class="muted">${escapeHtml(a.audienceSummary || "Whole company")} · ${escapeHtml(a.createdAt ? new Date(a.createdAt).toLocaleString() : "")}</div>
          </button>`
        )
        .join("");
      list.querySelectorAll("[data-ann-id]").forEach((btn) => {
        btn.onclick = () => openAnnouncement(btn.getAttribute("data-ann-id"), canEdit);
      });
    }
    root.querySelector("#ann-new")?.addEventListener("click", () => openAnnouncementEditor(null));
  }

  function splitAnnouncementBody(html) {
    const s = String(html || "");
    const tokens = s.split(/(<\/p>)/i);
    if (tokens.length < 3) return { before: s, after: "" };
    let cut = Math.ceil(tokens.length / 2);
    while (cut < tokens.length && !/^<\/p>$/i.test(tokens[cut] || "")) cut += 1;
    if (cut >= tokens.length) cut = Math.ceil(tokens.length / 2);
    return { before: tokens.slice(0, cut + 1).join(""), after: tokens.slice(cut + 1).join("") };
  }

  async function openAnnouncement(id, canEdit) {
    try {
      await api(`/announcements/${encodeURIComponent(id)}/read${qs()}`, { method: "POST", body: "{}" });
    } catch {
      /* ignore */
    }
    const data = await api(`/announcements/${encodeURIComponent(id)}${qs()}`);
    const a = data.announcement || {};
    const img = a.hasImage
      ? `<img src="/api/announcements/${encodeURIComponent(id)}/image${qs()}" alt="" style="width:100%;max-height:420px;object-fit:cover;border-radius:8px;margin:0.75rem 0" />`
      : "";
    const placement = a.imagePlacement || "top";
    const split = splitAnnouncementBody(a.bodyHtml || "");
    const body =
      placement === "middle"
        ? `${split.before ? `<div class="ann-body">${split.before}</div>` : ""}${img}${split.after ? `<div class="ann-body">${split.after}</div>` : ""}`
        : `${placement === "top" ? img : ""}<div class="ann-body">${a.bodyHtml || ""}</div>${placement === "bottom" ? img : ""}`;
    openModal(
      `<h2>${escapeHtml(a.title || "Announcement")}</h2>
       <p class="muted">${escapeHtml(a.updatedAt || a.createdAt || "")}${a.createdBy ? " · " + escapeHtml(a.createdBy) : ""}${a.audienceSummary ? " · " + escapeHtml(a.audienceSummary) : ""}</p>
       ${body}
       ${a.hasAudio ? `<audio controls style="width:100%;margin-top:1rem" src="/api/announcements/${encodeURIComponent(id)}/audio${qs()}"></audio>` : ""}
       <div class="modal-footer">
         ${canEdit ? `<button class="btn" id="ann-edit">Edit</button><button class="btn btn-danger" id="ann-del">Delete</button>` : ""}
         <button class="btn btn-primary" data-close>Close</button>
       </div>`,
      true
    );
    document.getElementById("ann-edit")?.addEventListener("click", () => {
      closeModal();
      openAnnouncementEditor(a);
    });
    document.getElementById("ann-del")?.addEventListener("click", async () => {
      if (!confirm("Delete this announcement?")) return;
      await api(`/announcements/${encodeURIComponent(id)}${qs()}`, { method: "DELETE" });
      closeModal();
      render();
    });
  }

  function openAnnouncementEditor(existing) {
    openModal(
      `<h2>${existing ? "Edit announcement" : "New announcement"}</h2>
       <label class="field"><span>Title</span><input id="ann-title" value="${escapeHtml(existing?.title || "")}" /></label>
       <label class="field"><span>Body</span><textarea id="ann-body" rows="8">${escapeHtml(existing?.bodyHtml || "").replace(/<[^>]+>/g, " ")}</textarea></label>
       <div class="modal-footer">
         <button class="btn" data-close>Cancel</button>
         <button class="btn btn-primary" id="ann-save">Save</button>
       </div>`,
      true
    );
    document.getElementById("ann-save").onclick = async () => {
      const title = document.getElementById("ann-title").value.trim();
      const bodyHtml = `<p>${escapeHtml(document.getElementById("ann-body").value).replace(/\n/g, "<br/>")}</p>`;
      if (!title) return alert("Title is required");
      const payload = {
        title,
        bodyHtml,
        companyWide: existing ? Boolean(existing.companyWide) : true,
        audienceUnits: existing?.audienceUnits || [],
        audienceTeams: existing?.audienceTeams || [],
        audienceRoles: existing?.audienceRoles || [],
        imagePlacement: existing?.imagePlacement || "top",
      };
      if (existing?.id) {
        await api(`/announcements/${encodeURIComponent(existing.id)}${qs()}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
      } else {
        await api(`/announcements${qs()}`, { method: "POST", body: JSON.stringify(payload) });
      }
      closeModal();
      render();
    };
  }

  async function renderCoachingPage(root) {
    const canSubmit = state.user?.canSubmitCoaching === true;
    const canSecret =
      state.user?.canViewCoachingSecret === true ||
      ["tl", "op", "hr", "admin", "ceo"].includes(String(state.user?.role || "").toLowerCase());
    const data = await api(`/coaching${qs()}`);
    const tickets = data.tickets || [];
    let agents = [];
    if (canSubmit) {
      try {
        const scoped = await api(`/coaching/scoped-agents${qs()}`);
        agents = scoped.employees || [];
      } catch {
        agents = [];
      }
    }
    const nameOf = (id) => {
      const e = agents.find((a) => a.id === id);
      return e?.american_name || e?.arabic_name || id || "—";
    };
    root.innerHTML = `
      <div class="page-header">
        <div>
          <h1>Coaching</h1>
          <p class="muted">Agent coaching tickets</p>
        </div>
        ${canSubmit ? `<button class="btn btn-primary" id="coach-new">+ New ticket</button>` : ""}
      </div>
      <div id="coach-list"></div>`;
    const list = root.querySelector("#coach-list");
    if (!tickets.length) {
      list.innerHTML = `<p class="muted">No coaching tickets.</p>`;
    } else {
      list.innerHTML = `<div class="grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:1rem">
        ${tickets
          .map(
            (t) => `<div class="card" data-coach-id="${escapeHtml(t.id)}" style="cursor:pointer">
              <strong>${escapeHtml(nameOf(t.employeeId))}</strong>
              <div class="muted">${escapeHtml(String(t.coachingDate || "").slice(0, 10))} · ${escapeHtml(t.status || "open")}</div>
              <p>${escapeHtml(t.generalNotes || "")}</p>
            </div>`
          )
          .join("")}
      </div>`;
      list.querySelectorAll("[data-coach-id]").forEach((card) => {
        card.onclick = () => openCoachingTicket(tickets.find((t) => t.id === card.getAttribute("data-coach-id")), agents, canSubmit, canSecret);
      });
    }
    root.querySelector("#coach-new")?.addEventListener("click", () => openCoachingTicket(null, agents, canSubmit, canSecret));
  }

  function openCoachingTicket(existing, agents, canSubmit, canSecret) {
    const isNew = !existing;
    const canEdit = isNew ? canSubmit : canSubmit || ["hr", "admin", "ceo"].includes(String(state.user?.role || "").toLowerCase());
    const showSecret = canSecret || (existing && String(existing.createdBy || "").toLowerCase() === String(state.user?.username || "").toLowerCase()) || isNew;
    const agentOptions = (agents || [])
      .map((a) => `<option value="${escapeHtml(a.id)}" ${existing?.employeeId === a.id ? "selected" : ""}>${escapeHtml(a.american_name || a.arabic_name || a.id)}</option>`)
      .join("");
    openModal(
      `<h2>${isNew ? "New coaching ticket" : "Coaching ticket"}</h2>
       <label class="field"><span>Agent</span>
         ${canEdit && canSubmit ? `<select id="coach-agent">${agentOptions}</select>` : `<input value="${escapeHtml(existing?.employeeId || "")}" disabled />`}
       </label>
       <label class="field"><span>Date</span><input id="coach-date" type="date" value="${escapeHtml(String(existing?.coachingDate || new Date().toISOString().slice(0, 10)).slice(0, 10))}" ${canEdit ? "" : "disabled"} /></label>
       <label class="field"><span>General notes</span><textarea id="coach-general" rows="4" ${canEdit ? "" : "readonly"}>${escapeHtml(existing?.generalNotes || "")}</textarea></label>
       ${showSecret ? `<label class="field"><span>Secret notes</span><textarea id="coach-secret" rows="3" ${canEdit ? "" : "readonly"}>${escapeHtml(existing?.secretNotes || "")}</textarea></label>` : ""}
       <label class="field"><span>Status</span>
         <select id="coach-status" ${canEdit ? "" : "disabled"}>
           <option value="open" ${existing?.status !== "done" ? "selected" : ""}>Open</option>
           <option value="done" ${existing?.status === "done" ? "selected" : ""}>Done</option>
         </select>
       </label>
       <div class="modal-footer">
         <button class="btn" data-close>Close</button>
         ${canEdit ? `<button class="btn btn-primary" id="coach-save">Save</button>` : ""}
       </div>`,
      true
    );
    document.getElementById("coach-save")?.addEventListener("click", async () => {
      const body = {
        employeeId: document.getElementById("coach-agent")?.value || existing?.employeeId,
        coachingDate: document.getElementById("coach-date").value,
        generalNotes: document.getElementById("coach-general").value,
        status: document.getElementById("coach-status").value,
      };
      if (showSecret && document.getElementById("coach-secret")) {
        body.secretNotes = document.getElementById("coach-secret").value;
      }
      if (existing?.id) {
        await api(`/coaching/${encodeURIComponent(existing.id)}${qs()}`, { method: "PATCH", body: JSON.stringify(body) });
      } else {
        await api(`/coaching${qs()}`, { method: "POST", body: JSON.stringify(body) });
      }
      closeModal();
      render();
    });
  }

  window.AnnouncementsCoachingModule = {
    renderAnnouncementsPage,
    renderCoachingPage,
  };
})();
