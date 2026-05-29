// ── Phunk Olhor AI — script.js ──
// Ganti API_BASE_URL dengan URL Railway backend Anda setelah deploy
// Contoh: const API_BASE_URL = "https://phunk-olhor-ai.up.railway.app";
const API_BASE_URL = "https://phunkai-backend-production.up.railway.app";

// ── State ──
let conversations = [];
let activeId = null;
let isStreaming = false;

// ── DOM refs ──
const sidebar       = document.getElementById("sidebar");
const sidebarOverlay= document.getElementById("sidebarOverlay");
const convList      = document.getElementById("convList");
const chatArea      = document.getElementById("chatArea");
const inputBox      = document.getElementById("inputBox");
const btnSend       = document.getElementById("btnSend");
const convTitleBar  = document.getElementById("convTitleBar");
const btnTheme      = document.getElementById("btnTheme");
const btnMenu       = document.getElementById("btnMenu");
const btnNew        = document.getElementById("btnNew");
const statusBar     = document.getElementById("statusBar");

// ── Theme ──
const savedTheme = localStorage.getItem("theme") || "dark";
document.documentElement.setAttribute("data-theme", savedTheme);
updateThemeIcon();

btnTheme.addEventListener("click", () => {
  const current = document.documentElement.getAttribute("data-theme");
  const next = current === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  localStorage.setItem("theme", next);
  updateThemeIcon();
});

function updateThemeIcon() {
  const isDark = document.documentElement.getAttribute("data-theme") === "dark";
  btnTheme.innerHTML = isDark
    ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>`
    : `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`;
}

// ── Mobile sidebar ──
btnMenu.addEventListener("click", () => {
  sidebar.classList.toggle("open");
  sidebarOverlay.classList.toggle("visible");
});
sidebarOverlay.addEventListener("click", closeSidebar);
function closeSidebar() {
  sidebar.classList.remove("open");
  sidebarOverlay.classList.remove("visible");
}

// ── API helpers ──
async function api(path, options = {}) {
  const res = await fetch(API_BASE_URL + "/api" + path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ── Load conversations ──
async function loadConversations() {
  try {
    conversations = await api("/chat/conversations");
    renderConvList();
  } catch (e) {
    console.error("Failed to load conversations", e);
  }
}

function renderConvList() {
  convList.innerHTML = "";
  if (conversations.length === 0) {
    convList.innerHTML = `<div style="padding:12px 10px;font-size:12px;color:var(--text3);text-align:center;">Belum ada percakapan</div>`;
    return;
  }
  conversations.forEach(c => {
    const el = document.createElement("div");
    el.className = "conv-item" + (c.id === activeId ? " active" : "");
    el.dataset.id = c.id;
    const date = new Date(c.updatedAt).toLocaleDateString("id-ID", { day:"numeric", month:"short", hour:"2-digit", minute:"2-digit" });
    el.innerHTML = `
      <div class="conv-icon"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg></div>
      <div class="conv-info"><div class="conv-name">${escHtml(c.title)}</div><div class="conv-date">${date}</div></div>
      <button class="btn-delete" data-id="${c.id}" title="Hapus">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
      </button>`;
    el.addEventListener("click", e => {
      if (e.target.closest(".btn-delete")) return;
      openConversation(c.id);
      closeSidebar();
    });
    el.querySelector(".btn-delete").addEventListener("click", e => {
      e.stopPropagation();
      deleteConversation(c.id);
    });
    convList.appendChild(el);
  });
}

// ── New conversation ──
btnNew.addEventListener("click", () => {
  activeId = null;
  showWelcome();
  document.querySelectorAll(".conv-item").forEach(el => el.classList.remove("active"));
  convTitleBar.textContent = "IDLE_STATE";
  closeSidebar();
});

// ── Open conversation ──
async function openConversation(id) {
  activeId = id;
  const conv = conversations.find(c => c.id === id);
  convTitleBar.textContent = conv ? conv.title.toUpperCase() : "SESSION";
  document.querySelectorAll(".conv-item").forEach(el => el.classList.toggle("active", el.dataset.id == id));
  chatArea.innerHTML = "";
  try {
    const data = await api(`/chat/conversations/${id}`);
    data.messages.forEach(m => appendMessage(m.role, m.content, false));
    scrollBottom();
  } catch (e) {
    showError("Gagal memuat percakapan.");
  }
}

// ── Delete conversation ──
async function deleteConversation(id) {
  try {
    await api(`/chat/conversations/${id}`, { method: "DELETE" });
    conversations = conversations.filter(c => c.id !== id);
    if (activeId === id) {
      activeId = null;
      showWelcome();
      convTitleBar.textContent = "IDLE_STATE";
    }
    renderConvList();
  } catch (e) {
    showError("Gagal menghapus percakapan.");
  }
}

// ── Send message ──
btnSend.addEventListener("click", sendMessage);
inputBox.addEventListener("keydown", e => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
});
inputBox.addEventListener("input", () => {
  inputBox.style.height = "auto";
  inputBox.style.height = Math.min(inputBox.scrollHeight, 160) + "px";
});

async function sendMessage() {
  const content = inputBox.value.trim();
  if (!content || isStreaming) return;

  if (!activeId) {
    const title = content.slice(0, 40) + (content.length > 40 ? "..." : "");
    try {
      const conv = await api("/chat/conversations", { method: "POST", body: JSON.stringify({ title }) });
      activeId = conv.id;
      conversations.unshift(conv);
      renderConvList();
      document.querySelectorAll(".conv-item").forEach(el => el.classList.toggle("active", el.dataset.id == activeId));
      convTitleBar.textContent = conv.title.toUpperCase();
      chatArea.innerHTML = "";
    } catch (e) {
      showError("Gagal membuat percakapan baru."); return;
    }
  }

  inputBox.value = "";
  inputBox.style.height = "auto";
  appendMessage("user", content, false);

  isStreaming = true;
  btnSend.disabled = true;
  statusBar.textContent = "SYSTEM_READY // PROCESSING // PHUNK_PROTOCOL_V1";

  const typingEl = document.createElement("div");
  typingEl.className = "msg assistant";
  typingEl.innerHTML = `
    <div class="msg-avatar"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M9 9h.01M15 9h.01M9 15h6"/></svg></div>
    <div class="msg-bubble"><div class="typing-dots"><span></span><span></span><span></span></div></div>`;
  chatArea.appendChild(typingEl);
  scrollBottom();

  let fullText = "";
  let aiBubble = null;

  try {
    const response = await fetch(API_BASE_URL + `/api/chat/conversations/${activeId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        try {
          const data = JSON.parse(line.slice(6));
          if (data.content) {
            if (!aiBubble) {
              typingEl.remove();
              const msgEl = appendMessage("assistant", "", true);
              aiBubble = msgEl.querySelector(".msg-bubble");
            }
            fullText += data.content;
            aiBubble.innerHTML = renderMarkdown(fullText);
            scrollBottom();
          }
          if (data.done) break;
          if (data.error) throw new Error(data.error);
        } catch {}
      }
    }
  } catch (e) {
    typingEl.remove();
    showError("Gagal mendapatkan respons AI. Coba lagi.");
  } finally {
    isStreaming = false;
    btnSend.disabled = false;
    statusBar.textContent = "SYSTEM_READY // SECURE_CONNECTION // PHUNK_PROTOCOL_V1";
    await loadConversations();
  }
}

