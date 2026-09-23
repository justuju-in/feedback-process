"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Check,
  BarChart3,
  Bell,
  Home as HomeIcon,
  History as HistoryIcon,
  Inbox,
  LogOut,
  Plus,
  Send,
  Sparkles,
  UsersRound,
} from "lucide-react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "/api";
const primaryButton = "btn btn-primary";
const secondaryButton = "btn btn-secondary";
const fieldClass = "field-control";

async function api(path, options) {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(options?.headers || {}) },
  });
  const responseText = await response.text();
  let data = null;
  try {
    data = responseText ? JSON.parse(responseText) : {};
  } catch {
    const error = new Error("The app was temporarily updating. Please refresh the page and try again.");
    error.status = response.status;
    throw error;
  }
  if (!response.ok) {
    const error = new Error(data.message || "Something went wrong");
    error.status = response.status;
    throw error;
  }
  return data;
}

function withRequestTemplate(request) {
  return {
    ...request,
    template: {
      templateId: request.templateId,
      templateName: request.templateName,
      questions: request.questions || [],
    },
  };
}

export default function Home() {
  const router = useRouter();
  const [currentUserId, setCurrentUserId] = useState(null);
  const [users, setUsers] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [requests, setRequests] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [reports, setReports] = useState([]);
  const [analytics, setAnalytics] = useState(null);
  const [selectedRequest, setSelectedRequest] = useState(null);
  const [declineRequest, setDeclineRequest] = useState(null);
  const [dueDateRequest, setDueDateRequest] = useState(null);
  const [followUpRequest, setFollowUpRequest] = useState(null);
  const [replacementRequest, setReplacementRequest] = useState(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [activePage, setActivePage] = useState("dashboard");
  const [requestSearch, setRequestSearch] = useState("");
  const [requestStatus, setRequestStatus] = useState("all");
  const [error, setError] = useState("");
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const latestRequestLoad = useRef(0);

  const currentUser = users.find((user) => user.id === currentUserId);
  const currentUserRole = String(currentUser?.role || "").toLowerCase();
  const isSafetyReviewer = currentUserRole === "sc";
  const canViewAnalytics = currentUserRole === "admin";
  const canManagePeople = currentUserRole === "admin";
  const selectedRequestId = selectedRequest?.id;
  const pendingForMe = requests.filter(
    (request) => request.giverId === currentUserId && ["requested", "in_progress", "overdue"].includes(request.status),
  );
  const sentByMe = requests.filter((request) => request.requesterId === currentUserId);
  const receivedFeedback = requests.filter((request) => request.receiverId === currentUserId && request.status === "submitted");
  // Requests returned here already belong to the current user or were shared with them.
  const tableRows = requests.map(toTableRow);
  const historyRows = tableRows.filter((request) => ["closed", "cancelled", "declined"].includes(request.status));
  const activeRequestRows = tableRows.filter((request) => !["closed", "cancelled", "declined"].includes(request.status));
  const rowsForActivePage = activePage === "history" ? historyRows : activeRequestRows;
  const visibleRows = rowsForActivePage.filter((request) => {
    const searchableText = [request.requesterName, request.giverName, request.type, request.purpose, request.status].join(" ").toLowerCase();
    return searchableText.includes(requestSearch.trim().toLowerCase()) && (requestStatus === "all" || request.status === requestStatus);
  });
  const statusOptions = activePage === "history"
    ? [["closed", "Done"], ["cancelled", "Cancelled"], ["declined", "Declined"]]
    : [["requested", "Requested"], ["in_progress", "In progress"], ["overdue", "Overdue"], ["submitted", "Submitted"], ["acknowledged", "Acknowledged"]];
  const upcomingRequests = tableRows.filter((request) => ["requested", "in_progress", "overdue"].includes(request.status) && request.dueDate !== "Not selected").slice(0, 3);

  useEffect(() => {
    async function loadReferenceData() {
      try {
        const [authData, userData, templateData] = await Promise.all([api("/auth/me"), api("/users"), api("/templates")]);
        setUsers(userData.users);
        setTemplates(templateData.templates);
        setCurrentUserId(authData.user.id);
      } catch (loadError) {
        if (loadError.status === 401) {
          router.replace("/login");
          return;
        }
        setError(loadError.message);
      } finally {
        setIsAuthLoading(false);
      }
    }
    void loadReferenceData();

    // New registrations should appear for other logged-in users without a manual refresh.
    const refreshUsers = window.setInterval(() => void loadReferenceData(), 3_000);
    return () => window.clearInterval(refreshUsers);
  }, [router]);

  const loadRequests = useCallback(async (userId) => {
    if (!userId) return;
    const loadId = latestRequestLoad.current + 1;
    latestRequestLoad.current = loadId;

    try {
      const [received, receivedFeedback, sent, shared, notificationData] = await Promise.all([
        api(`/feedback-requests/giver/${userId}`),
        api(`/feedback-requests/receiver/${userId}`),
        api(`/feedback-requests/requester/${userId}`),
        api(`/feedback-requests/visible/${userId}`),
        api("/notifications"),
      ]);

      // When the selected user changes quickly, ignore an older response.
      if (loadId !== latestRequestLoad.current) return;

      const merged = new Map(
        [...received.feedbackRequests, ...receivedFeedback.feedbackRequests, ...sent.feedbackRequests, ...shared.feedbackRequests]
          .map((request) => [request.id, request]),
      );
      const newestFirst = [...merged.values()].sort((first, second) => {
        const dateDifference = new Date(second.createdAt) - new Date(first.createdAt);
        return dateDifference || second.id - first.id;
      });
      setRequests(newestFirst);
      setNotifications(notificationData.notifications);
      setError("");
    } catch (loadError) {
      if (loadId !== latestRequestLoad.current) return;
      setError(loadError.message);
    }
  }, []);

  useEffect(() => {
    if (!currentUserId) return undefined;

    const refreshSelectedRequest = async () => {
      if (!selectedRequestId) return;
      try {
        const detail = await api(`/feedback-requests/${selectedRequestId}`);
        setSelectedRequest(withRequestTemplate(detail.feedbackRequest));
      } catch (detailError) {
        if (detailError.status !== 401) setError(detailError.message);
      }
    };
    const refreshRequests = () => {
      void loadRequests(currentUserId);
      void refreshSelectedRequest();
    };
    refreshRequests();
    const intervalId = window.setInterval(refreshRequests, 3_000);
    window.addEventListener("focus", refreshRequests);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", refreshRequests);
    };
  }, [currentUserId, loadRequests, selectedRequestId]);

  async function createRequest(payload) {
    try {
      await api("/feedback-requests", { method: "POST", body: JSON.stringify(payload) });
      // Close immediately after the server confirms creation. Refreshing the
      // dashboard must not keep the request form open after a successful send.
      setIsCreateOpen(false);
      setReplacementRequest(null);
      void loadRequests(currentUserId);
      return { ok: true };
    } catch (createError) {
      return { ok: false, message: createError.message };
    }
  }

  async function markNotificationRead(notificationId) {
    try {
      await api(`/notifications/${notificationId}/read`, { method: "PATCH" });
      setNotifications((items) => items.map((item) => item.id === notificationId ? { ...item, isRead: true } : item));
    } catch (notificationError) { setError(notificationError.message); }
  }

  async function markAllNotificationsRead() {
    try {
      await api("/notifications/read-all", { method: "PATCH" });
      setNotifications((items) => items.map((item) => ({ ...item, isRead: true })));
    } catch (notificationError) { setError(notificationError.message); }
  }

  async function createTemplate(payload) {
    try {
      const data = await api("/templates", { method: "POST", body: JSON.stringify(payload) });
      setTemplates((currentTemplates) => [...currentTemplates, data.template]);
      return { ok: true, template: data.template };
    } catch (templateError) {
      return { ok: false, message: templateError.message };
    }
  }

  async function updateTemplate(templateId, payload) {
    try {
      const data = await api(`/templates/${templateId}`, { method: "PATCH", body: JSON.stringify(payload) });
      setTemplates((items) => items.map((template) => template.id === templateId ? data.template : template));
      return { ok: true, template: data.template };
    } catch (templateError) {
      return { ok: false, message: templateError.message };
    }
  }

  async function setTemplateStatus(templateId, isActive) {
    try {
      await api(`/templates/${templateId}/status`, { method: "PATCH", body: JSON.stringify({ isActive }) });
      setTemplates((items) => items.filter((template) => template.id !== templateId));
      return { ok: true };
    } catch (templateError) {
      return { ok: false, message: templateError.message };
    }
  }
  async function updateUserRole(user, role) {
    try {
      const data = await api(`/users/${user.id}/role`, { method: "PATCH", body: JSON.stringify({ role }) });
      setUsers((items) => items.map((item) => item.id === user.id ? { ...item, ...data.user } : item));
    } catch (roleError) { setError(roleError.message); }
  }
  async function openRequest(requestId) {
    try {
      const detail = await api(`/feedback-requests/${requestId}?recordView=true`);
      setSelectedRequest(withRequestTemplate(detail.feedbackRequest));
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  async function submitAnswers(requestId, answers) {
    await api(`/feedback-requests/${requestId}/answers`, { method: "POST", body: JSON.stringify({ answers }) });
    setSelectedRequest(null);
    await loadRequests(currentUserId);
  }

  async function saveDraft(requestId, answers) {
    await api(`/feedback-requests/${requestId}/draft`, { method: "PUT", body: JSON.stringify({ answers }) });
    await openRequest(requestId);
  }

  async function addAttachment(requestId, attachment) {
    await api(`/feedback-requests/${requestId}/attachments`, { method: "POST", body: JSON.stringify(attachment) });
    await openRequest(requestId);
  }

  async function performRequestAction(requestId, action, acknowledgementComment, declineReason, alternateGiverId, moderationReason) {
    try {
      await api(`/feedback-requests/${requestId}/actions`, {
        method: "POST",
        body: JSON.stringify({ action, acknowledgementComment, declineReason, alternateGiverId, moderationReason }),
      });
      await loadRequests(currentUserId);
      setError("");
      return true;
    } catch (actionError) {
      setError(actionError.message);
      return false;
    }
  }

  async function updateDueDate(requestId, dueDate) {
    try {
      await api(`/feedback-requests/${requestId}/due-date`, {
        method: "PATCH",
        body: JSON.stringify({ dueDate }),
      });
      await loadRequests(currentUserId);
      setError("");
      return true;
    } catch (updateError) {
      setError(updateError.message);
      return false;
    }
  }

  async function createFollowUp(requestId, payload) {
    try {
      await api(`/feedback-requests/${requestId}/follow-ups`, { method: "POST", body: JSON.stringify(payload) });
      await openRequest(requestId);
      await loadRequests(currentUserId);
      setError("");
      return true;
    } catch (followUpError) {
      setError(followUpError.message);
      return false;
    }
  }

  async function createDiscussion(requestId, payload) {
    try {
      await api(`/feedback-requests/${requestId}/discussions`, { method: "POST", body: JSON.stringify(payload) });
      await openRequest(requestId);
      await loadRequests(currentUserId);
      setError("");
      return true;
    } catch (discussionError) {
      setError(discussionError.message);
      return false;
    }
  }

  async function reportFeedback(requestId, payload) {
    try {
      await api(`/feedback-requests/${requestId}/reports`, { method: "POST", body: JSON.stringify(payload) });
      setError("");
      return { ok: true };
    } catch (reportError) {
      setError(reportError.message);
      return { ok: false, message: reportError.message };
    }
  }

  async function loadReports() {
    try {
      const reportData = await api("/feedback-reports");
      setReports(reportData.reports);
      setError("");
    } catch (reportError) { setError(reportError.message); }
  }

  async function loadAnalytics() {
    try {
      const analyticsData = await api("/feedback-analytics");
      setAnalytics(analyticsData.analytics);
      setError("");
    } catch (analyticsError) { setError(analyticsError.message); }
  }

  async function reviewReport(reportId, status) {
    try {
      await api(`/feedback-reports/${reportId}`, { method: "PATCH", body: JSON.stringify({ status }) });
      await loadReports();
    } catch (reportError) { setError(reportError.message); }
  }

  async function updateUserStatus(user, isActive) {
    const action = isActive ? "reactivate" : "deactivate";
    if (!window.confirm(`Do you want to ${action} ${user.name}'s account? Open requests involving this person will be updated when deactivated.`)) return;
    try {
      const result = await api(`/users/${user.id}/status`, { method: "PATCH", body: JSON.stringify({ isActive }) });
      setUsers((current) => current.map((item) => item.id === user.id ? { ...item, isActive: result.user.isActive } : item));
      setError("");
      window.alert(result.message);
      await loadRequests(currentUserId);
    } catch (userError) { setError(userError.message); }
  }

  async function updateFollowUp(requestId, followUpId, payload) {
    try {
      await api(`/feedback-requests/${requestId}/follow-ups/${followUpId}`, { method: "PATCH", body: JSON.stringify(payload) });
      await openRequest(requestId);
      await loadRequests(currentUserId);
      setError("");
      return true;
    } catch (followUpError) {
      setError(followUpError.message);
      return false;
    }
  }

  function handleRequestAction(request, action) {
    if (action === "decline") {
      setDeclineRequest(request);
      return;
    }

    void performRequestAction(request.id, action);
  }

  async function handleLogout() {
    setIsLoggingOut(true);
    setError("");

    try {
      await api("/auth/logout", { method: "POST" });
      router.replace("/login?loggedOut=1");
    } catch (logoutError) {
      setError(logoutError.message || "Could not log out. Please try again.");
      setIsLoggingOut(false);
    }
  }

  if (isAuthLoading) {
    return <main className="flex min-h-screen items-center justify-center text-lg text-muted">Loading Feedback…</main>;
  }

  if (!currentUser) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="text-xl font-semibold text-slate-900">Feedback could not load</p>
        <p className="text-base text-muted">{error || "Please sign in to continue."}</p>
        <button className={primaryButton} onClick={() => router.push("/login")}>Go to login</button>
      </main>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-br from-[#f6f8ff] via-[#fbfcfe] to-[#eef7ff] text-ink">
      <AppHeader currentUser={currentUser} onLogout={handleLogout} isLoggingOut={isLoggingOut} notifications={notifications} onNotificationRead={markNotificationRead} onReadAll={markAllNotificationsRead} onOpenRequest={(requestId) => void openRequest(requestId)} />

      <MobileNavigation activePage={activePage} showSCReview={isSafetyReviewer} showAnalytics={canViewAnalytics} showPeople={canManagePeople} onSelect={(page) => { setActivePage(page); setRequestSearch(""); setRequestStatus("all"); if (page === "reports") void loadReports(); if (page === "analytics") void loadAnalytics(); }} />

      <div className="grid min-w-0 flex-1 xl:grid-cols-[260px_minmax(0,1fr)]">
        <Sidebar activePage={activePage} showSCReview={isSafetyReviewer} showAnalytics={canViewAnalytics} showPeople={canManagePeople} onSelect={(page) => { setActivePage(page); setRequestSearch(""); setRequestStatus("all"); if (page === "reports") void loadReports(); if (page === "analytics") void loadAnalytics(); }} />

        <main className="min-w-0 border-x border-line/70 bg-white/55 px-5 py-7 backdrop-blur-sm sm:px-7 sm:py-8 lg:px-9 xl:px-10">
          <div className="mb-7 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-blue-100 bg-blue-50 px-3 py-1 text-sm font-semibold text-blue-700">
                <Sparkles size={15} />
                Feedback workspace
              </div>
              <h1 className="text-4xl font-extrabold tracking-tight text-slate-950 sm:text-5xl">{activePage === "dashboard" ? "Feedback" : activePage === "history" ? "Feedback History" : activePage === "reports" ? "SC Team Review" : activePage === "people" ? "People" : activePage === "analytics" ? "Team analytics" : "Feedback Requests"}</h1>
              <p className="mt-2 text-base text-muted">{activePage === "dashboard" ? "Request, share, and review thoughtful feedback in one place." : activePage === "history" ? "Review completed feedback and past request decisions." : activePage === "reports" ? "Private reports that need SC Team review." : activePage === "people" ? "Manage account access and keep open feedback requests accurate." : activePage === "analytics" ? "Anonymous totals to help the team improve its feedback process." : "Review, manage, and respond to every feedback request."}</p>
            </div>
          </div>

          {activePage === "dashboard" ? <>
          <section className="grid gap-5 xl:grid-cols-3">
            <StatCard
              icon={<Inbox size={28} />}
              tone="blue"
              label="Waiting For Me"
              value={pendingForMe.length}
              helper="Requests where I need to give feedback"
            />
            <StatCard
              icon={<Send size={28} />}
              tone="green"
              label="Requests Sent"
              value={sentByMe.length}
              helper="Feedback requests created by me"
            />
            <StatCard
              icon={<Check size={28} />}
              tone="amber"
              label="Received feedback"
              value={receivedFeedback.length}
              helper="Feedback responses ready to review"
            />
          </section>

          <section className="mt-7 grid gap-5 xl:grid-cols-3">
            <article className="rounded-2xl border border-line/80 bg-white p-6 shadow-[0_12px_36px_rgba(15,23,42,0.07)]"><p className="text-sm font-bold uppercase tracking-wide text-blue-600">Quick actions</p><h2 className="mt-1 text-xl font-bold text-slate-950">What would you like to do?</h2><p className="mt-2 text-sm text-muted">Start a new request or check feedback waiting for you.</p><div className="mt-5 flex flex-wrap gap-3"><button className={primaryButton} type="button" onClick={() => { setError(""); setReplacementRequest(null); setIsCreateOpen(true); }}><Plus size={17} /> Request feedback</button><button className={secondaryButton} type="button" onClick={() => setActivePage("requests")}>View requests ({pendingForMe.length})</button></div></article>
            <article className="rounded-2xl border border-line/80 bg-white p-6 shadow-[0_12px_36px_rgba(15,23,42,0.07)]"><p className="text-sm font-bold uppercase tracking-wide text-amber-600">Upcoming due dates</p><h2 className="mt-1 text-xl font-bold text-slate-950">Keep on track</h2><div className="mt-4 grid gap-2">{upcomingRequests.length ? upcomingRequests.map((request) => <div key={request.id} className="flex justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm"><span className="font-semibold">{request.type}</span><span className="font-bold text-amber-700">{request.dueDate}</span></div>) : <p className="text-sm text-muted">No upcoming due dates.</p>}</div></article>
            <article className="rounded-2xl border border-line/80 bg-white p-6 shadow-[0_12px_36px_rgba(15,23,42,0.07)]"><p className="text-sm font-bold uppercase tracking-wide text-violet-600">Recent activity</p><h2 className="mt-1 text-xl font-bold text-slate-950">Latest updates</h2><div className="mt-4 grid gap-2">{tableRows.slice(0, 3).map((request) => <button key={request.id} type="button" onClick={() => void openRequest(request.id)} className="rounded-lg bg-slate-50 px-3 py-2 text-left text-sm transition hover:bg-violet-50"><p className="font-semibold text-slate-800">{request.type}</p><p className="mt-1 text-muted">{request.status} · {request.giverName}</p></button>)}</div></article>
          </section>
          </> : null}

          {activePage === "reports" && isSafetyReviewer ? <SCReportReview reports={reports} onReview={(reportId, status) => void reviewReport(reportId, status)} onOpenRequest={(requestId) => void openRequest(requestId)} /> : null}
          {activePage === "people" && canManagePeople ? <PeopleManagement users={users} currentUserId={currentUserId} onUpdateStatus={(user, isActive) => void updateUserStatus(user, isActive)} onUpdateRole={(user, role) => void updateUserRole(user, role)} /> : null}
          {activePage === "analytics" && canViewAnalytics ? <AnalyticsDashboard analytics={analytics} /> : null}

          {["requests", "history"].includes(activePage) ? <section className="mt-7 overflow-hidden rounded-2xl border border-line/80 bg-white shadow-[0_12px_36px_rgba(15,23,42,0.07)]">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-6 py-5">
              <div className="flex flex-1 flex-wrap items-center gap-3">
                <input className="field-control max-w-xs" type="search" value={requestSearch} placeholder="Search people, type, or purpose" onChange={(event) => setRequestSearch(event.target.value)} />
                <select className="field-control w-auto min-w-40" value={requestStatus} onChange={(event) => setRequestStatus(event.target.value)}>
                  <option value="all">All statuses</option>
                  {statusOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
                {requestSearch || requestStatus !== "all" ? <button className="text-sm font-semibold text-blue-700 hover:text-blue-900" type="button" onClick={() => { setRequestSearch(""); setRequestStatus("all"); }}>Clear filters</button> : null}
              </div>
              <div className="flex items-center gap-3">
                <span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold text-slate-600">{activePage === "history" ? `${visibleRows.length} history records` : `${visibleRows.length} total requests`}</span>
              </div>
            </div>
            <div className="grid gap-3 p-4 xl:hidden">
              {visibleRows.length ? visibleRows.map((row) => (
                <article key={row.id} className="rounded-xl border border-line bg-slate-50 p-4 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-bold text-slate-900">{row.type}</p>
                      <p className="mt-1 text-sm text-muted">Requested by {row.requesterName}</p>
                    </div>
                    <span className={`${statusClass(row.status)} shrink-0`}>{row.status === "closed" ? "Done" : row.status}</span>
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-x-3 gap-y-3 text-sm">
                    <div><p className="text-xs font-bold uppercase tracking-wide text-muted">Feedback giver</p><p className="mt-1 font-semibold text-slate-800">{row.giverName}</p></div>
                    <div><p className="text-xs font-bold uppercase tracking-wide text-muted">Due date</p><p className="mt-1 font-semibold text-slate-800">{row.dueDate}</p></div>
                    <div className="col-span-2"><p className="text-xs font-bold uppercase tracking-wide text-muted">Purpose</p><p className="mt-1 text-slate-700">{row.purpose || "Not selected"}</p></div>
                  </div>
                  {row.status === "submitted" && row.giverId === currentUserId ? <p className="mt-3 text-xs font-medium text-slate-500">Waiting for {row.requesterName} to acknowledge.</p> : null}
                  {row.status === "declined" && row.requesterId === currentUserId ? <p className="mt-3 text-xs font-medium text-red-700">{row.giverName} declined this request{row.declineReason ? `: ${row.declineReason}` : ""}</p> : null}
                  <div className="mt-4 flex flex-wrap gap-2">
                    {activePage === "history" ? <><button className="rounded-lg border border-blue-200 px-3 py-2 text-sm font-semibold text-blue-700" type="button" onClick={() => void openRequest(row.id)}>View</button>{row.status === "declined" && row.requesterId === currentUserId && row.alternateGiverId ? <button className="rounded-lg border border-violet-200 px-3 py-2 text-sm font-semibold text-violet-700" type="button" onClick={() => { setReplacementRequest(row); setIsCreateOpen(true); }}>Use suggested reviewer</button> : null}</> : <RequestActions row={row} currentUserId={currentUserId} onView={() => void openRequest(row.id)} onAction={(action) => handleRequestAction(row, action)} onEditDueDate={() => setDueDateRequest(row)} />}
                  </div>
                </article>
              )) : <p className="rounded-xl bg-slate-50 px-4 py-10 text-center text-sm text-muted">{requestSearch || requestStatus !== "all" ? "No requests match these filters." : activePage === "history" ? "No feedback history yet." : "No feedback requests yet. Create a request from the right panel."}</p>}
            </div>
            <div className="hidden overflow-x-auto xl:block">
              <table className="w-full min-w-[820px] text-left">
                <thead className="bg-[#f8fafc] text-xs font-bold uppercase tracking-wide text-muted">
                  <tr>
                    <th className="px-6 py-4">Requester</th>
                    <th className="px-4 py-4">Feedback Giver</th>
                    <th className="px-4 py-4">Type</th>
                    <th className="px-4 py-4">Purpose</th>
                    <th className="px-4 py-4">Due Date</th>
                    <th className="px-4 py-4">Status</th>
                    <th className="px-4 py-4">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {visibleRows.length ? visibleRows.map((row) => (
                    <tr key={row.id} className="transition-colors hover:bg-[#f5f8ff]">
                      <td className="px-6 py-5">
                        <div className="flex items-center gap-4">
                          <Avatar initials={row.requesterInitials} />
                          <div>
                            <p className="text-base font-semibold text-[#111827]">{row.requesterName}</p>
                            <p className="mt-1 text-sm text-muted">{row.requesterEmail}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-5">
                        <div className="flex items-center gap-3">
                          <Avatar initials={row.giverInitials} small />
                          <span className="font-semibold">{row.giverName}</span>
                        </div>
                      </td>
                      <td className="px-4 py-5 text-base font-medium">{row.type}</td>
                      <td className="px-4 py-5 text-base text-slate-700">{row.purpose}</td>
                      <td className="px-4 py-5">
                        <p className="font-semibold">{row.dueDate}</p>
                      </td>
                      <td className="px-4 py-5">
                        <span className={statusClass(row.status)}>{row.status === "closed" ? "Done" : row.status}</span>
                        {row.status === "submitted" && row.giverId === currentUserId ? (
                          <p className="mt-1 text-xs font-medium text-slate-500">
                            Waiting for {row.requesterName} to acknowledge
                          </p>
                        ) : null}
                        {row.status === "declined" && row.requesterId === currentUserId ? (
                          <div className="mt-1 text-xs font-medium text-red-700">
                            <p>{row.giverName} declined this feedback request</p>
                            {row.declineReason ? <p className="mt-1 font-normal">Reason: {row.declineReason}</p> : null}
                          </div>
                        ) : null}
                        {row.status === "acknowledged" && row.giverId === currentUserId ? (
                          <p className="mt-1 text-xs font-medium text-violet-700">
                            {row.requesterName} acknowledged this feedback
                          </p>
                        ) : null}
                      </td>
                      <td className="px-4 py-5">
                        {activePage === "history" ? <div className="flex flex-wrap gap-2"><button className="rounded-lg border border-blue-200 px-3 py-2 text-sm font-semibold text-blue-700 transition hover:bg-blue-50" type="button" onClick={() => void openRequest(row.id)}>View</button>{row.status === "declined" && row.requesterId === currentUserId && row.alternateGiverId ? <button className="rounded-lg border border-violet-200 px-3 py-2 text-sm font-semibold text-violet-700 transition hover:bg-violet-50" type="button" onClick={() => { setReplacementRequest(row); setIsCreateOpen(true); }}>Use suggested reviewer</button> : null}</div> : <RequestActions row={row} currentUserId={currentUserId} onView={() => void openRequest(row.id)} onAction={(action) => handleRequestAction(row, action)} onEditDueDate={() => setDueDateRequest(row)} />}
                      </td>
                    </tr>
                  )) : (
                    <tr>
                      <td className="px-6 py-12 text-center text-base text-muted" colSpan={7}>
                        {requestSearch || requestStatus !== "all" ? "No requests match these filters." : activePage === "history" ? "No feedback history yet." : "No feedback requests yet. Create a request from the right panel."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between border-t border-line px-6 py-4 text-base text-muted">
              <span>Showing 1 to {visibleRows.length} of {rowsForActivePage.length} {activePage === "history" ? "history records" : "requests"}</span>
            </div>
          </section> : null}
          {error ? (
            <p className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
              {error}
            </p>
          ) : null}
        </main>

        {isCreateOpen ? (
          <CreateFeedbackPanel
            currentUserId={currentUserId}
            currentUser={currentUser}
            users={users}
            templates={templates}
            requests={requests}
            replacementRequest={replacementRequest}
            onCreate={createRequest}
            onCreateTemplate={createTemplate}
            onUpdateTemplate={updateTemplate}
            onSetTemplateStatus={setTemplateStatus}
            onClose={() => { setIsCreateOpen(false); setReplacementRequest(null); }}
          />
        ) : null}
      </div>

      <AppFooter />

      {selectedRequest ? (
        <FeedbackDetail
          request={selectedRequest}
          currentUserId={currentUserId}
          currentUserRole={currentUser.role}
          onClose={() => setSelectedRequest(null)}
          onSubmit={submitAnswers}
          onSaveDraft={saveDraft}
          onAddAttachment={addAttachment}
          onAcknowledge={(requestId, acknowledgementComment) => performRequestAction(requestId, "acknowledge", acknowledgementComment)}
          onCreateFollowUp={() => setFollowUpRequest(selectedRequest)}
          onUpdateFollowUp={updateFollowUp}
          onDiscussion={createDiscussion}
          onReport={reportFeedback}
          onModerate={(requestId, action, reason) => performRequestAction(requestId, action, undefined, undefined, undefined, reason)}
        />
      ) : null}

      {declineRequest ? (
        <DeclineFeedbackModal
          request={declineRequest}
          users={users}
          currentUserId={currentUserId}
          onClose={() => setDeclineRequest(null)}
          onSubmit={async (reason, alternateGiverId) => {
            const wasDeclined = await performRequestAction(
              declineRequest.id,
              "decline",
              undefined,
              reason,
              alternateGiverId,
            );
            if (wasDeclined) setDeclineRequest(null);
            return wasDeclined;
          }}
        />
      ) : null}

      {dueDateRequest ? (
        <DueDateModal
          request={dueDateRequest}
          onClose={() => setDueDateRequest(null)}
          onSubmit={async (dueDate) => {
            const wasUpdated = await updateDueDate(dueDateRequest.id, dueDate);
            if (wasUpdated) setDueDateRequest(null);
            return wasUpdated;
          }}
        />
      ) : null}

      {followUpRequest ? (
        <FollowUpModal
          request={followUpRequest}
          onClose={() => setFollowUpRequest(null)}
          onSubmit={async (payload) => {
            const wasCreated = await createFollowUp(followUpRequest.id, payload);
            if (wasCreated) setFollowUpRequest(null);
            return wasCreated;
          }}
        />
      ) : null}
    </div>
  );
}

function AppHeader({ currentUser, onLogout, isLoggingOut, notifications, onNotificationRead, onReadAll, onOpenRequest }) {
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const unreadCount = notifications.filter((notification) => !notification.isRead).length;
  return (
    <header className="sticky top-0 z-20 border-b border-white/15 bg-[#252d70] px-5 py-3 shadow-lg shadow-indigo-950/15 sm:px-7">
      <div className="mx-auto flex max-w-[1800px] items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full bg-white shadow-lg shadow-blue-950/30 sm:h-14 sm:w-14">
            <img src="/justuju-logo.png" alt="Justuju" className="h-full w-full object-cover" />
          </div>
          <div>
            <p className="text-lg font-bold tracking-tight text-white">Feedback</p>
            <p className="text-xs font-medium text-blue-200">Feedback Process</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="relative">
            <button className="relative inline-flex h-11 w-11 items-center justify-center rounded-lg border border-white/25 text-white transition hover:bg-white/10" type="button" aria-label="Notifications" onClick={() => setIsNotificationsOpen((open) => !open)}><Bell size={19} />{unreadCount ? <span className="absolute -right-2 -top-2 min-w-5 rounded-full bg-red-500 px-1 text-xs font-bold leading-5 text-white">{unreadCount > 9 ? "9+" : unreadCount}</span> : null}</button>
            {isNotificationsOpen ? <div className="absolute right-0 z-30 mt-3 w-[min(360px,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-slate-200 bg-white text-slate-900 shadow-2xl"><div className="flex items-center justify-between border-b border-slate-100 px-4 py-3"><p className="font-bold">Notifications</p>{unreadCount ? <button className="text-sm font-semibold text-blue-700" type="button" onClick={() => void onReadAll()}>Mark all read</button> : null}</div><div className="max-h-96 overflow-y-auto">{notifications.length ? notifications.map((notification) => <button className={`block w-full border-b border-slate-100 px-4 py-3 text-left transition hover:bg-slate-50 ${notification.isRead ? "bg-white" : "bg-blue-50/70"}`} type="button" key={notification.id} onClick={() => { void onNotificationRead(notification.id); if (notification.requestId) { onOpenRequest(notification.requestId); setIsNotificationsOpen(false); } }}><p className="text-sm font-bold">{notification.title}</p><p className="mt-1 text-sm text-slate-600">{notification.message}</p><p className="mt-1 text-xs text-slate-400">{formatHistoryTime(notification.createdAt)}</p></button>) : <p className="px-4 py-8 text-center text-sm text-slate-500">No notifications yet.</p>}</div></div> : null}
          </div>
          <div className="hidden items-center gap-2 rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-sm text-white shadow-sm sm:flex">
            <Avatar initials={initialsForName(currentUser.name)} small />
            <span className="text-blue-100">Logged in as</span>
            <span className="font-semibold">{currentUser.name}</span>
          </div>
          <button
            className="inline-flex items-center gap-2 rounded-lg border border-white/25 px-3 py-2 font-semibold text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
            type="button"
            onClick={onLogout}
            disabled={isLoggingOut}
          >
            <LogOut size={16} />
            {isLoggingOut ? "Logging out…" : "Log out"}
          </button>
        </div>
      </div>
    </header>
  );
}

function MobileNavigation({ activePage, showSCReview, showAnalytics, showPeople, onSelect }) {
  const items = [
    { page: "dashboard", label: "Dashboard", icon: <HomeIcon size={17} /> },
    { page: "requests", label: "Requests", icon: <Inbox size={17} /> },
    { page: "history", label: "History", icon: <HistoryIcon size={17} /> },
    ...(showSCReview ? [{ page: "reports", label: "SC Review", icon: <Inbox size={17} /> }] : []),
    ...(showAnalytics ? [{ page: "analytics", label: "Analytics", icon: <BarChart3 size={17} /> }] : []),
    ...(showPeople ? [{ page: "people", label: "People", icon: <UsersRound size={17} /> }] : []),
  ];

  return (
    <nav className="border-b border-slate-200 bg-white/95 px-4 py-2 shadow-sm xl:hidden" aria-label="Main navigation">
      <div className="flex gap-2 overflow-x-auto pb-0.5">
        {items.map((item) => (
          <button
            className={`inline-flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition ${activePage === item.page ? "bg-[#252d70] text-white shadow-sm" : "text-slate-600 hover:bg-slate-100"}`}
            key={item.page}
            type="button"
            onClick={() => onSelect(item.page)}
          >
            {item.icon}{item.label}
          </button>
        ))}
      </div>
    </nav>
  );
}

function AppFooter() {
  return (
    <footer className="border-t border-slate-800 bg-slate-950 px-5 py-5 text-sm text-slate-400 sm:px-7">
      <div className="mx-auto flex max-w-[1800px] flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <p>© 2026 Feedback. Built for clear, thoughtful feedback.</p>
        <p className="font-medium text-slate-300">Feedback Process</p>
      </div>
    </footer>
  );
}

function Sidebar({ activePage, showSCReview, showAnalytics, showPeople, onSelect }) {
  return (
    <aside className="hidden border-r border-indigo-400/25 bg-[#252d70] px-4 py-8 text-slate-200 xl:flex xl:flex-col">
      <p className="mb-3 px-3 text-xs font-bold uppercase tracking-[0.14em] text-indigo-200/70">Workspace</p>
      <nav className="space-y-2 text-base font-medium">
        <SidebarItem active={activePage === "dashboard"} icon={<HomeIcon size={22} />} label="Dashboard" onClick={() => onSelect("dashboard")} />
        <SidebarItem active={activePage === "requests"} icon={<Inbox size={22} />} label="Feedback Requests" onClick={() => onSelect("requests")} />
        <SidebarItem active={activePage === "history"} icon={<HistoryIcon size={22} />} label="Feedback History" onClick={() => onSelect("history")} />
        {showSCReview ? <SidebarItem active={activePage === "reports"} icon={<Inbox size={22} />} label="SC Team Review" onClick={() => onSelect("reports")} /> : null}
        {showAnalytics ? <SidebarItem active={activePage === "analytics"} icon={<BarChart3 size={22} />} label="Team analytics" onClick={() => onSelect("analytics")} /> : null}
        {showPeople ? <SidebarItem active={activePage === "people"} icon={<UsersRound size={22} />} label="People" onClick={() => onSelect("people")} /> : null}
      </nav>
    </aside>
  );
}

function PeopleManagement({ users, currentUserId, onUpdateStatus, onUpdateRole }) {
  return (
    <section className="mt-7 overflow-hidden rounded-2xl border border-line/80 bg-white shadow-[0_12px_36px_rgba(15,23,42,0.07)]">
      <div className="border-b border-line px-6 py-5"><p className="font-bold text-slate-950">Account access</p><p className="mt-1 text-sm text-muted">Deactivating an account signs the person out and updates open feedback requests. Completed history remains saved.</p></div>
      <div className="divide-y divide-line">
        {users.map((user) => <article className="flex flex-wrap items-center justify-between gap-4 px-6 py-4" key={user.id}>
          <div><p className="font-semibold text-slate-900">{user.name}</p><p className="mt-1 text-sm text-muted">{user.email} · {user.role || "member"}</p></div>
          <div className="flex flex-wrap items-center gap-3"><select className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700" value={user.role || "member"} onChange={(event) => onUpdateRole(user, event.target.value)} aria-label={`Role for ${user.name}`}><option value="member">Member</option><option value="mentor">Mentor</option><option value="lead">Lead</option><option value="manager">Manager</option><option value="sc">SC Team</option><option value="hr">HR</option><option value="admin">Admin</option></select><span className={`rounded-full px-3 py-1 text-xs font-bold ${user.isActive ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>{user.isActive ? "Active" : "Deactivated"}</span>{user.id !== currentUserId ? <button className={user.isActive ? "rounded-lg border border-red-200 px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-50" : secondaryButton} type="button" onClick={() => onUpdateStatus(user, !user.isActive)}>{user.isActive ? "Deactivate" : "Reactivate"}</button> : null}</div>
        </article>)}
      </div>
    </section>
  );
}

function SCReportReview({ reports, onReview, onOpenRequest }) {
  const openReports = reports.filter((report) => report.status === "open");
  return (
    <section className="mt-7 overflow-hidden rounded-2xl border border-line/80 bg-white shadow-[0_12px_36px_rgba(15,23,42,0.07)]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-6 py-5">
        <div><p className="font-bold text-slate-950">Reported feedback</p><p className="mt-1 text-sm text-muted">Only SC Team reviewers can access this list.</p></div>
        <span className="rounded-full bg-red-50 px-3 py-1 text-sm font-semibold text-red-700">{openReports.length} open</span>
      </div>
      <div className="divide-y divide-line">
        {reports.length ? reports.map((report) => <article className="grid gap-4 px-6 py-5 sm:grid-cols-[1fr_auto]" key={report.id}>
          <div><div className="flex flex-wrap items-center gap-2"><p className="font-bold text-slate-900">Report #{report.id}</p><span className={`rounded-full px-2 py-1 text-xs font-bold ${report.status === "open" ? "bg-red-100 text-red-700" : "bg-slate-100 text-slate-600"}`}>{report.status}</span></div><p className="mt-2 text-sm text-slate-700"><span className="font-semibold">Reason:</span> {reportReasonLabel(report.reason)}</p>{report.details ? <p className="mt-2 whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-sm text-slate-700">{report.details}</p> : null}<p className="mt-3 text-xs text-muted">Reported by {report.reporterName} · {report.templateName} · {formatHistoryTime(report.createdAt)}</p></div>
          <div className="flex flex-wrap content-start gap-2"><button className={secondaryButton} type="button" onClick={() => onOpenRequest(report.requestId)}>View feedback</button>{report.status === "open" ? <><button className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700" type="button" onClick={() => onReview(report.id, "resolved")}>Resolve</button><button className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50" type="button" onClick={() => onReview(report.id, "dismissed")}>Dismiss</button></> : null}</div>
        </article>) : <p className="px-6 py-12 text-center text-base text-muted">No feedback reports yet.</p>}
      </div>
    </section>
  );
}

function AnalyticsDashboard({ analytics }) {
  if (!analytics) return <section className="mt-7 rounded-2xl border border-line/80 bg-white p-8 text-center text-muted shadow-[0_12px_36px_rgba(15,23,42,0.07)]">Loading team analytics…</section>;
  const summary = analytics.summary || {};
  const completionRate = Number(summary.totalRequests) ? Math.round((Number(summary.completedRequests) / Number(summary.totalRequests)) * 100) : 0;
  return <section className="mt-7 grid gap-5">
    <p className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-900">These are anonymous team totals only. Individual feedback answers and names are not shown here.</p>
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard icon={<Inbox size={24} />} tone="blue" label="Total requests" value={summary.totalRequests || 0} helper="Across the whole team" />
      <StatCard icon={<Check size={24} />} tone="green" label="Completed" value={summary.completedRequests || 0} helper={`${completionRate}% completion rate`} />
      <StatCard icon={<HistoryIcon size={24} />} tone="amber" label="Open" value={summary.openRequests || 0} helper="Still waiting for completion" />
      <StatCard icon={<BarChart3 size={24} />} tone="violet" label="Average response" value={summary.averageResponseHours == null ? "—" : `${Math.round(summary.averageResponseHours)}h`} helper="From request to submitted feedback" />
    </div>
    <div className="grid gap-5 lg:grid-cols-2">
      <article className="rounded-2xl border border-line/80 bg-white p-6 shadow-[0_12px_36px_rgba(15,23,42,0.07)]"><h2 className="text-lg font-bold text-slate-950">Requests by feedback type</h2><div className="mt-4 grid gap-3">{(analytics.byTemplate || []).length ? analytics.byTemplate.map((item) => <div className="flex items-center justify-between gap-4 rounded-xl bg-slate-50 px-4 py-3" key={item.templateName}><div><p className="font-semibold text-slate-900">{item.templateName}</p><p className="mt-1 text-sm text-muted">{item.completedRequests} completed</p></div><span className="rounded-full bg-blue-50 px-3 py-1 text-sm font-bold text-blue-700">{item.requestCount}</span></div>) : <p className="text-sm text-muted">No feedback requests yet.</p>}</div></article>
      <article className="rounded-2xl border border-line/80 bg-white p-6 shadow-[0_12px_36px_rgba(15,23,42,0.07)]"><h2 className="text-lg font-bold text-slate-950">Requests by status</h2><div className="mt-4 grid gap-3">{(analytics.byStatus || []).length ? analytics.byStatus.map((item) => <div className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3" key={item.status}><span className="font-semibold capitalize text-slate-900">{String(item.status).replaceAll("_", " ")}</span><span className="rounded-full bg-slate-200 px-3 py-1 text-sm font-bold text-slate-700">{item.requestCount}</span></div>) : <p className="text-sm text-muted">No feedback requests yet.</p>}</div></article>
    </div>
  </section>;
}

function reportReasonLabel(reason) {
  return { rude: "Rude or disrespectful", harassment: "Harassment or bullying", discrimination: "Discrimination", inappropriate: "Inappropriate content", other: "Other concern" }[reason] || reason;
}

function SidebarItem({ active = false, icon, label, onClick }) {
  return (
    <button
      className={`flex w-full items-center gap-4 rounded-xl px-4 py-3 transition ${
        active ? "bg-white/18 text-white shadow-lg shadow-indigo-950/20" : "text-indigo-100/75 hover:bg-white/10 hover:text-white"
      }`}
      type="button"
      onClick={onClick}
    >
      {icon}
      {label}
    </button>
  );
}

function StatCard({ icon, tone, label, value, helper }) {
  const toneClass = {
    blue: "bg-blue-50 text-blue-700",
    green: "bg-green-50 text-green-700",
    amber: "bg-orange-50 text-orange-700",
  }[tone];

  return (
    <article className="rounded-2xl border border-line/80 bg-white p-5 shadow-[0_10px_30px_rgba(15,23,42,0.06)] transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_16px_34px_rgba(15,23,42,0.09)] sm:p-6">
      <div className="flex items-center gap-4 sm:gap-5">
        <div className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl ${toneClass} sm:h-16 sm:w-16`}>
          {icon}
        </div>
        <div>
          <p className="text-base font-semibold text-slate-800 sm:text-lg">{label}</p>
          <p className={`mt-1 text-4xl font-extrabold tracking-tight sm:text-5xl ${tone === "amber" ? "text-orange-600" : tone === "green" ? "text-green-700" : "text-blue-700"}`}>
            {value}
          </p>
        </div>
      </div>
      <p className="mt-4 text-sm leading-6 text-muted sm:text-base">{helper}</p>
    </article>
  );
}

function RequestProgress({ step }) {
  const steps = ["Type", "Person", "Review & send"];
  return (
    <ol className="grid grid-cols-3 gap-2 rounded-2xl border border-blue-100 bg-blue-50/60 p-3" aria-label="Create feedback request progress">
      {steps.map((label, index) => {
        const stepNumber = index + 1;
        const isCurrent = stepNumber === step;
        const isComplete = stepNumber < step;
        return <li className="min-w-0" key={label}>
          <div className={`flex items-center gap-2 rounded-xl px-2 py-2 text-xs font-bold sm:text-sm ${isCurrent ? "bg-white text-blue-700 shadow-sm" : isComplete ? "text-emerald-700" : "text-slate-400"}`}>
            <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs ${isCurrent ? "bg-blue-600 text-white" : isComplete ? "bg-emerald-500 text-white" : "bg-slate-200 text-slate-500"}`}>{isComplete ? "✓" : stepNumber}</span>
            <span className="truncate">{label}</span>
          </div>
        </li>;
      })}
    </ol>
  );
}

function CreateFeedbackPanel({ currentUserId, currentUser, users, templates, requests, replacementRequest, onCreate, onCreateTemplate, onUpdateTemplate, onSetTemplateStatus, onClose }) {
  const possibleGivers = users.filter((user) => user.id !== currentUserId && user.isActive !== false);
  const possibleReceivers = users.filter((user) => user.isActive !== false);
  const [giverId, setGiverId] = useState("");
  const [receiverId, setReceiverId] = useState(String(currentUserId || ""));
  const [templateId, setTemplateId] = useState("");
  const [message, setMessage] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [purpose, setPurpose] = useState("growth");
  const [visibility, setVisibility] = useState("private");
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [viewerIds, setViewerIds] = useState([]);
  const [showMoreOptions, setShowMoreOptions] = useState(false);
  const [isCustomTemplateOpen, setIsCustomTemplateOpen] = useState(false);
  const [savedTemplateName, setSavedTemplateName] = useState("");
  const [customTemplateName, setCustomTemplateName] = useState("");
  const [customTemplateDescription, setCustomTemplateDescription] = useState("");
  const [customQuestions, setCustomQuestions] = useState(["", "", ""]);
  const [isSavingTemplate, setIsSavingTemplate] = useState(false);
  const [editingTemplateId, setEditingTemplateId] = useState(null);
  const [isManageTemplatesOpen, setIsManageTemplatesOpen] = useState(false);
  const [notice, setNotice] = useState(null);
  const [noticeTone, setNoticeTone] = useState("error");
  const [step, setStep] = useState(1);
  const [isSendingRequest, setIsSendingRequest] = useState(false);
  const today = new Date().toISOString().slice(0, 10);

  useEffect(() => {
    if (!possibleGivers.some((user) => user.id === Number(giverId))) {
      setGiverId(possibleGivers[0]?.id ?? "");
    }
  }, [currentUserId, giverId, possibleGivers]);

  useEffect(() => {
    if (!possibleReceivers.some((user) => user.id === Number(receiverId))) {
      setReceiverId(String(currentUserId || possibleReceivers[0]?.id || ""));
    }
  }, [currentUserId, possibleReceivers, receiverId]);

  const possibleViewers = users.filter(
    (user) => user.id !== currentUserId && user.id !== Number(giverId) && user.id !== Number(receiverId) && user.isActive !== false,
  );
  const mentorLeadViewers = possibleViewers.filter((user) => ["mentor", "lead", "manager"].includes(String(user.role || "").toLowerCase()));

  useEffect(() => {
    setViewerIds((currentIds) => currentIds.filter((id) => possibleViewers.some((user) => user.id === id)));
  }, [giverId, receiverId, currentUserId, users]);

  useEffect(() => {
    if (!templates.some((template) => template.id === Number(templateId))) {
      setTemplateId(templates[0]?.id ?? "");
    }
  }, [templateId, templates]);

  // A duplicate warning belongs to the previous selection. Remove it as soon
  // as the user changes the people, purpose, feedback type, or due date.
  useEffect(() => {
    setNotice(null);
  }, [giverId, receiverId, templateId, purpose, dueDate]);

  useEffect(() => {
    if (!replacementRequest) return;
    setGiverId(String(replacementRequest.alternateGiverId));
    setReceiverId(String(replacementRequest.receiverId));
    setTemplateId(String(replacementRequest.templateId));
    setPurpose(replacementRequest.rawPurpose || "growth");
    setDueDate("");
    setViewerIds([]);
    setVisibility("private");
    setIsAnonymous(false);
    setSavedTemplateName("");
    setMessage(`Replacement request after ${replacementRequest.giverName} declined.`);
    setNotice(null);
    setShowMoreOptions(false);
  }, [replacementRequest]);

  async function submit(event) {
    event.preventDefault();
    if (!giverId || Number(giverId) === currentUserId) return;
    if (dueDate && dueDate < today) {
      setNoticeTone("error");
      setNotice("Due date cannot be in the past.");
      return;
    }
    if (visibility === "mentor_lead" && viewerIds.length !== 1) {
      setNotice("Choose one mentor or lead who can view this feedback.");
      return;
    }
    if (visibility === "selected_group" && viewerIds.length === 0) {
      setNotice("Choose at least one group member who can view this feedback.");
      return;
    }
    const hasOpenDuplicate = requests.some((request) => (
      Number(request.requesterId) === Number(currentUserId)
      && Number(request.giverId) === Number(giverId)
      && Number(request.receiverId) === Number(receiverId)
      && String(request.purpose || "") === String(purpose || "")
      && ["requested", "in_progress", "overdue", "submitted", "acknowledged", "follow_up_needed"].includes(request.status)
    ));
    if (hasOpenDuplicate) {
      setNoticeTone("error");
      setNotice("An open request for this feedback purpose and these people already exists. Choose a different purpose, or complete/cancel the open request first. A different date or feedback type does not create a new request.");
      return;
    }
    setIsSendingRequest(true);
    const result = await onCreate({ giverId: Number(giverId), receiverId: Number(receiverId), templateId: Number(templateId), message, dueDate, purpose, visibility, viewerIds, isAnonymous });
    setIsSendingRequest(false);
    if (result.ok) {
      onClose();
      return;
    }
    setNoticeTone("error");
    setNotice(result.message);
  }

  function continueToStep(nextStep) {
    setNotice(null);
    if (nextStep === 2 && !templateId) {
      setNoticeTone("error");
      setNotice("Choose a feedback type to continue.");
      return;
    }
    if (nextStep === 3 && !giverId) {
      setNoticeTone("error");
      setNotice("Choose the person who will give feedback to continue.");
      return;
    }
    if (nextStep === 3 && !receiverId) {
      setNoticeTone("error");
      setNotice("Choose who will receive this feedback to continue.");
      return;
    }
    setStep(nextStep);
  }

  function selectFeedbackType(nextTemplateId) {
    setTemplateId(nextTemplateId);
    // A built-in type and the custom-template editor are separate choices.
    // Close any unfinished custom form when the user switches feedback type so
    // its draft questions are never mistaken for the selected template.
    setIsCustomTemplateOpen(false);
    setEditingTemplateId(null);
    setCustomTemplateName("");
    setCustomTemplateDescription("");
    setCustomQuestions(["", "", ""]);
    setSavedTemplateName("");
    setNotice(null);
  }

  function updateCustomQuestion(index, value) {
    setCustomQuestions((questions) => questions.map((question, questionIndex) => (
      questionIndex === index ? value : question
    )));
  }

  function addCustomQuestion() {
    setCustomQuestions((questions) => [...questions, ""]);
  }

  function removeCustomQuestion(index) {
    setCustomQuestions((questions) => questions.filter((_, questionIndex) => questionIndex !== index));
  }

  async function saveCustomTemplate() {
    const questions = customQuestions.map((question) => question.trim()).filter(Boolean);

    if (customTemplateName.trim().length < 3) {
      setNoticeTone("error");
      setNotice("Template name must contain at least 3 characters.");
      return;
    }

    if (questions.length < 1) {
      setNoticeTone("error");
      setNotice("Add at least one question for the custom template.");
      return;
    }

    setIsSavingTemplate(true);
    setNotice(null);

    const wasEditingTemplate = Boolean(editingTemplateId);
    const result = wasEditingTemplate
      ? await onUpdateTemplate(editingTemplateId, { name: customTemplateName, description: customTemplateDescription, questions })
      : await onCreateTemplate({ name: customTemplateName, description: customTemplateDescription, questions });

    setIsSavingTemplate(false);

    if (!result.ok) {
      setNoticeTone("error");
      setNotice(result.message);
      return;
    }

    setTemplateId(result.template.id);
    setSavedTemplateName(result.template.name);
    setCustomTemplateName("");
    setCustomTemplateDescription("");
    setCustomQuestions(["", "", ""]);
    setEditingTemplateId(null);
    setIsCustomTemplateOpen(false);
    setNoticeTone("success");
    setNotice(wasEditingTemplate ? "Custom template updated and selected for this request." : "Custom template saved and selected for this request.");
  }

  async function editTemplate(template) {
    if (template.createdBy == null) {
      setNoticeTone("error");
      setNotice("Built-in feedback types cannot be edited. Use Custom to create your own questions.");
      return;
    }
    try {
      const data = await api(`/templates/${template.id}/questions`);
      setEditingTemplateId(template.id);
      setCustomTemplateName(template.name);
      setCustomTemplateDescription(template.description || "");
      setCustomQuestions(data.questions.map((question) => question.questionText));
      setIsCustomTemplateOpen(true);
      setNotice(null);
    } catch (templateError) {
      setNoticeTone("error");
      setNotice(templateError.message);
    }
  }

  async function deactivateTemplate(template) {
    if (template.createdBy == null) {
      setNoticeTone("error");
      setNotice("Built-in feedback types are always available and cannot be disabled.");
      return;
    }
    const result = await onSetTemplateStatus(template.id, false);
    if (!result.ok) {
      setNoticeTone("error");
      setNotice(result.message);
      return;
    }
    if (Number(templateId) === template.id) setTemplateId(templates.find((item) => item.id !== template.id)?.id || "");
    setNoticeTone("success");
    setNotice(`${template.name} is no longer available for new requests.`);
  }

  const canModerateTemplates = String(currentUser?.role || "").toLowerCase() === "admin";
  const manageableTemplates = templates.filter((template) => template.createdBy != null && (canModerateTemplates || template.createdBy === currentUserId));

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/35 p-3 backdrop-blur-[2px] sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-labelledby="request-feedback-title">
    <aside className="my-auto w-full max-w-2xl overflow-y-auto rounded-2xl border border-line/80 bg-white px-5 py-5 shadow-2xl sm:max-h-[calc(100dvh-3rem)] sm:px-7 sm:py-7">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <p className="mb-1 text-sm font-bold uppercase tracking-wide text-blue-600">{replacementRequest ? "Replacement request" : "New request"}</p>
          <h2 id="request-feedback-title" className="text-3xl font-bold tracking-tight text-[#111827]">{replacementRequest ? `Ask ${replacementRequest.alternateGiverName}` : "Request feedback"}</h2>
          <p className="mt-2 text-sm text-muted">Sending as {currentUser.name}</p>
        </div>
        <button className="rounded-lg p-2 text-muted transition hover:bg-slate-100 hover:text-ink" type="button" aria-label="Close request form" onClick={onClose}>
          ×
        </button>
      </div>

      <RequestProgress step={step} />

      <form className="mt-6 grid gap-5" onSubmit={submit}>
        <Field className={step === 1 ? "" : "hidden"} label="Feedback type">
          <SelectShell>
            <select className="w-full bg-transparent outline-none" value={templateId} onChange={(event) => selectFeedbackType(event.target.value)}>
              {templates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name}
                </option>
              ))}
            </select>
          </SelectShell>
        </Field>

        <Field className={step === 2 ? "" : "hidden"} label="Who will give feedback?">
          <SelectShell>
            <Avatar initials={initialsForName(possibleGivers.find((user) => user.id === Number(giverId))?.name)} small />
            <select className="w-full bg-transparent outline-none" value={giverId} onChange={(event) => setGiverId(event.target.value)}>
              {possibleGivers.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name}
                </option>
              ))}
            </select>
          </SelectShell>
          <p className="text-sm font-normal text-muted">This person will receive the form and share their feedback.</p>
        </Field>

        <Field className={step === 2 ? "" : "hidden"} label="Who will receive feedback?">
          <SelectShell>
            <Avatar initials={initialsForName(possibleReceivers.find((user) => user.id === Number(receiverId))?.name)} small />
            <select className="w-full bg-transparent outline-none" value={receiverId} onChange={(event) => setReceiverId(event.target.value)}>
              {possibleReceivers.map((user) => (
                <option key={user.id} value={user.id}>{user.name}{user.id === currentUserId ? " (me)" : ""}</option>
              ))}
            </select>
          </SelectShell>
          <p className="text-sm font-normal text-muted">Choose yourself for personal feedback, or another Justuju member when you are coordinating feedback for them.</p>
        </Field>

        <Field className={step === 2 ? "" : "hidden"} label="Due date (optional)">
          <input className={fieldClass} type="date" min={today} value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
          <p className="text-sm font-normal text-muted">Changing the date does not allow a duplicate open request with the same feedback purpose.</p>
        </Field>

        {step === 2 ? <div className="flex items-center justify-between gap-3"><button className={secondaryButton} type="button" onClick={() => setStep(1)}>Back</button><button className={primaryButton} type="button" onClick={() => continueToStep(3)}>Continue</button></div> : null}

        <div className={step === 1 ? "rounded-xl border border-dashed border-slate-300 bg-slate-50/70 p-3.5" : "hidden"}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-bold text-slate-900">Need your own questions?</p>
              <p className="mt-0.5 text-sm text-muted">Create a reusable custom template.</p>
            </div>
            <button
              className={secondaryButton}
              type="button"
              onClick={() => {
                setIsCustomTemplateOpen((isOpen) => !isOpen);
                setEditingTemplateId(null);
                setCustomTemplateName("");
                setCustomTemplateDescription("");
                setCustomQuestions(["", "", ""]);
                setSavedTemplateName("");
                setNotice(null);
              }}
            >
              <Plus size={17} />
              {isCustomTemplateOpen ? "Close custom" : "Custom"}
            </button>
          </div>

          {isCustomTemplateOpen ? (
            <div className="mt-5 grid gap-4">
              <Field label="Custom feedback type name">
                <input
                  className={fieldClass}
                  placeholder="Example: Peer Feedback"
                  value={customTemplateName}
                  onChange={(event) => setCustomTemplateName(event.target.value)}
                />
              </Field>

              <Field label="Description (optional)">
                <textarea
                  className={`${fieldClass} min-h-24 resize-y leading-7`}
                  placeholder="What is this template used for?"
                  value={customTemplateDescription}
                  onChange={(event) => setCustomTemplateDescription(event.target.value)}
                />
              </Field>

              <div className="grid gap-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-base font-medium text-[#1f2937]">Questions</p>
                  <button
                    className="inline-flex items-center gap-2 rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm font-semibold text-blue-700 transition hover:bg-blue-50 disabled:opacity-60"
                    type="button"
                    onClick={addCustomQuestion}
                    disabled={customQuestions.length >= 10}
                  >
                    <Plus size={15} />
                    Add question
                  </button>
                </div>

                {customQuestions.map((question, index) => (
                  <div key={`custom-question-${index}`} className="flex gap-2">
                    <input
                      className={fieldClass}
                      placeholder={`Question ${index + 1}`}
                      value={question}
                      onChange={(event) => updateCustomQuestion(index, event.target.value)}
                    />
                    {customQuestions.length > 1 ? (
                      <button
                        className="min-h-12 rounded-lg border border-red-200 bg-white px-3 text-sm font-semibold text-red-600 transition hover:bg-red-50"
                        type="button"
                        onClick={() => removeCustomQuestion(index)}
                        aria-label={`Remove question ${index + 1}`}
                      >
                        Remove
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>

              <button
                className={`${primaryButton} w-full py-3 text-base`}
                type="button"
                onClick={saveCustomTemplate}
                disabled={isSavingTemplate}
              >
                <Check size={18} />
                {isSavingTemplate ? "Saving template..." : editingTemplateId ? "Update custom template" : "Save custom template"}
              </button>
            </div>
          ) : null}

          {manageableTemplates.length ? (
            <div className="mt-4 border-t border-dashed border-slate-300 pt-4">
              <button className="flex w-full items-center justify-between text-left text-sm font-semibold text-blue-700" type="button" onClick={() => setIsManageTemplatesOpen((visible) => !visible)}>
                <span>Manage my custom templates ({manageableTemplates.length})</span>
                <span aria-hidden="true">{isManageTemplatesOpen ? "−" : "+"}</span>
              </button>
              {isManageTemplatesOpen ? <div className="mt-3 grid gap-2">
                {manageableTemplates.map((template) => (
                  <div key={template.id} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2.5">
                    <div className="min-w-0"><p className="truncate text-sm font-semibold text-slate-900">{template.name}</p><p className="truncate text-xs text-muted">{template.description || "Custom feedback template"}</p></div>
                    <div className="flex shrink-0 gap-2"><button className="text-xs font-bold text-blue-700 hover:underline" type="button" onClick={() => void editTemplate(template)}>Edit</button><button className="text-xs font-bold text-red-600 hover:underline" type="button" onClick={() => void deactivateTemplate(template)}>Disable</button></div>
                  </div>
                ))}
              </div> : null}
            </div>
          ) : null}

          {savedTemplateName ? (
            <div className="mt-4 flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
              <Check className="mt-0.5 shrink-0 text-emerald-700" size={18} />
              <span><strong>{savedTemplateName}</strong> is saved and selected. You can now choose the feedback giver and send the request.</span>
            </div>
          ) : null}
          <div className="mt-5 flex items-center justify-end gap-3 border-t border-dashed border-slate-300 pt-4">
            <button className={primaryButton} type="button" onClick={() => continueToStep(2)}>Continue</button>
          </div>
        </div>

        <div className={step === 3 ? "grid gap-5" : "hidden"}>
        <div className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-900">
          <span className="font-semibold">You will receive the completed feedback.</span> It is linked to your account automatically.
        </div>

        <button className="flex items-center justify-between rounded-lg border border-dashed border-slate-300 px-4 py-3 text-left text-sm font-semibold text-blue-700 transition hover:border-blue-300 hover:bg-blue-50" type="button" onClick={() => setShowMoreOptions((visible) => !visible)}>
          <span>{showMoreOptions ? "Hide additional options" : "More options (privacy, repeat, message)"}</span><span aria-hidden="true">{showMoreOptions ? "−" : "+"}</span>
        </button>

        {showMoreOptions ? <>
        <details className="group rounded-xl border border-slate-200 bg-white" open>
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3.5 marker:hidden [&::-webkit-details-marker]:hidden">
            <span><span className="block font-bold text-slate-900">Purpose & visibility</span><span className="mt-0.5 block text-sm font-normal text-muted">Why you need feedback and who can view it.</span></span>
            <span className="text-lg font-semibold text-blue-700 transition group-open:rotate-45">+</span>
          </summary>
          <div className="grid gap-4 border-t border-slate-100 px-4 py-4">
        <Field label="Feedback purpose">
          <SelectShell>
            <select className="w-full bg-transparent outline-none" value={purpose} onChange={(event) => setPurpose(event.target.value)}>
              <option value="growth">Development and growth</option>
              <option value="project_improvement">Project improvement</option>
              <option value="one_on_one">One-on-one discussion</option>
              <option value="appraisal">Official performance/appraisal record</option>
            </select>
          </SelectShell>
        </Field>

        <Field label="Who can view feedback?">
          <SelectShell>
            <select
              className="w-full bg-transparent outline-none"
              value={visibility}
              onChange={(event) => {
                setVisibility(event.target.value);
                setViewerIds([]);
              }}
            >
              <option value="private">Private — only us</option>
              <option value="mentor_lead">Mentor or lead</option>
              <option value="selected_group">Selected group</option>
            </select>
          </SelectShell>
          <p className="text-sm font-normal text-muted">Private requests are visible only to you and the feedback giver.</p>
        </Field>

        {visibility === "mentor_lead" ? (
          <div className="grid gap-2 text-base font-medium text-[#1f2937]">
            <span>Select mentor or lead</span>
            <SelectShell>
              <select
                className="w-full bg-transparent outline-none"
                value={viewerIds[0] || ""}
                onChange={(event) => setViewerIds(event.target.value ? [Number(event.target.value)] : [])}
              >
                <option value="">Choose one person</option>
                {mentorLeadViewers.map((user) => <option key={user.id} value={user.id}>{user.name} · {user.role}</option>)}
              </select>
            </SelectShell>
            <p className="text-sm font-normal text-muted">Only people assigned a Mentor, Lead, or Manager role can be selected. They can read this request but cannot edit it.</p>
            {!mentorLeadViewers.length ? <p className="text-sm font-semibold text-amber-700">No Mentor or Lead is configured yet. Ask the SC Team to assign that role first.</p> : null}
          </div>
        ) : null}

        {visibility === "selected_group" ? (
          <div className="grid gap-2 text-base font-medium text-[#1f2937]">
            <span>Select group members</span>
            <div className="grid gap-2 rounded-lg border border-line bg-slate-50 p-3">
              {possibleViewers.map((user) => (
                <label className="flex items-center gap-3 rounded-md px-2 py-1 text-sm font-medium" key={user.id}>
                  <input
                    type="checkbox"
                    checked={viewerIds.includes(user.id)}
                    onChange={(event) => setViewerIds((ids) => event.target.checked ? [...ids, user.id] : ids.filter((id) => id !== user.id))}
                  />
                  {user.name}
                </label>
              ))}
            </div>
            <p className="text-sm font-normal text-muted">Selected people can read this request and its feedback, but cannot edit it.</p>
          </div>
        ) : null}
          </div>
        </details>

        <details className="group rounded-xl border border-amber-200 bg-amber-50/50">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3.5 marker:hidden [&::-webkit-details-marker]:hidden">
            <span><span className="block font-bold text-slate-900">Privacy</span><span className="mt-0.5 block text-sm font-normal text-slate-600">Keep the feedback giver anonymous, if needed.</span></span>
            <span className="text-lg font-semibold text-amber-700 transition group-open:rotate-45">+</span>
          </summary>
          <div className="border-t border-amber-200 px-4 py-4">
          <div className="rounded-lg bg-white/70 p-3">
          <label className="flex cursor-pointer items-start gap-3">
            <input className="mt-1 h-4 w-4" type="checkbox" checked={isAnonymous} onChange={(event) => setIsAnonymous(event.target.checked)} />
            <span>
              <span className="font-semibold text-slate-900">Keep the feedback giver anonymous</span>
              <span className="mt-1 block text-sm font-normal text-slate-600">After feedback is submitted, their name is hidden from you and any selected viewers. The giver can still see their own request.</span>
            </span>
          </label>
          </div>
          </div>
        </details>

        <details className="group rounded-xl border border-slate-200 bg-white">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3.5 marker:hidden [&::-webkit-details-marker]:hidden">
            <span><span className="block font-bold text-slate-900">Add a message</span><span className="mt-0.5 block text-sm font-normal text-muted">Optional context for the feedback giver.</span></span>
            <span className="text-lg font-semibold text-blue-700 transition group-open:rotate-45">+</span>
          </summary>
          <div className="border-t border-slate-100 px-4 py-4">
        <Field label="Feedback request message (optional)">
          <textarea
            className={`${fieldClass} min-h-48 resize-y leading-7`}
            value={message}
            maxLength={500}
            placeholder="Add a short note or context for the feedback giver (optional)"
            onChange={(event) => setMessage(event.target.value)}
          />
          <p className="text-sm font-normal text-muted">{message.length} / 500 characters</p>
        </Field>
          </div>
        </details>
        </> : null}

        <div className="flex items-center gap-3 pt-1"><button className={secondaryButton} type="button" onClick={() => setStep(2)} disabled={isSendingRequest}>Back</button><button className={`${primaryButton} flex-1 py-4 text-lg disabled:cursor-not-allowed disabled:opacity-60`} type="submit" disabled={isSendingRequest}>
          <Send size={22} />
          {isSendingRequest ? "Sending…" : "Send Request"}
        </button></div>
        </div>
        {notice ? (
          <p
            className={`rounded-lg border px-4 py-3 text-center text-sm font-medium ${
              noticeTone === "success"
                ? "border-green-200 bg-green-50 text-green-700"
                : "border-red-200 bg-red-50 text-red-700"
            }`}
          >
            {notice}
          </p>
        ) : null}
      </form>
    </aside>
    </div>
  );
}

function SelectShell({ children }) {
  return (
    <div className="flex min-h-14 items-center gap-3 rounded-lg border border-line bg-white px-4 text-base shadow-sm focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-100">
      {children}
    </div>
  );
}

function Field({ label, children, className = "" }) {
  return (
    <label className={`grid gap-2 text-base font-medium text-[#1f2937] ${className}`}>
      <span>{label}</span>
      {children}
    </label>
  );
}

function DeclineFeedbackModal({ request, users, currentUserId, onClose, onSubmit }) {
  const [reason, setReason] = useState("");
  const [reasonType, setReasonType] = useState("unable_to_participate");
  const [alternateGiverId, setAlternateGiverId] = useState("");
  const [notice, setNotice] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function submit(event) {
    event.preventDefault();
    if (reason.trim().length < 3) {
      setNotice("Please enter a short reason for declining this request.");
      return;
    }

    setIsSubmitting(true);
    setNotice("");
    const labels = { unable_to_participate: "Unable to participate", conflict_of_interest: "Conflict of interest", request_another_reviewer: "Request another reviewer", other: "Other" };
    const wasDeclined = await onSubmit(`${labels[reasonType]}: ${reason}`, alternateGiverId ? Number(alternateGiverId) : null);
    if (!wasDeclined) setIsSubmitting(false);
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm">
      <section className="w-full max-w-lg rounded-3xl border border-white/30 bg-white p-6 shadow-[0_28px_90px_rgba(15,23,42,0.35)] sm:p-8">
        <p className="text-sm font-bold uppercase tracking-[0.14em] text-red-600">Decline feedback request</p>
        <h2 className="mt-2 text-2xl font-extrabold text-slate-950">Explain why you cannot take part</h2>
        <p className="mt-2 text-sm leading-6 text-muted">Your reason will be visible to the requester. You can still view this request later.</p>
        <form className="mt-6 grid gap-4" onSubmit={submit}>
          <Field label="Reason type">
            <select className={fieldClass} value={reasonType} onChange={(event) => setReasonType(event.target.value)}>
              <option value="unable_to_participate">Unable to participate</option>
              <option value="conflict_of_interest">Conflict of interest</option>
              <option value="request_another_reviewer">Request another reviewer</option>
              <option value="other">Other</option>
            </select>
          </Field>
          <Field label="Reason for declining">
            <textarea
              className={`${fieldClass} min-h-32 resize-y leading-7`}
              value={reason}
              maxLength={500}
              placeholder="For example: I did not work closely enough on this project to give useful feedback."
              onChange={(event) => setReason(event.target.value)}
              required
            />
            <p className="text-sm font-normal text-muted">{reason.length} / 500 characters</p>
          </Field>
          <Field label="Suggest another reviewer (optional)">
            <select className={fieldClass} value={alternateGiverId} onChange={(event) => setAlternateGiverId(event.target.value)}>
              <option value="">No suggestion</option>
              {users.filter((user) => user.id !== currentUserId && user.id !== request.requesterId).map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}
            </select>
            <p className="text-sm font-normal text-muted">The requester can create a replacement request with this person.</p>
          </Field>
          {notice ? <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{notice}</p> : null}
          <div className="flex justify-end gap-3 pt-2">
            <button className={secondaryButton} type="button" onClick={onClose} disabled={isSubmitting}>Cancel</button>
            <button className="inline-flex min-h-11 items-center justify-center rounded-lg bg-red-600 px-5 font-semibold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60" type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Declining…" : "Decline request"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function DueDateModal({ request, onClose, onSubmit }) {
  const [dueDate, setDueDate] = useState(request.rawDueDate ? request.rawDueDate.slice(0, 10) : "");
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const source = request.rawDueDate ? new Date(`${request.rawDueDate.slice(0, 10)}T00:00:00`) : new Date();
    return new Date(source.getFullYear(), source.getMonth(), 1);
  });
  const [notice, setNotice] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const today = new Date().toISOString().slice(0, 10);

  async function submit(event) {
    event.preventDefault();
    if (dueDate && dueDate < today) {
      setNotice("Due date cannot be in the past.");
      return;
    }
    setIsSubmitting(true);
    setNotice("");
    const wasUpdated = await onSubmit(dueDate);
    if (!wasUpdated) setIsSubmitting(false);
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm">
      <section className="w-full max-w-xl rounded-3xl border border-white/30 bg-white p-7 shadow-[0_28px_90px_rgba(15,23,42,0.35)] sm:min-h-[440px] sm:p-10">
        <p className="text-sm font-bold uppercase tracking-[0.14em] text-blue-600">Update request</p>
        <h2 className="mt-2 text-2xl font-extrabold text-slate-950">Change due date</h2>
        <p className="mt-2 text-sm leading-6 text-muted">Choose a new deadline for {request.giverName}. Leave it empty to remove the due date.</p>
        <form className="mt-6 grid gap-4" onSubmit={submit}>
          <Field label="Due date">
            <InlineDatePicker
              dueDate={dueDate}
              month={calendarMonth}
              onMonthChange={setCalendarMonth}
              onChange={setDueDate}
              today={today}
            />
          </Field>
          {notice ? <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{notice}</p> : null}
          <div className="flex justify-end gap-3 pt-2">
            <button className={secondaryButton} type="button" onClick={onClose} disabled={isSubmitting}>Cancel</button>
            <button className={primaryButton} type="submit" disabled={isSubmitting}>{isSubmitting ? "Saving…" : "Save due date"}</button>
          </div>
        </form>
      </section>
    </div>
  );
}

function InlineDatePicker({ dueDate, month, onMonthChange, onChange, today }) {
  const monthName = month.toLocaleDateString("en-IN", { month: "long", year: "numeric" });
  const firstDay = new Date(month.getFullYear(), month.getMonth(), 1).getDay();
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const cells = Array.from({ length: firstDay + daysInMonth }, (_, index) => index < firstDay ? null : index - firstDay + 1);

  function toIso(day) {
    const year = month.getFullYear();
    const monthNumber = String(month.getMonth() + 1).padStart(2, "0");
    return `${year}-${monthNumber}-${String(day).padStart(2, "0")}`;
  }

  function changeMonth(offset) {
    onMonthChange(new Date(month.getFullYear(), month.getMonth() + offset, 1));
  }

  return (
    <div className="rounded-xl border border-line bg-slate-50/70 p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <button className="rounded-md border border-line bg-white px-3 py-1 text-sm font-bold text-slate-700" type="button" onClick={() => changeMonth(-1)}>‹</button>
        <p className="text-sm font-bold text-slate-900">{monthName}</p>
        <button className="rounded-md border border-line bg-white px-3 py-1 text-sm font-bold text-slate-700" type="button" onClick={() => changeMonth(1)}>›</button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-xs font-semibold text-muted">
        {["S", "M", "T", "W", "T", "F", "S"].map((day, index) => <span key={`${day}-${index}`} className="py-1">{day}</span>)}
        {cells.map((day, index) => {
          if (!day) return <span key={`blank-${index}`} />;
          const value = toIso(day);
          const isPast = value < today;
          const isSelected = value === dueDate;
          return (
            <button
              key={value}
              className={`rounded-md py-2 text-sm font-semibold transition ${isSelected ? "bg-blue-600 text-white" : isPast ? "cursor-not-allowed text-slate-300" : "text-slate-800 hover:bg-blue-100"}`}
              type="button"
              disabled={isPast}
              onClick={() => onChange(value)}
            >
              {day}
            </button>
          );
        })}
      </div>
      <div className="mt-3 flex items-center justify-between text-sm">
        <button className="font-semibold text-blue-700" type="button" onClick={() => onChange("")}>Remove date</button>
        {dueDate ? <span className="text-muted">Selected: {formatDueDate(dueDate)}</span> : <span className="text-muted">No due date</span>}
      </div>
    </div>
  );
}

function FeedbackDetail({ request, currentUserId, currentUserRole, onClose, onSubmit, onSaveDraft, onAddAttachment, onAcknowledge, onCreateFollowUp, onUpdateFollowUp, onDiscussion, onReport, onModerate }) {
  const template = request.template;
  const isRequester = Number(currentUserId) === Number(request.requesterId);
  const isGiver = Number(currentUserId) === Number(request.giverId);
  const isReceiver = Number(currentUserId) === Number(request.receiverId);
  const canSubmit = isGiver && ["requested", "in_progress", "overdue"].includes(request.status);
  const canAcknowledge = isReceiver && request.status === "submitted";
  const canCreateFollowUp = (isRequester || isReceiver) && ["acknowledged", "follow_up_needed"].includes(request.status);
  const feedbackWasShared = ["submitted", "acknowledged", "follow_up_needed", "closed"].includes(request.status);
  const wasStopped = ["cancelled", "declined"].includes(request.status);
  const footerMessage = request.status === "cancelled"
    ? "This feedback request was cancelled."
    : request.status === "declined"
      ? "This feedback request was declined."
      : feedbackWasShared
        ? `This feedback was shared with ${request.requesterName}.`
        : `Your feedback will be shared with ${request.requesterName}.`;
  const [answers, setAnswers] = useState(() => Object.fromEntries((request.answers?.length ? request.answers : request.draft?.answers || []).map((item) => [item.questionId, { answer: item.answer || "", rating: item.rating || null }])));
  const [acknowledgementComment, setAcknowledgementComment] = useState("");
  const [isReportOpen, setIsReportOpen] = useState(false);
  const [isModerationOpen, setIsModerationOpen] = useState(false);
  const [attachmentLabel, setAttachmentLabel] = useState("");
  const [attachmentUrl, setAttachmentUrl] = useState("");
  const [attachmentNotice, setAttachmentNotice] = useState("");
  const canModerate = String(currentUserRole).toLowerCase() === "admin";

  async function submit(event) {
    event.preventDefault();
    await onSubmit(request.id, template.questions.map((question) => ({ questionId: question.id, answer: answers[question.id]?.answer || "", rating: answers[question.id]?.rating || null })));
  }

  async function saveCurrentDraft() {
    await onSaveDraft(request.id, template.questions.map((question) => ({ questionId: question.id, answer: answers[question.id]?.answer || "", rating: answers[question.id]?.rating || null })));
  }

  async function addSupportingLink() {
    const label = attachmentLabel.trim();
    const url = attachmentUrl.trim();
    if (label.length < 2) {
      setAttachmentNotice("Enter a link name with at least 2 characters.");
      return;
    }
    try {
      const parsedUrl = new URL(url);
      if (!["https:", "http:"].includes(parsedUrl.protocol)) throw new Error("Invalid protocol");
    } catch {
      setAttachmentNotice("Enter a valid link starting with https:// or http://.");
      return;
    }
    try {
      await onAddAttachment(request.id, { label, url });
      setAttachmentLabel(""); setAttachmentUrl(""); setAttachmentNotice("Link added.");
    } catch (error) { setAttachmentNotice(error.message || "Link could not be added."); }
  }

  async function acknowledge() {
    const wasAcknowledged = await onAcknowledge(request.id, acknowledgementComment);
    if (wasAcknowledged) onClose();
  }

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm sm:p-6">
      <section className="max-h-[calc(100vh-32px)] w-full max-w-3xl overflow-auto rounded-3xl border border-white/30 bg-white shadow-[0_28px_90px_rgba(15,23,42,0.35)]">
        <div className="flex items-start justify-between gap-4 border-b border-blue-100 bg-gradient-to-r from-blue-50 via-indigo-50 to-violet-50 px-6 py-6 sm:px-8">
          <div>
            <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-white px-3 py-1 text-xs font-bold uppercase tracking-wide text-blue-700 shadow-sm">
              <Sparkles size={14} />
              {template.templateName}
            </div>
            <h2 className="text-2xl font-extrabold tracking-tight text-slate-950 sm:text-3xl">
              {request.requesterName} requested feedback from {request.giverName}
            </h2>
            <p className="mt-2 text-sm text-slate-600">Share clear, kind, and actionable feedback.</p>
            {request.isAnonymous && !isGiver ? <p className="mt-3 inline-flex rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800">Anonymous feedback · giver name hidden</p> : null}
          </div>
          <div className="flex shrink-0 flex-wrap justify-end gap-2">
            {canModerate ? <button className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50" type="button" onClick={() => setIsModerationOpen(true)}>Record controls</button> : null}
            {feedbackWasShared ? <button className="rounded-lg border border-red-200 bg-white px-3 py-2 text-sm font-semibold text-red-700 transition hover:bg-red-50" type="button" onClick={() => setIsReportOpen(true)}>Report feedback</button> : null}
          </div>
        </div>

        <form className="grid gap-5 p-6 sm:p-8" onSubmit={submit}>
          <RequestStatusTimeline status={request.status} />
          <div className="rounded-xl border border-blue-100 bg-blue-50/60 px-4 py-3 text-sm">
            <p className="font-semibold text-slate-800">Feedback purpose</p>
            <p className="mt-1 text-slate-600">{formatPurpose(request.purpose)}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
            <p className="font-semibold text-slate-800">Visibility</p>
            <p className="mt-1 text-slate-600">{formatVisibility(request.visibility)}</p>
            {request.viewers?.length ? <p className="mt-1 text-slate-600">Shared with: {request.viewers.map((viewer) => viewer.name).join(", ")}</p> : null}
          </div>
          {isRequester && !wasStopped && request.status !== "closed" ? <section className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="font-semibold text-slate-900">Supporting links</p>
            <p className="mt-1 text-sm text-slate-600">Share a document, task, Drive, or screenshot link to give the feedback giver useful context.</p>
            <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_1.5fr_auto]">
              <input className={fieldClass} value={attachmentLabel} maxLength={160} placeholder="Link name" onChange={(event) => setAttachmentLabel(event.target.value)} />
              <input className={fieldClass} value={attachmentUrl} placeholder="https://…" onChange={(event) => setAttachmentUrl(event.target.value)} />
              <button className={secondaryButton} type="button" onClick={() => void addSupportingLink()}>Add link</button>
            </div>
            {attachmentNotice ? <p className={`mt-2 text-sm font-medium ${attachmentNotice === "Link added." ? "text-emerald-700" : "text-red-700"}`}>{attachmentNotice}</p> : null}
          </section> : null}
          {request.attachments?.length ? <section className="rounded-xl border border-slate-200 bg-slate-50 p-4"><p className="font-semibold text-slate-900">Shared links</p><ul className="mt-2 grid gap-2">{request.attachments.map((attachment) => <li key={attachment.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white px-3 py-2 text-sm"><span><span className="font-semibold text-slate-800">{attachment.label}</span><span className="ml-2 text-slate-500">added by {attachment.addedByName}</span></span><a className="font-semibold text-blue-700 hover:underline" href={attachment.url} target="_blank" rel="noreferrer">Open link</a></li>)}</ul></section> : null}
          {!wasStopped ? template.questions.map((question, index) => (
            <Field key={question.id} label={<span className="flex gap-3"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-100 text-xs font-bold text-blue-700">{index + 1}</span><span>{question.questionText}</span></span>}>
              <textarea
                className={`${fieldClass} min-h-28 resize-y border-slate-200 bg-slate-50/70 leading-7 focus:bg-white disabled:bg-surface disabled:text-muted`}
                value={answers[question.id]?.answer ?? ""}
                disabled={!canSubmit}
                onChange={(event) => setAnswers({ ...answers, [question.id]: { ...(answers[question.id] || {}), answer: event.target.value } })}
                required
              />
              {canSubmit ? <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-600"><span className="font-semibold">Optional rating</span>{[1, 2, 3, 4, 5].map((rating) => <button key={rating} className={`h-8 w-8 rounded-full border font-bold transition ${answers[question.id]?.rating === rating ? "border-amber-400 bg-amber-400 text-white" : "border-slate-200 bg-white text-slate-600 hover:border-amber-300"}`} type="button" aria-label={`Rate ${rating} out of 5`} onClick={() => setAnswers({ ...answers, [question.id]: { ...(answers[question.id] || {}), rating } })}>{rating}</button>)}</div> : null}
              {!canSubmit && request.answers?.find((item) => item.questionId === question.id)?.rating ? <p className="mt-2 text-xs font-semibold text-amber-700">Rating: {request.answers.find((item) => item.questionId === question.id).rating} / 5</p> : null}
            </Field>
          )) : null}
          {canAcknowledge ? (
            <Field label="Acknowledgement comment (optional)">
              <textarea
                className={`${fieldClass} min-h-24 resize-y border-violet-200 bg-violet-50/40 leading-7 focus:bg-white`}
                value={acknowledgementComment}
                maxLength={500}
                placeholder="For example: Thank you, this feedback is helpful."
                onChange={(event) => setAcknowledgementComment(event.target.value)}
              />
              <p className="text-sm font-normal text-muted">{acknowledgementComment.length} / 500 characters</p>
            </Field>
          ) : null}
          {!canSubmit && !canAcknowledge && request.acknowledgementComment ? (
            <div className="rounded-xl border border-violet-100 bg-violet-50 px-4 py-3 text-sm text-violet-950">
              <p className="font-semibold">Acknowledgement comment</p>
              <p className="mt-1 whitespace-pre-wrap text-violet-800">{request.acknowledgementComment}</p>
            </div>
          ) : null}
          {!canSubmit && !canAcknowledge && request.declineReason ? (
            <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-950">
              <p className="font-semibold">Decline reason</p>
              <p className="mt-1 whitespace-pre-wrap text-red-800">{request.declineReason}</p>
              {request.alternateGiverName ? <p className="mt-2 font-semibold text-violet-800">Suggested reviewer: {request.alternateGiverName}</p> : null}
            </div>
          ) : null}
          {feedbackWasShared ? <FeedbackConversation request={request} currentUserId={currentUserId} onDiscussion={onDiscussion} /> : null}
          {!canSubmit && !canAcknowledge && request.followUps?.length ? (
            <section className="rounded-xl border border-amber-100 bg-amber-50/50 p-4">
              <p className="font-semibold text-slate-900">Follow-up actions</p>
              <div className="mt-3 grid gap-3">
                {request.followUps.map((followUp) => (
                  <FollowUpCard key={followUp.id} followUp={followUp} request={request} currentUserId={currentUserId} onUpdate={onUpdateFollowUp} />
                ))}
              </div>
            </section>
          ) : null}
          {!canSubmit && !canAcknowledge ? <FeedbackHistory request={request} /> : null}
          <div className="mt-2 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-5">
            <p className="text-sm text-muted">{footerMessage}</p>
            <div className="flex flex-wrap gap-2">
            <button className={secondaryButton} type="button" onClick={onClose}>
              Close
            </button>
            {canSubmit ? (
              <button className={secondaryButton} type="button" onClick={() => void saveCurrentDraft()}>
                Save draft
              </button>
            ) : null}
            {canSubmit ? (
              <button className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 px-5 font-semibold text-white shadow-lg shadow-blue-200 transition hover:from-blue-700 hover:to-indigo-700" type="submit">
                <Check size={16} />
                Submit feedback
              </button>
            ) : null}
            {canAcknowledge ? (
              <button className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-violet-600 to-indigo-600 px-5 font-semibold text-white shadow-lg shadow-violet-200 transition hover:from-violet-700 hover:to-indigo-700" type="button" onClick={() => void acknowledge()}>
                <Check size={16} />
                Acknowledge feedback
              </button>
            ) : null}
            {canCreateFollowUp ? (
              <button className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-amber-500 px-5 font-semibold text-white transition hover:bg-amber-600" type="button" onClick={onCreateFollowUp}>
                <Plus size={16} /> Create follow-up
              </button>
            ) : null}
            </div>
          </div>
        </form>
      </section>
      {isReportOpen ? <ReportFeedbackModal request={request} onClose={() => setIsReportOpen(false)} onReport={onReport} /> : null}
      {isModerationOpen ? <ModerateFeedbackModal request={request} onClose={() => setIsModerationOpen(false)} onModerate={onModerate} /> : null}
    </div>
  );
}

function RequestStatusTimeline({ status }) {
  const stopped = status === "declined" || status === "cancelled";
  const stages = [
    { key: "requested", label: "Requested" },
    { key: "in_progress", label: "In progress" },
    { key: "submitted", label: "Submitted" },
    { key: "acknowledged", label: "Acknowledged" },
    { key: "closed", label: "Closed" },
  ];
  const activeIndex = stopped ? 0 : status === "overdue" ? 1 : status === "follow_up_needed" ? 3 : Math.max(0, stages.findIndex((stage) => stage.key === status));
  const heading = status === "declined" ? "This request was declined" : status === "cancelled" ? "This request was cancelled" : status === "overdue" ? "Feedback is overdue" : "Request progress";

  return (
    <section className={`rounded-2xl border p-4 ${stopped ? "border-red-100 bg-red-50/60" : "border-slate-200 bg-slate-50/70"}`} aria-label={heading}>
      <div className="mb-3 flex items-center justify-between gap-3"><p className="text-sm font-bold text-slate-900">{heading}</p><span className={statusClass(status)}>{String(status).replaceAll("_", " ")}</span></div>
      <ol className="grid grid-cols-5 gap-1">
        {stages.map((stage, index) => {
          const isComplete = !stopped && index < activeIndex;
          const isCurrent = !stopped && index === activeIndex;
          return <li className="min-w-0 text-center" key={stage.key}>
            <div className={`mx-auto flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${isCurrent ? "bg-blue-600 text-white ring-4 ring-blue-100" : isComplete ? "bg-emerald-500 text-white" : "bg-slate-200 text-slate-500"}`}>{isComplete ? "✓" : index + 1}</div>
            <p className={`mt-2 truncate text-[10px] font-bold sm:text-xs ${isCurrent ? "text-blue-700" : isComplete ? "text-emerald-700" : "text-slate-500"}`}>{stage.label}</p>
          </li>;
        })}
      </ol>
    </section>
  );
}

function ModerateFeedbackModal({ request, onClose, onModerate }) {
  const availableActions = request.status === "closed"
    ? [{ value: "hide", label: "Hide from participant lists" }, { value: "remove", label: "Remove from participant lists" }, { value: "reopen", label: "Reopen completed feedback" }]
    : [{ value: "hide", label: "Hide from participant lists" }, { value: "remove", label: "Remove from participant lists" }];
  const [action, setAction] = useState(availableActions[0].value);
  const [reason, setReason] = useState("");
  const [notice, setNotice] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  async function submit(event) {
    event.preventDefault();
    if (reason.trim().length < 3) return setNotice("Please enter a reason of at least 3 characters.");
    setIsSaving(true);
    const wasSaved = await onModerate(request.id, action, reason.trim());
    setIsSaving(false);
    if (wasSaved) onClose();
    else setNotice("The record control could not be saved. Please try again.");
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm">
      <form className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl" onSubmit={submit}>
        <p className="text-lg font-bold text-slate-950">Record controls</p>
        <p className="mt-2 text-sm text-slate-600">Only an admin can moderate this record. Every action and reason is kept in the audit trail.</p>
        <label className="mt-5 grid gap-2 text-sm font-semibold text-slate-800">Action
          <select className={fieldClass} value={action} onChange={(event) => setAction(event.target.value)}>
            {availableActions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </label>
        <label className="mt-4 grid gap-2 text-sm font-semibold text-slate-800">Reason
          <textarea className={`${fieldClass} min-h-24 resize-y`} value={reason} maxLength={1000} placeholder="Explain why this action is needed." onChange={(event) => setReason(event.target.value)} required />
        </label>
        {notice ? <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{notice}</p> : null}
        <div className="mt-5 flex justify-end gap-3">
          <button className={secondaryButton} type="button" onClick={onClose}>Cancel</button>
          <button className="inline-flex min-h-11 items-center justify-center rounded-lg bg-slate-900 px-4 font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60" type="submit" disabled={isSaving}>{isSaving ? "Saving…" : "Save action"}</button>
        </div>
      </form>
    </div>
  );
}

function ReportFeedbackModal({ request, onClose, onReport }) {
  const [reason, setReason] = useState("rude");
  const [details, setDetails] = useState("");
  const [notice, setNotice] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  async function submitReport(event) {
    event.preventDefault();
    setIsSaving(true);
    const result = await onReport(request.id, { reason, details });
    setIsSaving(false);
    if (result.ok) setNotice("Your report was sent privately to the SC Team for review.");
    else setNotice(result.message || "Your report could not be sent.");
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm">
      <form className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl" onSubmit={submitReport}>
        <p className="text-lg font-bold text-slate-950">Report feedback</p>
        <p className="mt-2 text-sm text-slate-600">Use this only for harmful, abusive, discriminatory, or inappropriate feedback. Your report is private.</p>
        <label className="mt-5 grid gap-2 text-sm font-semibold text-slate-800">Reason
          <select className={fieldClass} value={reason} onChange={(event) => setReason(event.target.value)}>
            <option value="rude">Rude or disrespectful</option>
            <option value="harassment">Harassment or bullying</option>
            <option value="discrimination">Discrimination</option>
            <option value="inappropriate">Inappropriate content</option>
            <option value="other">Other concern</option>
          </select>
        </label>
        <label className="mt-4 grid gap-2 text-sm font-semibold text-slate-800">What happened? <span className="font-normal text-slate-500">(optional)</span>
          <textarea className={`${fieldClass} min-h-28 resize-y`} value={details} maxLength={1000} placeholder="Add any context that could help the reviewer." onChange={(event) => setDetails(event.target.value)} />
        </label>
        {notice ? <p className={`mt-4 rounded-lg px-3 py-2 text-sm font-medium ${notice.startsWith("Your report was") ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"}`}>{notice}</p> : null}
        <div className="mt-5 flex justify-end gap-3">
          <button className={secondaryButton} type="button" onClick={onClose}>Cancel</button>
          <button className="inline-flex min-h-11 items-center justify-center rounded-lg bg-red-600 px-4 font-semibold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60" type="submit" disabled={isSaving || Boolean(notice && notice.startsWith("Your report was"))}>{isSaving ? "Sending…" : "Send report"}</button>
        </div>
      </form>
    </div>
  );
}

function FeedbackConversation({ request, currentUserId, onDiscussion }) {
  const isReceiver = Number(currentUserId) === Number(request.receiverId);
  const isGiver = Number(currentUserId) === Number(request.giverId);
  const canDiscuss = ["submitted", "acknowledged"].includes(request.status);
  const [message, setMessage] = useState("");
  const [answerId, setAnswerId] = useState("");
  const [discussionMode, setDiscussionMode] = useState("question");
  const [replyValues, setReplyValues] = useState({});
  const [notice, setNotice] = useState("");
  const discussions = request.discussions || [];
  const questions = discussions.filter((discussion) => !discussion.parentId);
  const messages = [...discussions].sort((first, second) => new Date(first.createdAt) - new Date(second.createdAt));

  async function sendMessage() {
    if (message.trim().length < 3) return setNotice("Please write at least 3 characters.");
    const saved = await onDiscussion(request.id, { type: discussionMode === "comment" ? "comment" : "clarification", message, answerId: answerId || null });
    if (saved) {
      setMessage("");
      setNotice("");
    } else {
      setNotice("Message could not be sent. Please try again.");
    }
  }

  async function sendReply(parentId) {
    const reply = replyValues[parentId] || "";
    if (reply.trim().length < 3) return setNotice("Please write at least 3 characters.");
    const saved = await onDiscussion(request.id, { type: "response", message: reply, parentId });
    if (saved) {
      setReplyValues((values) => ({ ...values, [parentId]: "" }));
      setNotice("");
    } else {
      setNotice("Reply could not be sent. Please try again.");
    }
  }

  // Keep the conversation visible after the feedback is closed. At that stage it
  // becomes a read-only record, so people can revisit the context later.
  if (!canDiscuss && !messages.length) return null;

  return (
    <section className="rounded-xl border border-sky-100 bg-sky-50/50 p-4">
      <p className="font-semibold text-slate-900">Comments and questions</p>
      <p className="mt-1 text-sm text-slate-600">{canDiscuss ? "You can leave a comment, or ask a question. Only questions need a reply before the request can close." : "Saved conversation from this completed feedback process."}</p>

      {messages.length ? <div className="mt-4 space-y-3">
        {messages.map((discussion) => {
          const isReply = Boolean(discussion.parentId);
          const isFromGiver = Number(discussion.authorId) === Number(request.giverId);
          const answer = (request.answers || []).find((item) => Number(item.id) === Number(discussion.answerId));
          return <div className={`max-w-[88%] rounded-xl px-4 py-3 ${isFromGiver ? "mr-auto border border-sky-200 bg-white" : "ml-auto bg-emerald-100 text-emerald-950"}`} key={discussion.id}>
            <p className="text-xs font-bold uppercase tracking-wide text-slate-600">{discussion.authorName} · {isFromGiver ? "Feedback giver" : "Feedback receiver"}</p>
            {answer ? <p className="mt-2 rounded-md bg-sky-50 px-2 py-1 text-xs font-semibold text-sky-900">About: {answer.questionText}</p> : null}
            <p className="mt-1 whitespace-pre-wrap text-sm">{discussion.message}</p>
            <p className="mt-2 text-xs text-slate-500">{isReply ? "Reply" : discussion.type === "comment" ? "Comment" : "Question"}</p>
          </div>;
        })}
      </div> : <p className="mt-4 rounded-lg border border-dashed border-sky-200 bg-white/70 px-4 py-3 text-sm text-slate-600">No questions yet.</p>}

      {canDiscuss && isReceiver ? <div className="mt-4 grid gap-3 border-t border-sky-100 pt-4">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Message type">
          <button className={`rounded-lg px-3 py-2 text-sm font-semibold ${discussionMode === "question" ? "bg-blue-600 text-white" : "border border-slate-200 bg-white text-slate-700"}`} type="button" onClick={() => setDiscussionMode("question")}>Ask a question</button>
          <button className={`rounded-lg px-3 py-2 text-sm font-semibold ${discussionMode === "comment" ? "bg-emerald-600 text-white" : "border border-slate-200 bg-white text-slate-700"}`} type="button" onClick={() => setDiscussionMode("comment")}>Add a comment</button>
        </div>
        <select className={fieldClass} value={answerId} onChange={(event) => setAnswerId(event.target.value)}><option value="">About the overall feedback</option>{(request.answers || []).map((answer) => <option key={answer.id} value={answer.id}>{answer.questionText}</option>)}</select>
        <textarea className={`${fieldClass} min-h-24 resize-y`} value={message} maxLength={1000} placeholder={discussionMode === "comment" ? "Write a thank-you or acknowledgement comment" : "Ask a question about this feedback"} onChange={(event) => setMessage(event.target.value)} />
        <button className={`${secondaryButton} justify-self-start`} type="button" onClick={() => void sendMessage()}>{discussionMode === "comment" ? "Send comment" : "Send question"}</button>
      </div> : null}

      {canDiscuss && isGiver ? questions.filter((question) => question.status === "open").map((question) => <div className="mt-4 grid gap-2 border-t border-sky-100 pt-4" key={`reply-${question.id}`}>
        <p className="text-sm font-semibold text-slate-800">Reply to {question.authorName}’s question</p>
        <textarea className={`${fieldClass} min-h-20 resize-y`} value={replyValues[question.id] || ""} maxLength={1000} placeholder="Write your reply" onChange={(event) => setReplyValues((values) => ({ ...values, [question.id]: event.target.value }))} />
        <button className={`${primaryButton} justify-self-start`} type="button" onClick={() => void sendReply(question.id)}>Send reply</button>
      </div>) : null}
      {canDiscuss && isReceiver && questions.some((question) => question.status === "open") ? <p className="mt-3 text-xs font-semibold text-amber-700">Waiting for the feedback giver’s reply.</p> : null}
      {notice ? <p className="mt-3 text-sm font-medium text-red-700">{notice}</p> : null}
    </section>
  );
}

function FeedbackHistory({ request }) {
  const history = [{
    id: "created",
    title: "Request created",
    description: `${request.requesterName} asked ${request.giverName} for feedback`,
    time: request.createdAt,
  }];
  const submittedAt = request.answers?.[0]?.createdAt;
  if (submittedAt) {
    history.push({
      id: "submitted",
      title: "Feedback submitted",
      description: `${request.giverName} submitted feedback`,
      time: submittedAt,
    });
  }
  if (request.acknowledgedAt) {
    history.push({
      id: "acknowledged",
      title: "Feedback acknowledged",
      description: `${request.requesterName} acknowledged the feedback`,
      time: request.acknowledgedAt,
    });
  }
  (request.followUps || []).forEach((followUp) => {
    history.push({
      id: `follow-up-created-${followUp.id}`,
      title: "Follow-up created",
      description: `${request.requesterName} assigned an action to ${followUp.ownerName}: ${followUp.details}`,
      time: followUp.createdAt,
    });
    if (followUp.completedAt) {
      history.push({
        id: `follow-up-completed-${followUp.id}`,
        title: "Follow-up completed",
        description: `${followUp.ownerName} completed the follow-up action`,
        time: followUp.completedAt,
      });
    }
  });
  if (request.status === "closed") {
    history.push({
      id: "closed",
      title: "Feedback completed",
      description: `${request.requesterName} completed this feedback process`,
      time: request.updatedAt,
      tone: "green",
    });
  }
  if (request.status === "cancelled") {
    history.push({
      id: "cancelled",
      title: "Request cancelled",
      description: `${request.requesterName} cancelled this feedback request`,
      time: request.updatedAt,
      tone: "red",
    });
  }
  if (request.status === "declined") {
    history.push({
      id: "declined",
      title: "Request declined",
      description: `${request.giverName} declined this feedback request${request.declineReason ? `: ${request.declineReason}` : ""}${request.alternateGiverName ? `. Suggested reviewer: ${request.alternateGiverName}` : ""}`,
      time: request.updatedAt,
      tone: "red",
    });
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
      <p className="font-semibold text-slate-900">Request timeline</p>
      <ol className="mt-4 grid gap-4 border-l-2 border-blue-200 pl-5">
        {history
          .filter((item) => item.time)
          .sort((first, second) => new Date(first.time) - new Date(second.time))
          .map((item) => (
            <li className="relative" key={item.id}>
              <span className={`absolute -left-[1.95rem] top-1 h-4 w-4 rounded-full border-2 border-white ${item.tone === "red" ? "bg-red-500" : item.tone === "green" ? "bg-emerald-500" : item.tone === "orange" ? "bg-amber-500" : "bg-blue-600"}`} />
              <p className="font-semibold text-slate-900">{item.title}</p>
              <p className="mt-1 text-sm text-slate-600">{item.description}</p>
              <p className="mt-1 text-xs font-medium text-slate-500">{formatHistoryTime(item.time)}</p>
            </li>
          ))}
      </ol>
    </section>
  );
}

function FollowUpModal({ request, onClose, onSubmit }) {
  const [details, setDetails] = useState("");
  const [ownerId, setOwnerId] = useState(String(request.requesterId));
  const [dueDate, setDueDate] = useState("");
  const [participantIds, setParticipantIds] = useState([]);
  const [notice, setNotice] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const today = new Date().toISOString().slice(0, 10);
  const people = [...new Map([
    { id: request.requesterId, name: request.requesterName },
    { id: request.giverId, name: request.giverName },
    { id: request.receiverId, name: request.receiverName },
    ...(request.viewers || []),
  ].map((person) => [person.id, person])).values()];
  async function submit(event) {
    event.preventDefault();
    if (details.trim().length < 3) return setNotice("Please add at least 3 characters.");
    setIsSaving(true); setNotice("");
    const saved = await onSubmit({ details, ownerId: Number(ownerId), dueDate, participantIds });
    if (!saved) setIsSaving(false);
  }
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm">
      <section className="w-full max-w-lg rounded-3xl bg-white p-7 shadow-[0_28px_90px_rgba(15,23,42,0.35)] sm:p-8">
        <p className="text-sm font-bold uppercase tracking-[0.14em] text-amber-600">Optional follow-up</p>
        <h2 className="mt-2 text-2xl font-extrabold text-slate-950">Create follow-up action</h2>
        <form className="mt-6 grid gap-4" onSubmit={submit}>
          <Field label="Action or discussion details"><textarea className={`${fieldClass} min-h-28`} value={details} maxLength={500} onChange={(event) => setDetails(event.target.value)} placeholder="Example: Discuss the feedback in next week's meeting." required /></Field>
          <Field label="Owner"><select className={fieldClass} value={ownerId} onChange={(event) => setOwnerId(event.target.value)}>{people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></Field>
          <Field label="Discussion participants (optional)">
            <div className="grid gap-2 rounded-xl border border-line bg-slate-50 p-3">
              {people.filter((person) => person.id !== Number(ownerId)).map((person) => <label className="flex items-center gap-3 rounded-lg px-2 py-1 text-sm font-medium text-slate-700" key={person.id}><input type="checkbox" checked={participantIds.includes(person.id)} onChange={(event) => setParticipantIds((ids) => event.target.checked ? [...ids, person.id] : ids.filter((id) => id !== person.id))} />{person.name}</label>)}
            </div>
            <p className="text-sm font-normal text-muted">Selected people receive an in-app notification about this follow-up.</p>
          </Field>
          <Field label="Due date (optional)"><input className={fieldClass} type="date" min={today} value={dueDate} onChange={(event) => setDueDate(event.target.value)} /></Field>
          {notice ? <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{notice}</p> : null}
          <div className="flex justify-end gap-3"><button className={secondaryButton} type="button" onClick={onClose}>Cancel</button><button className={primaryButton} disabled={isSaving} type="submit">{isSaving ? "Creating…" : "Create follow-up"}</button></div>
        </form>
      </section>
    </div>
  );
}

function FollowUpCard({ followUp, request, currentUserId, onUpdate }) {
  const [status, setStatus] = useState(followUp.status);
  const [progressNote, setProgressNote] = useState(followUp.progressNote || "");
  const [isSaving, setIsSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const canUpdate = [followUp.ownerId, request.requesterId].some((userId) => Number(userId) === Number(currentUserId)) && followUp.status !== "completed";
  async function save() {
    setIsSaving(true);
    setNotice("");
    const wasSaved = await onUpdate(request.id, followUp.id, { status, progressNote });
    setNotice(wasSaved ? "Follow-up saved." : "Follow-up could not be saved. Please try again.");
    setIsSaving(false);
  }
  const overdueLabel = followUp.overdueDays === 1 ? "Overdue by 1 day" : `Overdue by ${followUp.overdueDays} days`;
  return <div className={`rounded-lg border bg-white p-3 text-sm ${followUp.isOverdue ? "border-orange-300" : "border-amber-100"}`}><div className="flex flex-wrap items-center justify-between gap-2"><p className="font-semibold text-slate-900">{followUp.details}</p>{followUp.isOverdue ? <span className="rounded-full bg-orange-100 px-2 py-1 text-xs font-bold text-orange-700">{overdueLabel}</span> : null}</div><p className="mt-1 text-muted">Owner: {followUp.ownerName} · Due: {formatDueDate(followUp.dueDate)}</p>{canUpdate ? <div className="mt-3 grid gap-2 sm:grid-cols-[150px_1fr_auto]"><select className="field-control py-2" value={status} onChange={(event) => setStatus(event.target.value)}><option value="open">Open</option><option value="in_progress">In progress</option><option value="completed">Completed</option></select><input className="field-control py-2" value={progressNote} maxLength={500} onChange={(event) => setProgressNote(event.target.value)} placeholder="Progress note (optional)"/><button className={secondaryButton} type="button" disabled={isSaving} onClick={() => void save()}>{isSaving ? "Saving…" : "Save"}</button></div> : <p className="mt-2 font-semibold text-amber-700">{followUp.status.replace("_", " ")}</p>}{notice ? <p className={`mt-2 font-medium ${notice === "Follow-up saved." ? "text-emerald-700" : "text-red-700"}`}>{notice}</p> : null}{!canUpdate && followUp.progressNote ? <p className="mt-2 text-muted">Note: {followUp.progressNote}</p> : null}</div>;
}

function RequestActions({ row, currentUserId, onView, onAction, onEditDueDate }) {
  const isGiver = Number(row.giverId) === Number(currentUserId);
  const isRequester = Number(row.requesterId) === Number(currentUserId);
  const isReceiver = Number(row.receiverId) === Number(currentUserId);
  const buttonClass = "rounded-md border border-blue-200 px-4 py-2 text-sm font-semibold text-blue-700 transition hover:bg-blue-50";
  const destructiveButtonClass = "rounded-md border border-red-200 px-4 py-2 text-sm font-semibold text-red-700 transition hover:bg-red-50";

  if (isGiver && ["requested", "in_progress", "overdue"].includes(row.status)) {
    return (
      <div className="flex gap-2">
        <button className={buttonClass} type="button" onClick={onView}>Fill</button>
        <button className={destructiveButtonClass} type="button" onClick={() => onAction("decline")}>Decline</button>
      </div>
    );
  }

  if (isRequester && ["requested", "in_progress", "overdue"].includes(row.status)) {
    return (
      <div className="flex gap-2">
        <button className={buttonClass} type="button" onClick={onEditDueDate}>Edit due date</button>
        <button className={destructiveButtonClass} type="button" onClick={() => onAction("cancel")}>Cancel</button>
      </div>
    );
  }

  if (isReceiver && ["requested", "in_progress", "overdue"].includes(row.status)) {
    return (
      <div className="flex gap-2">
        <button className={buttonClass} type="button" onClick={onView}>View</button>
        <button className={destructiveButtonClass} type="button" onClick={() => onAction("decline")}>Decline</button>
      </div>
    );
  }

  if (isReceiver && row.status === "submitted") {
    return (
      <div className="flex gap-2">
        <button className={buttonClass} type="button" onClick={onView}>View Feedback</button>
        <button className={buttonClass} type="button" onClick={() => onAction("acknowledge")}>Acknowledge</button>
      </div>
    );
  }

  if ((isRequester || isReceiver) && ["acknowledged", "follow_up_needed"].includes(row.status)) {
    return (
      <div className="flex gap-2">
        <button className={buttonClass} type="button" onClick={onView}>View Feedback</button>
        {row.hasOpenFollowUps ? <span className="self-center text-xs font-medium text-amber-700">Complete follow-up first</span> : <button className={buttonClass} type="button" onClick={() => onAction("close")}>Close</button>}
      </div>
    );
  }

  return <button className={buttonClass} type="button" onClick={onView}>View</button>;
}

function Avatar({ initials, small = false }) {
  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-full bg-purple-100 font-semibold text-purple-700 ${
        small ? "h-8 w-8 text-sm" : "h-12 w-12 text-base"
      }`}
    >
      {initials}
    </span>
  );
}

function statusClass(status) {
  const base = "status-pill";
  if (status === "submitted") return `${base} bg-green-100 text-green-700`;
  if (status === "acknowledged") return `${base} bg-violet-100 text-violet-700`;
  if (status === "follow_up_needed") return `${base} bg-amber-100 text-amber-800`;
  if (status === "closed") return `${base} bg-emerald-100 text-emerald-700`;
  if (status === "in_progress") return `${base} bg-cyan-100 text-cyan-800`;
  if (status === "overdue") return `${base} bg-amber-100 text-amber-800`;
  if (status === "declined" || status === "cancelled") return `${base} bg-red-100 text-red-700`;
  return `${base} bg-blue-50 text-blue-700`;
}

function toTableRow(request) {
  return {
    id: request.id,
    requesterName: request.requesterName,
    requesterId: request.requesterId,
    requesterEmail: "",
    requesterInitials: initialsForName(request.requesterName),
    giverId: request.giverId,
    giverName: request.giverName,
    giverInitials: initialsForName(request.giverName),
    receiverId: request.receiverId,
    templateId: request.templateId,
    rawPurpose: request.purpose,
    alternateGiverId: request.alternateGiverId,
    alternateGiverName: request.alternateGiverName,
    type: request.templateName,
    purpose: formatPurpose(request.purpose),
    dueDate: formatDueDate(request.dueDate),
    rawDueDate: request.dueDate,
    hasOpenFollowUps: Boolean(request.hasOpenFollowUps),
    status: request.status,
    declineReason: request.declineReason,
  };
}

function formatVisibility(visibility) {
  if (visibility === "mentor_lead") return "Shared with one mentor or lead";
  if (visibility === "selected_group") return "Shared with the selected group";
  return "Private — visible only to requester and feedback giver";
}

function formatPurpose(purpose) {
  const labels = {
    growth: "Development and growth",
    project_improvement: "Project improvement",
    one_on_one: "One-on-one discussion",
    appraisal: "Official performance/appraisal record",
  };

  return labels[purpose] || "Not selected";
}

function initialsForName(name = "?") {
  return name.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase();
}

function formatDueDate(dueDate) {
  if (!dueDate) return "No due date";

  const [year, month, day] = dueDate.slice(0, 10).split("-");
  return year && month && day ? `${day}/${month}/${year}` : "No due date";
}

function formatHistoryTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Time unavailable";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  }).format(date);
}