function appendMessage(role, content, returnEl) {
  const el = document.createElement("div");
  el.className = `msg ${role}`;
  if (role === "user") {
    el.innerHTML = `<div class="msg-avatar">U</div><div class="msg-bubble">${escHtml(content)}</div>`;
  } else {
    el.innerHTML = `
      <div class="msg-avatar"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M9 9h.01M15 9h.01M9 15h6"/></svg></div>
      <div class="msg-bubble">${content ? renderMarkdown(content) : ""}</div>`;
  }
  chatArea.appendChild(el);
  scrollBottom();
  if (returnEl) return el;
}

function showWelcome() {
  chatArea.innerHTML = `
    <div class="welcome">
      <div class="welcome-icon"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M9 9h.01M15 9h.01M9 15h6"/></svg></div>
      <h1>PHUNK_OLHOR_AI</h1>
      <p>Raw, precise, unrestricted intelligence. Initialize a session to begin.</p>
      <button class="btn-init" id="btnInit">[INITIALIZE]</button>
    </div>`;
  document.getElementById("btnInit").addEventListener("click", () => inputBox.focus());
}

function showError(msg) {
  const el = document.createElement("div");
  el.className = "error-msg";
  el.textContent = msg;
  chatArea.appendChild(el);
  scrollBottom();
  setTimeout(() => el.remove(), 5000);
}

function scrollBottom() { chatArea.scrollTop = chatArea.scrollHeight; }

function escHtml(str) {
  return str.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

function renderMarkdown(text) {
  let html = escHtml(text);
  html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => `<pre><code>${code.trim()}</code></pre>`);
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/__(.+?)__/g, "<strong>$1</strong>");
  html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");
  html = html.replace(/^### (.+)$/gm, "<h3>$1</h3>");
  html = html.replace(/^## (.+)$/gm, "<h2>$1</h2>");
  html = html.replace(/^# (.+)$/gm, "<h1>$1</h1>");
  html = html.replace(/^\s*[-*] (.+)$/gm, "<li>$1</li>");
  html = html.split(/\n{2,}/).map(p => {
    p = p.trim();
    if (!p) return "";
    if (p.startsWith("<h") || p.startsWith("<ul") || p.startsWith("<pre") || p.startsWith("<li")) return p;
    return `<p>${p.replace(/\n/g, "<br>")}</p>`;
  }).join("\n");
  return html;
}

showWelcome();
loadConversations();
