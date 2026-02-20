/* eslint-disable no-alert */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const STORAGE_KEY = "nova_ai_v1";

function nowIso() {
  return new Date().toISOString();
}

function uid(prefix = "id") {
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

function formatDateTimeLocal(isoOrMs) {
  const d = typeof isoOrMs === "number" ? new Date(isoOrMs) : new Date(isoOrMs);
  return d.toLocaleString(undefined, {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function toast(title, body, actions = []) {
  const root = $("#toastRoot");
  const el = document.createElement("div");
  el.className = "toast";
  el.innerHTML = `
    <div class="toast__title">${escapeHtml(title)}</div>
    <div class="toast__body">${escapeHtml(body)}</div>
    <div class="toast__actions"></div>
  `;
  const actionsRoot = $(".toast__actions", el);
  for (const a of actions) {
    const b = document.createElement("button");
    b.className = `btn ${a.variant || "btn--ghost"}`;
    b.type = "button";
    b.textContent = a.label;
    b.addEventListener("click", () => a.onClick?.(el));
    actionsRoot.appendChild(b);
  }
  root.appendChild(el);
  setTimeout(() => el.remove(), 5200);
}

function openModal({ title, body, onSpeak }) {
  const modalRoot = $("#modalRoot");
  $("#modalTitle").textContent = title;
  $("#modalBody").innerHTML = body;
  $("#modalSpeak").onclick = onSpeak || null;

  modalRoot.classList.remove("hidden");
  modalRoot.setAttribute("aria-hidden", "false");
}

function closeModal() {
  const modalRoot = $("#modalRoot");
  modalRoot.classList.add("hidden");
  modalRoot.setAttribute("aria-hidden", "true");
  $("#modalSpeak").onclick = null;
}

function ensureState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) return JSON.parse(raw);

  const seed = {
    users: [],
    sessions: {
      currentUserId: null,
    },
    reminders: [],
    notes: [],
    chats: {}, // userId -> [{role, text, ts}]
    planners: {}, // userId -> lastPlan
    createdAt: nowIso(),
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(seed));
  return seed;
}

function setState(updater) {
  const prev = ensureState();
  const next = typeof updater === "function" ? updater(structuredClone(prev)) : updater;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}

function getCurrentUser() {
  const s = ensureState();
  const id = s.sessions.currentUserId;
  return s.users.find((u) => u.id === id) || null;
}

function requireAuth() {
  const u = getCurrentUser();
  if (!u) {
    location.hash = "#/login";
    return null;
  }
  return u;
}

function setBrandFromUser() {
  const u = getCurrentUser();
  const name = u?.assistantName?.trim() || "NOVA AI";
  document.title = `${name} — Your named assistant`;
  $$(".brand__name").forEach((el) => (el.textContent = name));
}

function navActiveFor(hash) {
  const side = $$(".sideLink");
  side.forEach((a) => a.classList.toggle("sideLink--active", a.getAttribute("href") === hash));
}

function speak(text) {
  try {
    if (!("speechSynthesis" in window)) return false;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1;
    u.pitch = 1;
    u.volume = 1;
    window.speechSynthesis.speak(u);
    return true;
  } catch {
    return false;
  }
}

// Voice Recognition (Speech-to-Text) with Wake Word Detection
let recognition = null;
let wakeWordRecognition = null;
let isListening = false;
let isWakeWordActive = false;
let currentAssistantName = "";

const API_BASE_URL = "http://localhost:3000/api"; // Backend API URL

function initSpeechRecognition(continuous = false, interim = false) {
  if (!("webkitSpeechRecognition" in window) && !("SpeechRecognition" in window)) {
    return null;
  }
  
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const rec = new SpeechRecognition();
  
  rec.continuous = continuous;
  rec.interimResults = interim;
  rec.lang = "en-US";
  
  return rec;
}

// Start continuous listening for wake word (assistant name)
function startWakeWordListening(assistantName) {
  if (isWakeWordActive) return;
  
  currentAssistantName = assistantName.toLowerCase().trim();
  const wakeWords = [
    `hey ${currentAssistantName}`,
    `hi ${currentAssistantName}`,
    `${currentAssistantName}`,
    `okay ${currentAssistantName}`,
    `ok ${currentAssistantName}`
  ];
  
  if (!wakeWordRecognition) {
    wakeWordRecognition = initSpeechRecognition(true, true);
    if (!wakeWordRecognition) {
      console.warn("Wake word listening not supported");
      return false;
    }
  }
  
  wakeWordRecognition.onresult = (event) => {
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const transcript = event.results[i][0].transcript.toLowerCase().trim();
      
      // Check if wake word is detected
      const detected = wakeWords.some(wakeWord => 
        transcript.includes(wakeWord) || transcript.startsWith(wakeWord)
      );
      
      if (detected && !isListening) {
        console.log("Wake word detected:", transcript);
        stopWakeWordListening();
        // Start active listening for the question
        startActiveListening();
        toast("Listening...", "I'm listening to your question. Speak now!");
        break;
      }
    }
  };
  
  wakeWordRecognition.onerror = (event) => {
    if (event.error !== "no-speech") {
      console.error("Wake word error:", event.error);
    }
  };
  
  wakeWordRecognition.onend = () => {
    // Restart wake word listening if it ended unexpectedly
    if (isWakeWordActive && !isListening) {
      try {
        wakeWordRecognition.start();
      } catch (e) {
        console.error("Failed to restart wake word:", e);
      }
    }
  };
  
  try {
    wakeWordRecognition.start();
    isWakeWordActive = true;
    console.log("Wake word listening started for:", assistantName);
    return true;
  } catch (err) {
    console.error("Failed to start wake word:", err);
    return false;
  }
}

function stopWakeWordListening() {
  if (wakeWordRecognition && isWakeWordActive) {
    try {
      wakeWordRecognition.stop();
    } catch (e) {
      console.error("Error stopping wake word:", e);
    }
    isWakeWordActive = false;
  }
}

// Start active listening for the actual question
function startActiveListening() {
  if (isListening) return;
  
  if (!recognition) {
    recognition = initSpeechRecognition(false, false);
    if (!recognition) {
      toast("Error", "Speech recognition not supported");
      return false;
    }
  }
  
  recognition.onresult = (event) => {
    const transcript = event.results[0][0].transcript.trim();
    if (transcript) {
      // Process the question through backend API
      processQuestionWithBackend(transcript);
    }
    // Restart wake word listening after processing
    setTimeout(() => {
      const u = getCurrentUser();
      if (u) {
        startWakeWordListening(getAssistantNameForUser(u));
      }
    }, 500);
  };
  
  recognition.onerror = (event) => {
    let errorMsg = "Speech recognition error.";
    if (event.error === "no-speech") {
      errorMsg = "No speech detected.";
    } else if (event.error === "not-allowed") {
      errorMsg = "Microphone permission denied.";
    }
    toast("Voice Error", errorMsg);
    isListening = false;
    // Restart wake word listening
    const u = getCurrentUser();
    if (u) {
      startWakeWordListening(getAssistantNameForUser(u));
    }
  };
  
  recognition.onend = () => {
    isListening = false;
  };
  
  try {
    recognition.start();
    isListening = true;
    return true;
  } catch (err) {
    console.error("Failed to start active listening:", err);
    return false;
  }
}

function startVoiceInput(onResult, onError) {
  if (isListening) {
    stopVoiceInput();
    return;
  }
  
  if (!recognition) {
    recognition = initSpeechRecognition(false, false);
    if (!recognition) {
      onError?.("Speech recognition not supported in this browser. Try Chrome or Edge.");
      return false;
    }
  }
  
  recognition.onresult = (event) => {
    const transcript = event.results[0][0].transcript;
    onResult?.(transcript);
    isListening = false;
  };
  
  recognition.onerror = (event) => {
    let errorMsg = "Speech recognition error.";
    if (event.error === "no-speech") {
      errorMsg = "No speech detected. Try again.";
    } else if (event.error === "not-allowed") {
      errorMsg = "Microphone permission denied. Please allow microphone access.";
    } else if (event.error === "network") {
      errorMsg = "Network error. Check your connection.";
    }
    onError?.(errorMsg);
    isListening = false;
  };
  
  recognition.onend = () => {
    isListening = false;
  };
  
  try {
    recognition.start();
    isListening = true;
    return true;
  } catch (err) {
    onError?.("Failed to start voice input. " + (err.message || ""));
    return false;
  }
}

function stopVoiceInput() {
  if (recognition && isListening) {
    recognition.stop();
    isListening = false;
  }
}

// Format question for AI (exam-style prompts)
function formatQuestionForAI(userInput) {
  const lower = userInput.toLowerCase();

  if (lower.includes("define")) {
    return `Give a short and exact definition (3-5 lines only).\n\n${userInput}`;
  }

  if (lower.includes("10 marks")) {
    return `Answer in exam format for 10 marks with headings and bullet points.\n\n${userInput}`;
  }

  if (lower.includes("explain")) {
    return `Explain clearly in structured bullet points.\n\n${userInput}`;
  }

  if (
    lower.includes("java") ||
    lower.includes("code") ||
    lower.includes("program")
  ) {
    return `Provide exact code with short explanation.\n\n${userInput}`;
  }

  return `Answer clearly and precisely.\n\n${userInput}`;
}

// Call backend API for AI response
async function processQuestionWithBackend(question) {
  const u = getCurrentUser();
  if (!u) return;
  
  const an = getAssistantNameForUser(u);
  const formattedQuestion = formatQuestionForAI(question);
  
  // Add user message to chat
  pushChat(u.id, { role: "me", text: question, ts: Date.now() });
  
  // Show loading indicator
  const loadingMsg = { role: "ai", text: `${an}: Thinking...`, ts: Date.now() };
  pushChat(u.id, loadingMsg);
  render();
  
  try {
    const response = await fetch(`${API_BASE_URL}/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        question: formattedQuestion,
        assistantName: an,
        userId: u.id,
      }),
    });
    
    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }
    
    const data = await response.json();
    const answer = data.answer || `${an}: ${data.message || "I couldn't process that request."}`;
    
    // Remove loading message and add real answer
    setState((s) => {
      if (s.chats[u.id]) {
        s.chats[u.id] = s.chats[u.id].filter(m => m.text !== loadingMsg.text);
        s.chats[u.id].push({ role: "ai", text: answer, ts: Date.now() });
      }
      return s;
    });
    
    render();
    
    // Optional: Speak the answer
    speak(answer.replace(`${an}:`, "").trim());
    
  } catch (error) {
    console.error("Backend API error:", error);
    
    // Fallback to local AI response
    const fallbackAnswer = aiStyleAnswer(question, an);
    
    setState((s) => {
      if (s.chats[u.id]) {
        s.chats[u.id] = s.chats[u.id].filter(m => m.text !== loadingMsg.text);
        s.chats[u.id].push({ role: "ai", text: fallbackAnswer, ts: Date.now() });
      }
      return s;
    });
    
    render();
    toast("Using offline mode", "Backend unavailable. Using local responses.");
  }
}

async function ensureNotificationsPermission() {
  if (!("Notification" in window)) return "unsupported";
  if (Notification.permission === "granted") return "granted";
  if (Notification.permission === "denied") return "denied";
  const res = await Notification.requestPermission();
  return res;
}

function notify(title, body) {
  if (!("Notification" in window)) return false;
  if (Notification.permission !== "granted") return false;
  const n = new Notification(title, { body });
  setTimeout(() => n.close?.(), 7000);
  return true;
}

function nextReminderPollMs() {
  return 1500;
}

function getAssistantNameForUser(user) {
  return user?.assistantName?.trim() || "NOVA";
}

function getUserChat(userId) {
  const s = ensureState();
  return s.chats[userId] || [];
}

function pushChat(userId, msg) {
  setState((s) => {
    s.chats[userId] ||= [];
    s.chats[userId].push(msg);
    if (s.chats[userId].length > 200) s.chats[userId] = s.chats[userId].slice(-200);
    return s;
  });
}

function addNote(userId, title, content) {
  setState((s) => {
    s.notes.unshift({
      id: uid("note"),
      userId,
      title,
      content,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    });
    return s;
  });
}

function deleteNote(noteId) {
  setState((s) => {
    s.notes = s.notes.filter((n) => n.id !== noteId);
    return s;
  });
}

function addReminder(userId, atMs, title, reason) {
  setState((s) => {
    s.reminders.push({
      id: uid("rem"),
      userId,
      atMs,
      title,
      reason,
      fired: false,
      createdAt: nowIso(),
    });
    return s;
  });
}

function deleteReminder(remId) {
  setState((s) => {
    s.reminders = s.reminders.filter((r) => r.id !== remId);
    return s;
  });
}

function updateReminder(remId, patch) {
  setState((s) => {
    const r = s.reminders.find((x) => x.id === remId);
    if (r) Object.assign(r, patch);
    return s;
  });
}

function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email).trim());
}

function hashPass(p) {
  // MVP-only: lightweight obfuscation, not real security.
  let h = 0;
  const s = String(p);
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return `h_${h.toString(16)}`;
}

function signup({ email, password, assistantName, displayName }) {
  email = String(email).trim().toLowerCase();
  assistantName = String(assistantName).trim();
  displayName = String(displayName).trim();

  if (!validateEmail(email)) throw new Error("Please enter a valid email.");
  if (password.length < 6) throw new Error("Password must be at least 6 characters.");
  if (!assistantName) throw new Error("Assistant name is required.");

  const newUser = {
    id: uid("user"),
    email,
    passHash: hashPass(password),
    assistantName,
    displayName: displayName || email.split("@")[0],
    createdAt: nowIso(),
  };

  setState((s) => {
    if (s.users.some((u) => u.email === email)) throw new Error("Email already exists. Try login.");
    s.users.push(newUser);
    s.sessions.currentUserId = newUser.id;
    return s;
  });
  setBrandFromUser();
}

function login({ email, password }) {
  email = String(email).trim().toLowerCase();
  const passHash = hashPass(password);
  const s = ensureState();
  const user = s.users.find((u) => u.email === email && u.passHash === passHash);
  if (!user) throw new Error("Invalid email or password.");
  setState((x) => {
    x.sessions.currentUserId = user.id;
    return x;
  });
  setBrandFromUser();
}

function logout() {
  setState((s) => {
    s.sessions.currentUserId = null;
    return s;
  });
  setBrandFromUser();
  location.hash = "#/";
}

function getDemoUser() {
  const email = "demo@student.ai";
  const s = ensureState();
  const existing = s.users.find((u) => u.email === email);
  if (existing) return existing;

  const demo = {
    id: uid("user"),
    email,
    passHash: hashPass("demopass"),
    assistantName: "MAYA",
    displayName: "Demo Student",
    createdAt: nowIso(),
  };
  setState((x) => {
    x.users.push(demo);
    return x;
  });
  return demo;
}

function startDemo() {
  const u = getDemoUser();
  setState((s) => {
    s.sessions.currentUserId = u.id;
    return s;
  });
  setBrandFromUser();
  location.hash = "#/app/home";
}

function pageShell({ title, subtitle, right }) {
  return `
    <div class="container">
      <div class="section">
        <div class="content__head">
          <div>
            <h1 class="content__title">${escapeHtml(title)}</h1>
            ${subtitle ? `<div class="content__subtitle">${escapeHtml(subtitle)}</div>` : ""}
          </div>
          ${right || ""}
        </div>
      </div>
    </div>
  `;
}

function landingPage() {
  const u = getCurrentUser();
  const assistantName = getAssistantNameForUser(u) || "NOVA";
  const cta = u
    ? `<a class="btn btn--primary" href="#/app/home">Open dashboard</a>`
    : `<a class="btn btn--primary" href="#/signup">Create assistant</a>`;

  return `
    <section class="hero">
      <div class="container hero__inner">
        <div class="card hero__panel">
          <div class="kicker">Student + daily life</div>
          <h1>Meet your AI assistant. Name it. Talk to it. Grow daily.</h1>
          <p>
            Build <b>${escapeHtml(assistantName)}</b> — your personal study buddy for explanations, notes, planning, and
            smart reminders that speak the reason when it’s time.
          </p>
          <div class="hero__cta">
            ${cta}
            <a class="btn btn--ghost" href="#/pricing">See pricing</a>
            <button class="btn btn--ghost" type="button" id="btnEnableNotif">Enable reminders</button>
          </div>
          <div class="hr"></div>
          <div class="row">
            <span class="pill"><b>Chat</b> notes + explanations</span>
            <span class="pill"><b>Planner</b> day-wise schedule</span>
            <span class="pill"><b>Reminders</b> with reason + voice</span>
          </div>
        </div>
        <div class="card hero__panel">
          <div class="kicker">How it works</div>
          <div class="list">
            <div class="item">
              <div>
                <div class="item__title">1) Create your assistant</div>
                <div class="item__sub">Pick a name like MAYA / NOVA / RAJU. It becomes your app personality.</div>
              </div>
              <div class="chip">30 sec</div>
            </div>
            <div class="item">
              <div>
                <div class="item__title">2) Study faster</div>
                <div class="item__sub">Ask anything. Get explanations, notes in points, and code examples.</div>
              </div>
              <div class="chip">Daily</div>
            </div>
            <div class="item">
              <div>
                <div class="item__title">3) Stay on track</div>
                <div class="item__sub">Add reminders with reasons. When time comes, your AI speaks it out.</div>
              </div>
              <div class="chip">Smart</div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <section class="section">
      <div class="container">
        <div class="kicker">Features</div>
        <h2>Everything you need for a strong MVP</h2>
        <div class="grid grid--3">
          ${featureCard("Student AI Chat", "Ask questions, get explanations, notes in points, and code examples.")}
          ${featureCard("Smart Reminders", "Add a reminder with a reason. Popup + voice reads the reason on time.")}
          ${featureCard("Daily Study Planner", "Enter exam date + syllabus topics. Get a day-wise plan you can follow.")}
          ${featureCard("Notes Vault", "Save important notes, formulas, and summaries. Keep it organized.")}
          ${featureCard("Profile & Settings", "Change assistant name, manage reminder permissions, export data.")}
          ${featureCard("V2 Ready", "WhatsApp, voice chat, memory, mock interviews, streaks, parent mode.")}
        </div>
      </div>
    </section>

    <section class="section">
      <div class="container">
        <div class="grid grid--2">
          <div class="card card__pad">
            <div class="kicker">Testimonials</div>
            <h2>Designed like Notion. Built for students.</h2>
            <div class="muted">This MVP is offline-first (local storage) so you can run it immediately.</div>
            <div class="hr"></div>
            <div class="muted2">Tip: use the Demo account to explore the dashboard quickly.</div>
          </div>
          <div class="card card__pad">
            <div class="kicker">Get started</div>
            <h2>Create your assistant in 1 minute</h2>
            <div class="row">
              <a class="btn btn--primary" href="#/signup">Create assistant</a>
              <a class="btn btn--ghost" href="#/login">Login</a>
            </div>
            <div class="hr"></div>
            <div class="muted2">Want instant access? Click “Try demo” in the top right.</div>
          </div>
        </div>
      </div>
    </section>
  `;
}

function featureCard(title, desc) {
  return `
    <div class="card card__pad">
      <div class="badge">MVP</div>
      <div style="height:10px"></div>
      <div class="item__title">${escapeHtml(title)}</div>
      <div class="item__sub">${escapeHtml(desc)}</div>
    </div>
  `;
}

function aboutPage() {
  return `
    ${pageShell({
      title: "About",
      subtitle: "A named AI assistant for students, freshers, and busy people.",
    })}
    <div class="container">
      <div class="grid grid--2">
        <div class="card card__pad">
          <div class="kicker">Mission</div>
          <h2>Make daily progress effortless</h2>
          <div class="muted">
            You name your assistant, then use it for study help, reminders, and planning — all in one calm dashboard.
          </div>
        </div>
        <div class="card card__pad">
          <div class="kicker">Roadmap</div>
          <h2>V2 features</h2>
          <div class="list">
            ${roadmapItem("WhatsApp integration", "Send reminders and quick notes on WhatsApp.")}
            ${roadmapItem("Voice chat", "Talk naturally, hands-free.")}
            ${roadmapItem("AI memory", "Long-term preferences and progress.")}
            ${roadmapItem("Mock interviews", "Role-play, feedback, improvement plan.")}
            ${roadmapItem("Study streaks", "Gamified consistency.")}
            ${roadmapItem("Parent mode", "Optional reminders for parents/guardians.")}
          </div>
        </div>
      </div>
    </div>
  `;
}

function roadmapItem(title, desc) {
  return `
    <div class="item">
      <div>
        <div class="item__title">${escapeHtml(title)}</div>
        <div class="item__sub">${escapeHtml(desc)}</div>
      </div>
      <div class="chip chip--soon">Soon</div>
    </div>
  `;
}

function pricingPage() {
  return `
    ${pageShell({ title: "Pricing", subtitle: "Simple for MVP. Upgrade later." })}
    <div class="container">
      <div class="grid grid--3">
        ${pricingCard("Free", "₹0", ["Named assistant", "Planner", "Notes vault", "Local reminders"], "Start free", "#/signup")}
        ${pricingCard("Student+", "₹99/mo", ["Everything in Free", "AI API connect (optional)", "Export data"], "Choose Student+", "#/signup")}
        ${pricingCard("Pro", "₹199/mo", ["Everything in Student+", "Voice chat (V2)", "WhatsApp (V2)"], "Join waitlist", "#/signup")}
      </div>
      <div class="section">
        <div class="card card__pad">
          <div class="kicker">Note</div>
          <h2>AI API keys</h2>
          <div class="muted">
            This MVP runs offline-first. Later, connect OpenAI/Gemini securely from a backend. For now, you can still
            use built-in smart templates for notes, planner, and study explanations.
          </div>
        </div>
      </div>
    </div>
  `;
}

function pricingCard(name, price, bullets, cta, href) {
  return `
    <div class="card card__pad">
      <div class="kicker">${escapeHtml(name)}</div>
      <div style="font-size:32px;font-weight:900;margin:10px 0 6px">${escapeHtml(price)}</div>
      <div class="list">
        ${bullets
          .map(
            (b) => `
          <div class="item">
            <div class="item__title">${escapeHtml(b)}</div>
          </div>
        `
          )
          .join("")}
      </div>
      <div class="hr"></div>
      <a class="btn btn--primary" href="${href}">${escapeHtml(cta)}</a>
    </div>
  `;
}

function privacyPage() {
  return `
    ${pageShell({ title: "Privacy", subtitle: "MVP privacy defaults (local-first)." })}
    <div class="container">
      <div class="card card__pad">
        <div class="muted">
          Your data stays in your browser’s local storage in this MVP. No server is used. If you clear browser data, it
          will reset. In V2, you can add secure login + cloud sync.
        </div>
      </div>
    </div>
  `;
}

function loginPage() {
  const u = getCurrentUser();
  if (u) {
    location.hash = "#/app/home";
    return "";
  }
  return `
    ${pageShell({ title: "Login", subtitle: "Welcome back." })}
    <div class="container">
      <div class="grid grid--2">
        <div class="card card__pad">
          <form id="loginForm" class="grid">
            <div class="field">
              <label>Email</label>
              <input class="input" name="email" type="email" placeholder="you@example.com" required />
            </div>
            <div class="field">
              <label>Password</label>
              <input class="input" name="password" type="password" placeholder="••••••••" required />
            </div>
            <div class="row row--end">
              <a class="btn btn--ghost" href="#/signup">Create account</a>
              <button class="btn btn--primary" type="submit">Login</button>
            </div>
          </form>
          <div class="hr"></div>
          <button class="btn btn--ghost" type="button" id="btnDemoLogin">Use demo account</button>
        </div>
        <div class="card card__pad">
          <div class="kicker">Tip</div>
          <h2>Enable reminders after login</h2>
          <div class="muted">
            On the Reminders page you can allow notifications, then you’ll get a popup + voice reason exactly when time
            comes.
          </div>
        </div>
      </div>
    </div>
  `;
}

function signupPage() {
  const u = getCurrentUser();
  if (u) {
    location.hash = "#/app/home";
    return "";
  }
  return `
    ${pageShell({ title: "Signup", subtitle: "Create your named AI assistant." })}
    <div class="container">
      <div class="grid grid--2">
        <div class="card card__pad">
          <form id="signupForm" class="grid">
            <div class="field">
              <label>Display name (optional)</label>
              <input class="input" name="displayName" type="text" placeholder="Dhana" />
            </div>
            <div class="field">
              <label>Assistant name</label>
              <input class="input" name="assistantName" type="text" placeholder="MAYA / NOVA / RAJU" required />
            </div>
            <div class="field">
              <label>Email</label>
              <input class="input" name="email" type="email" placeholder="you@example.com" required />
            </div>
            <div class="field">
              <label>Password</label>
              <input class="input" name="password" type="password" placeholder="Minimum 6 characters" required />
            </div>
            <div class="row row--end">
              <a class="btn btn--ghost" href="#/login">Login instead</a>
              <button class="btn btn--primary" type="submit">Create assistant</button>
            </div>
          </form>
          <div class="hr"></div>
          <div class="muted2">
            This MVP uses local storage (offline-first). For a real product, move auth to a backend (JWT + DB).
          </div>
        </div>
        <div class="card card__pad">
          <div class="kicker">Example</div>
          <h2>Your assistant personality</h2>
          <div class="muted">
            When you name your assistant, the whole dashboard uses that name. Reminders will say “This is MAYA…” before
            reading the reason.
          </div>
          <div class="hr"></div>
          <div class="pill"><b>Study</b> help + notes</div>
          <div style="height:10px"></div>
          <div class="pill"><b>Career</b> support</div>
          <div style="height:10px"></div>
          <div class="pill"><b>Life</b> reminders</div>
        </div>
      </div>
    </div>
  `;
}

function dashboardLayout(pageHash, contentHtml) {
  const u = requireAuth();
  if (!u) return "";
  const an = getAssistantNameForUser(u);
  setBrandFromUser();
  return `
    <div class="container">
      <div class="dash">
        <aside class="sidebar">
          <div class="sidebar__head">
            <div class="sidebar__meta">
              <div class="sidebar__name">${escapeHtml(an)}</div>
              <div class="sidebar__sub">Logged in as ${escapeHtml(u.displayName)}</div>
            </div>
            <button class="btn btn--ghost" id="btnLogout" type="button">Logout</button>
          </div>
          <div class="card card__pad">
            <nav class="sidebar__nav">
              ${sideLink("#/app/home", "⌂", "Home")}
              ${sideLink("#/app/chat", "✦", "Chat")}
              ${sideLink("#/app/planner", "▦", "Planner")}
              ${sideLink("#/app/reminders", "⏰", "Reminders")}
              ${sideLink("#/app/notes", "✎", "Notes")}
              ${sideLink("#/app/settings", "⚙", "Settings")}
            </nav>
          </div>
        </aside>
        <section class="content">
          ${contentHtml}
        </section>
      </div>
    </div>
    <script>
      (function(){
        const a = document.querySelector('a[href="${pageHash}"]');
        if (a) a.classList.add("sideLink--active");
      })();
    </script>
  `;
}

function sideLink(href, icon, label) {
  return `
    <a class="sideLink" href="${href}">
      <span class="sideLink__left">
        <span class="sideLink__icon">${escapeHtml(icon)}</span>
        <span>${escapeHtml(label)}</span>
      </span>
      <span class="muted2">›</span>
    </a>
  `;
}

function appHomePage() {
  const u = requireAuth();
  if (!u) return "";
  const an = getAssistantNameForUser(u);

  const s = ensureState();
  const reminders = s.reminders
    .filter((r) => r.userId === u.id)
    .sort((a, b) => a.atMs - b.atMs);
  const upcoming = reminders.filter((r) => !r.fired && r.atMs > Date.now()).slice(0, 3);
  const notes = s.notes.filter((n) => n.userId === u.id).slice(0, 3);

  const right = `
    <div class="row">
      <a class="btn btn--primary" href="#/app/chat">Chat now</a>
      <a class="btn btn--ghost" href="#/app/reminders">Add reminder</a>
    </div>
  `;

  const content = `
    <div class="content__head">
      <div>
        <h1 class="content__title">Dashboard</h1>
        <div class="content__subtitle">Welcome. ${escapeHtml(an)} is ready to help you study and stay consistent.</div>
      </div>
      ${right}
    </div>
    <div class="grid grid--2">
      <div class="card card__pad">
        <div class="kicker">Quick actions</div>
        <h2>What do you want to do?</h2>
        <div class="row">
          <a class="btn btn--primary" href="#/app/planner">Create study plan</a>
          <a class="btn btn--ghost" href="#/app/notes">Save notes</a>
          <button class="btn btn--ghost" id="btnAllowNotif" type="button">Allow notifications</button>
        </div>
        <div class="hr"></div>
        <div class="muted2">Reminder voice uses your device’s built-in speech engine.</div>
      </div>
      <div class="card card__pad">
        <div class="kicker">Status</div>
        <h2>Today</h2>
        <div class="list">
          <div class="item">
            <div>
              <div class="item__title">Upcoming reminders</div>
              <div class="item__sub">${upcoming.length ? "You have a few scheduled." : "No upcoming reminders."}</div>
            </div>
            <div class="chip">${escapeHtml(String(upcoming.length))}</div>
          </div>
          <div class="item">
            <div>
              <div class="item__title">Saved notes</div>
              <div class="item__sub">Your vault is building up slowly.</div>
            </div>
            <div class="chip">${escapeHtml(String(notes.length))}</div>
          </div>
        </div>
      </div>
    </div>
    <div class="section">
      <div class="grid grid--2">
        <div class="card card__pad">
          <div class="kicker">Upcoming</div>
          <h2>Next reminders</h2>
          ${upcoming.length ? renderRemindersList(upcoming, { compact: true }) : `<div class="muted">Add one from Reminders.</div>`}
        </div>
        <div class="card card__pad">
          <div class="kicker">Notes</div>
          <h2>Recent notes</h2>
          ${notes.length ? renderNotesList(notes, { compact: true }) : `<div class="muted">Save your first note in Notes.</div>`}
        </div>
      </div>
    </div>
  `;
  return dashboardLayout("#/app/home", content);
}

function renderNotesList(notes, { compact = false } = {}) {
  return `
    <div class="list">
      ${notes
        .map((n) => {
          const sub = compact ? (n.content || "").slice(0, 120) : (n.content || "");
          return `
            <div class="item">
              <div style="min-width:0">
                <div class="item__title">${escapeHtml(n.title || "Untitled")}</div>
                <div class="item__sub">${escapeHtml(sub)}${compact && (n.content || "").length > 120 ? "…" : ""}</div>
              </div>
              <div class="item__right">
                <span class="chip">${escapeHtml(new Date(n.updatedAt).toLocaleDateString())}</span>
                ${compact ? "" : `<button class="btn btn--danger" data-del-note="${escapeHtml(n.id)}" type="button">Delete</button>`}
              </div>
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}

function notesPage() {
  const u = requireAuth();
  if (!u) return "";
  const s = ensureState();
  const notes = s.notes.filter((n) => n.userId === u.id);
  const content = `
    <div class="content__head">
      <div>
        <h1 class="content__title">Notes vault</h1>
        <div class="content__subtitle">Save explanations, formulas, summaries. Search later (V2).</div>
      </div>
    </div>
    <div class="grid grid--2">
      <div class="card card__pad">
        <div class="kicker">New note</div>
        <form id="noteForm" class="grid">
          <div class="field">
            <label>Title</label>
            <input class="input" name="title" type="text" placeholder="e.g., DBMS Normalization" required />
          </div>
          <div class="field">
            <label>Content</label>
            <textarea class="textarea" name="content" placeholder="Write in points…"></textarea>
          </div>
          <div class="row row--end">
            <button class="btn btn--primary" type="submit">Save note</button>
          </div>
        </form>
      </div>
      <div class="card card__pad">
        <div class="kicker">Your notes</div>
        <h2>All notes</h2>
        ${notes.length ? renderNotesList(notes) : `<div class="muted">No notes yet. Save your first one.</div>`}
      </div>
    </div>
  `;
  return dashboardLayout("#/app/notes", content);
}

function renderRemindersList(reminders, { compact = false } = {}) {
  return `
    <div class="list">
      ${reminders
        .map((r) => {
          const when = formatDateTimeLocal(r.atMs);
          const status = r.fired ? "Done" : r.atMs <= Date.now() ? "Due" : "Scheduled";
          return `
            <div class="item">
              <div style="min-width:0">
                <div class="item__title">${escapeHtml(r.title || "Reminder")}</div>
                <div class="item__sub">${escapeHtml(r.reason || "")}</div>
                <div class="item__sub"><span class="badge">${escapeHtml(when)}</span></div>
              </div>
              <div class="item__right">
                <span class="chip">${escapeHtml(status)}</span>
                ${
                  compact
                    ? ""
                    : `
                  <button class="btn btn--ghost" type="button" data-test-rem="${escapeHtml(r.id)}">Test</button>
                  <button class="btn btn--danger" type="button" data-del-rem="${escapeHtml(r.id)}">Delete</button>
                `
                }
              </div>
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}

function remindersPage() {
  const u = requireAuth();
  if (!u) return "";
  const s = ensureState();
  const reminders = s.reminders
    .filter((r) => r.userId === u.id)
    .sort((a, b) => a.atMs - b.atMs);

  const notifState = "Notification" in window ? Notification.permission : "unsupported";
  const content = `
    <div class="content__head">
      <div>
        <h1 class="content__title">Smart reminders</h1>
        <div class="content__subtitle">Add a reminder with a reason. At time, popup + voice reads the reason.</div>
      </div>
      <div class="row">
        <span class="badge">Notifications: ${escapeHtml(notifState)}</span>
        <button class="btn btn--primary" type="button" id="btnAskNotif">Enable notifications</button>
      </div>
    </div>
    <div class="grid grid--2">
      <div class="card card__pad">
        <div class="kicker">New reminder</div>
        <form id="remForm" class="grid">
          <div class="field">
            <label>Title</label>
            <input class="input" name="title" type="text" placeholder="e.g., Study OS - Process Scheduling" required />
          </div>
          <div class="field">
            <label>When</label>
            <input class="input" name="when" type="datetime-local" required />
          </div>
          <div class="field">
            <label>Reason (AI will speak this)</label>
            <textarea class="textarea" name="reason" placeholder="e.g., This topic will be in tomorrow’s test. Do 30 minutes now."></textarea>
          </div>
          <div class="row row--end">
            <button class="btn btn--primary" type="submit">Add reminder</button>
          </div>
        </form>
        <div class="hr"></div>
        <div class="muted2">
          For best results, keep this tab open. V2 can move reminders to server/WhatsApp.
        </div>
      </div>
      <div class="card card__pad">
        <div class="kicker">Scheduled</div>
        <h2>Your reminders</h2>
        ${reminders.length ? renderRemindersList(reminders) : `<div class="muted">No reminders yet.</div>`}
      </div>
    </div>
  `;
  return dashboardLayout("#/app/reminders", content);
}

function aiStyleAnswer(userText, assistantName) {
  const t = userText.trim();
  const lower = t.toLowerCase();

  const isCode = /(java|python|c\+\+|javascript|sql|html|css|react|spring|node|express|programming|code|function|class|variable)/i.test(t);
  const wantsNotes = /(notes|in points|points|bullets|short notes|summary|summarize|brief)/i.test(t);
  const wantsExplain = /(explain|what is|define|meaning|difference|why|how|tell me about|describe)/i.test(t);
  const wantsExample = /(example|sample|show me|demonstrate|illustrate)/i.test(t);

  let header = `${assistantName}:`;
  let body = "";

  if (lower.includes("timetable") || lower.includes("schedule")) {
    body = [
      "Here’s a simple timetable template you can copy:",
      "",
      "- 60 min: Main subject (deep focus)",
      "- 15 min: Break (walk/water)",
      "- 45 min: Practice questions",
      "- 10 min: Quick recap notes",
      "",
      "Tell me your subjects + free hours and I’ll customize it.",
    ].join("\n");
  } else if (lower.includes("career") || lower.includes("resume") || lower.includes("interview")) {
    body = [
      "Career quick-start:",
      "- Pick 1 target role (e.g., Java backend / Frontend / Data)",
      "- Build 2 mini projects with GitHub README",
      "- Prepare 25 core interview questions + 2 mock interviews/week",
      "",
      "Share your branch + semester + current skills and I’ll create a 30-day plan.",
    ].join("\n");
  } else if (wantsNotes) {
    const topic = t.replace(/(notes|in points|points|bullets|short notes|summary|summarize|brief)/gi, "").trim() || "this topic";
    body = [
      `📝 Notes in points for: ${topic}`,
      "",
      "1. Main Concept:",
      `   - Core idea: ${topic}`,
      "   - Why it matters: (explain importance)",
      "",
      "2. Key Points:",
      "   - Point 1: (detail)",
      "   - Point 2: (detail)",
      "   - Point 3: (detail)",
      "   - Point 4: (detail)",
      "",
      "3. Important Definitions:",
      "   - Term 1: Definition",
      "   - Term 2: Definition",
      "",
      "4. Common Mistakes to Avoid:",
      "   - Mistake 1: (explanation)",
      "   - Mistake 2: (explanation)",
      "",
      "5. Quick Self-Test Questions:",
      "   - Q1: ?",
      "   - Q2: ?",
      "   - Q3: ?",
      "",
      "💡 For more detailed notes, tell me the exact topic, class/semester, and what you already know.",
    ].join("\n");
  } else if (isCode) {
    body = [
      "Code example (template):",
      "",
      "1) Explain the goal in 1 line",
      "2) Show a minimal example",
      "3) Mention edge cases",
      "",
      "Tell me the language + exact question and I’ll write the full code.",
    ].join("\n");
  } else if (wantsExplain) {
    body = [
      "Explanation (easy version):",
      `- ${t}`,
      "",
      "To make it perfect, tell me: your grade/semester + what you already know.",
    ].join("\n");
  } else {
    body = [
      "Tell me what you want:",
      "- Explanation",
      "- Notes in points",
      "- Code example",
      "- Planner",
      "- Reminders",
      "",
      `You can say: “${assistantName}, give notes in points for …”`,
    ].join("\n");
  }

  return `${header}\n${body}`;
}

function chatPage() {
  const u = requireAuth();
  if (!u) return "";
  const an = getAssistantNameForUser(u);
  const chat = getUserChat(u.id);
  const voiceSupported = "webkitSpeechRecognition" in window || "SpeechRecognition" in window;

  const content = `
    <div class="content__head">
      <div>
        <h1 class="content__title">Chat with ${escapeHtml(an)}</h1>
        <div class="content__subtitle">Ask questions, get explanations, notes in points, and code examples. ${voiceSupported ? "🎤 Click the mic to speak!" : ""}</div>
      </div>
      <div class="row">
        <button class="btn btn--ghost" type="button" id="btnChatClear">Clear chat</button>
        <button class="btn btn--primary" type="button" id="btnSaveChatAsNote">Save last answer to Notes</button>
      </div>
    </div>
    <div class="card card__pad chat">
      <div class="chat__log" id="chatLog">
        ${chat.length ? chat.map((m) => renderMsg(m, an)).join("") : `<div class="muted">Start by asking something. ${voiceSupported ? "You can type or speak!" : ""}</div>`}
      </div>
      <form class="chat__composer" id="chatForm">
        <textarea class="textarea" name="q" id="chatInput" placeholder="Ask anything… (Shift+Enter for new line)"></textarea>
        <div class="chat__actions">
          ${voiceSupported ? `<button class="btn btn--voice" type="button" id="btnVoiceInput" title="Click to speak">
            <span class="voice-icon">🎤</span>
            <span class="voice-status">Speak</span>
          </button>` : ""}
          <button class="btn btn--primary" type="submit">Send</button>
        </div>
      </form>
      ${voiceSupported ? `<div class="voice-hint muted2" id="voiceHint">Click the microphone button to speak your question</div>` : ""}
    </div>
  `;
  return dashboardLayout("#/app/chat", content);
}

function renderMsg(m, assistantName) {
  const who = m.role === "me" ? "You" : assistantName;
  const cls = m.role === "me" ? "msg msg--me" : "msg msg--ai";
  return `
    <div class="${cls}">
      <div class="msg__meta">
        <span class="badge">${escapeHtml(who)}</span>
        <span>${escapeHtml(new Date(m.ts).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }))}</span>
      </div>
      <div class="msg__bubble">${escapeHtml(m.text)}</div>
    </div>
  `;
}

function plannerPage() {
  const u = requireAuth();
  if (!u) return "";
  const last = ensureState().planners[u.id] || null;
  const content = `
    <div class="content__head">
      <div>
        <h1 class="content__title">Daily planner</h1>
        <div class="content__subtitle">Enter exam date + syllabus topics. Get a day-wise plan.</div>
      </div>
      <div class="row">
        <button class="btn btn--ghost" type="button" id="btnPlannerExport">Export as note</button>
      </div>
    </div>
    <div class="grid grid--2">
      <div class="card card__pad">
        <div class="kicker">Plan input</div>
        <form id="planForm" class="grid">
          <div class="field">
            <label>Exam date</label>
            <input class="input" name="exam" type="date" required />
          </div>
          <div class="field">
            <label>Daily study time (hours)</label>
            <select class="select" name="hours">
              <option value="1">1 hour/day</option>
              <option value="2" selected>2 hours/day</option>
              <option value="3">3 hours/day</option>
              <option value="4">4 hours/day</option>
            </select>
          </div>
          <div class="field">
            <label>Syllabus topics (one per line)</label>
            <textarea class="textarea" name="topics" placeholder="Unit 1: …&#10;Unit 2: …&#10;…"></textarea>
          </div>
          <div class="row row--end">
            <button class="btn btn--primary" type="submit">Create plan</button>
          </div>
        </form>
        <div class="hr"></div>
        <div class="muted2">Tip: include difficulty like “(hard)” or “(easy)” after a topic.</div>
      </div>
      <div class="card card__pad">
        <div class="kicker">Output</div>
        <h2>Day-wise plan</h2>
        <div id="planOut" class="muted">${last ? escapeHtml(last.text) : "Create a plan to see it here."}</div>
      </div>
    </div>
  `;
  return dashboardLayout("#/app/planner", content);
}

function createPlan({ examDateStr, topics, hoursPerDay }) {
  const exam = new Date(examDateStr + "T00:00:00");
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffDays = Math.max(1, Math.ceil((exam - today) / (1000 * 60 * 60 * 24)));

  const cleanTopics = topics
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 60);

  const daysForTopics = Math.max(1, diffDays - 1); // last day revision
  const perDay = Math.max(1, Math.ceil(cleanTopics.length / daysForTopics));

  const lines = [];
  lines.push(`Plan created on ${new Date().toLocaleDateString()} for exam on ${exam.toLocaleDateString()}`);
  lines.push(`Daily study time: ${hoursPerDay} hour(s)`);
  lines.push("");

  for (let d = 0; d < daysForTopics; d++) {
    const date = new Date(today);
    date.setDate(date.getDate() + d);
    const chunk = cleanTopics.slice(d * perDay, (d + 1) * perDay);
    const label = `Day ${d + 1} — ${date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "2-digit" })}`;
    lines.push(label);
    if (chunk.length) {
      for (const t of chunk) lines.push(`- ${t}`);
    } else {
      lines.push("- Buffer / backlog topics");
    }
    lines.push(`- Practice: 10–20 questions`);
    lines.push(`- Notes: 10 min recap`);
    lines.push("");
  }

  const lastDate = new Date(today);
  lastDate.setDate(lastDate.getDate() + daysForTopics);
  lines.push(
    `Final Day — ${lastDate.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "2-digit" })}`
  );
  lines.push("- Full revision: formulas / definitions / key diagrams");
  lines.push("- 1 mock test + review mistakes");
  lines.push("- Sleep early");

  return lines.join("\n");
}

function settingsPage() {
  const u = requireAuth();
  if (!u) return "";
  const content = `
    <div class="content__head">
      <div>
        <h1 class="content__title">Settings</h1>
        <div class="content__subtitle">Rename your assistant, manage permissions, and export/reset data.</div>
      </div>
    </div>
    <div class="grid grid--2">
      <div class="card card__pad">
        <div class="kicker">Profile</div>
        <form id="settingsProfile" class="grid">
          <div class="field">
            <label>Assistant name</label>
            <input class="input" name="assistantName" type="text" value="${escapeHtml(getAssistantNameForUser(u))}" required />
          </div>
          <div class="field">
            <label>Display name</label>
            <input class="input" name="displayName" type="text" value="${escapeHtml(u.displayName)}" />
          </div>
          <div class="row row--end">
            <button class="btn btn--primary" type="submit">Save</button>
          </div>
        </form>
      </div>
      <div class="card card__pad">
        <div class="kicker">Data</div>
        <div class="list">
          <div class="item">
            <div>
              <div class="item__title">Export</div>
              <div class="item__sub">Download your local data as JSON.</div>
            </div>
            <div class="item__right">
              <button class="btn btn--ghost" type="button" id="btnExport">Download</button>
            </div>
          </div>
          <div class="item">
            <div>
              <div class="item__title">Reset</div>
              <div class="item__sub">Clears local data and logs you out.</div>
            </div>
            <div class="item__right">
              <button class="btn btn--danger" type="button" id="btnReset">Reset</button>
            </div>
          </div>
          <div class="item">
            <div>
              <div class="item__title">Notifications</div>
              <div class="item__sub">Current permission: <span class="mono">${escapeHtml(
                "Notification" in window ? Notification.permission : "unsupported"
              )}</span></div>
            </div>
            <div class="item__right">
              <button class="btn btn--primary" type="button" id="btnAskNotif2">Enable</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
  return dashboardLayout("#/app/settings", content);
}

function featuresRedirect() {
  location.hash = "#/";
  return "";
}

const routes = {
  "#/": landingPage,
  "#/about": aboutPage,
  "#/pricing": pricingPage,
  "#/privacy": privacyPage,
  "#/features": featuresRedirect,
  "#/login": loginPage,
  "#/signup": signupPage,

  "#/app/home": appHomePage,
  "#/app/chat": chatPage,
  "#/app/planner": plannerPage,
  "#/app/reminders": remindersPage,
  "#/app/notes": notesPage,
  "#/app/settings": settingsPage,
};

function render() {
  const hash = location.hash || "#/";
  const main = $("#main");
  const page = routes[hash] || landingPage;
  main.innerHTML = page();
  setBrandFromUser();
  bindPage(hash);
}

function bindPage(hash) {
  $("#btnTryDemo")?.addEventListener("click", startDemo);

  $("#modalRoot")?.addEventListener("click", (e) => {
    const t = e.target;
    if (t?.dataset?.close) closeModal();
  });

  if (hash === "#/") {
    $("#btnEnableNotif")?.addEventListener("click", async () => {
      const p = await ensureNotificationsPermission();
      toast("Notifications", `Permission: ${p}`);
    });
  }

  if (hash === "#/login") {
    $("#btnDemoLogin")?.addEventListener("click", startDemo);
    $("#loginForm")?.addEventListener("submit", (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try {
        login({
          email: fd.get("email"),
          password: fd.get("password"),
        });
        location.hash = "#/app/home";
      } catch (err) {
        toast("Login failed", err.message || String(err), [{ label: "OK", variant: "btn--primary" }]);
      }
    });
  }

  if (hash === "#/signup") {
    $("#signupForm")?.addEventListener("submit", (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try {
        signup({
          displayName: fd.get("displayName"),
          assistantName: fd.get("assistantName"),
          email: fd.get("email"),
          password: fd.get("password"),
        });
        toast("Welcome!", "Assistant created. Opening dashboard…");
        location.hash = "#/app/home";
      } catch (err) {
        toast("Signup failed", err.message || String(err), [{ label: "OK", variant: "btn--primary" }]);
      }
    });
  }

  if (hash.startsWith("#/app/")) {
    $("#btnLogout")?.addEventListener("click", logout);
  }

  if (hash === "#/app/home") {
    $("#btnAllowNotif")?.addEventListener("click", async () => {
      const p = await ensureNotificationsPermission();
      toast("Notifications", `Permission: ${p}`);
    });
  }

  if (hash === "#/app/notes") {
    const u = getCurrentUser();
    $("#noteForm")?.addEventListener("submit", (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const title = String(fd.get("title") || "").trim();
      const content = String(fd.get("content") || "").trim();
      if (!title) return;
      addNote(u.id, title, content);
      toast("Saved", "Note added to your vault.");
      render();
    });

    $$("[data-del-note]").forEach((b) =>
      b.addEventListener("click", () => {
        const id = b.dataset.delNote;
        if (!id) return;
        if (!confirm("Delete this note?")) return;
        deleteNote(id);
        render();
      })
    );
  }

  if (hash === "#/app/reminders") {
    $("#btnAskNotif")?.addEventListener("click", async () => {
      const p = await ensureNotificationsPermission();
      toast("Notifications", `Permission: ${p}`);
      render();
    });

    const u = getCurrentUser();
    $("#remForm")?.addEventListener("submit", (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const title = String(fd.get("title") || "").trim();
      const reason = String(fd.get("reason") || "").trim();
      const when = String(fd.get("when") || "");
      if (!when) return;
      const atMs = new Date(when).getTime();
      if (!Number.isFinite(atMs) || atMs < Date.now() - 60_000) {
        toast("Invalid time", "Pick a future time (or near-future).");
        return;
      }
      addReminder(u.id, atMs, title, reason);
      toast("Reminder added", `Scheduled for ${formatDateTimeLocal(atMs)}`);
      render();
    });

    $$("[data-del-rem]").forEach((b) =>
      b.addEventListener("click", () => {
        const id = b.dataset.delRem;
        if (!id) return;
        if (!confirm("Delete this reminder?")) return;
        deleteReminder(id);
        render();
      })
    );

    $$("[data-test-rem]").forEach((b) =>
      b.addEventListener("click", () => {
        const id = b.dataset.testRem;
        if (!id) return;
        const s = ensureState();
        const r = s.reminders.find((x) => x.id === id);
        if (!r) return;
        fireReminder(r, { isTest: true });
      })
    );
  }

  if (hash === "#/app/chat") {
    const u = getCurrentUser();
    const an = getAssistantNameForUser(u);
    const log = $("#chatLog");
    const input = $("#chatInput");
    const voiceBtn = $("#btnVoiceInput");
    const voiceHint = $("#voiceHint");
    
    const scrollToBottom = () => {
      if (log) {
        log.scrollTop = log.scrollHeight;
      }
    };
    scrollToBottom();

    // Start wake word listening when chat page loads
    if (u && an) {
      // Stop any existing wake word listening first
      stopWakeWordListening();
      setTimeout(() => {
        const started = startWakeWordListening(an);
        if (voiceHint) {
          if (started) {
            voiceHint.textContent = `🎤 Say "Hey ${an}" to ask a question without clicking!`;
          } else {
            voiceHint.textContent = `🎤 Click the microphone button to speak`;
          }
        }
      }, 500);
    }

    const processQuestion = async (question) => {
      if (!question || !question.trim()) return;
      
      const q = question.trim();
      await processQuestionWithBackend(q);
      setTimeout(scrollToBottom, 100);
    };

    $("#btnChatClear")?.addEventListener("click", () => {
      if (!confirm("Clear chat history?")) return;
      setState((s) => {
        s.chats[u.id] = [];
        return s;
      });
      render();
    });

    $("#btnSaveChatAsNote")?.addEventListener("click", () => {
      const chat = getUserChat(u.id);
      const lastAi = [...chat].reverse().find((m) => m.role === "ai");
      if (!lastAi) return toast("Nothing to save", "Ask a question first.");
      addNote(u.id, `Chat answer (${new Date().toLocaleDateString()})`, lastAi.text);
      toast("Saved", "Last answer saved to Notes.");
    });

    // Voice input handler
    if (voiceBtn) {
      voiceBtn.addEventListener("click", () => {
        const updateVoiceUI = (isRecording, text = "") => {
          if (voiceBtn) {
            voiceBtn.classList.toggle("recording", isRecording);
            const status = voiceBtn.querySelector(".voice-status");
            const icon = voiceBtn.querySelector(".voice-icon");
            if (status) status.textContent = isRecording ? "Listening..." : "Speak";
            if (icon) icon.textContent = isRecording ? "🔴" : "🎤";
          }
          if (voiceHint) {
            voiceHint.textContent = isRecording 
              ? "🎤 Listening... Speak now!" 
              : text || "Click the microphone button to speak your question";
          }
        };

        startVoiceInput(
          (transcript) => {
            updateVoiceUI(false, "Voice captured! Processing...");
            if (input) {
              input.value = transcript;
              input.focus();
            }
            processQuestion(transcript);
            setTimeout(() => {
              if (input) input.value = "";
              updateVoiceUI(false);
            }, 1000);
          },
          (error) => {
            updateVoiceUI(false);
            toast("Voice Input Error", error);
          }
        );
        
        if (isListening) {
          updateVoiceUI(true);
        }
      });
    }

    // Form submit handler
    $("#chatForm")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const q = String(fd.get("q") || "").trim();
      if (!q) return;
      if (input) input.value = "";
      await processQuestion(q);
    });

    // Keyboard shortcut: Ctrl+K or Cmd+K to focus input
    document.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k" && hash === "#/app/chat") {
        e.preventDefault();
        input?.focus();
      }
    });
  }

  if (hash === "#/app/planner") {
    const u = getCurrentUser();
    $("#planForm")?.addEventListener("submit", (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const exam = String(fd.get("exam") || "");
      const hours = Number(fd.get("hours") || 2);
      const topics = String(fd.get("topics") || "")
        .split("\n")
        .map((x) => x.trim())
        .filter(Boolean);
      if (!exam) return;
      const text = createPlan({ examDateStr: exam, topics, hoursPerDay: hours });
      setState((s) => {
        s.planners[u.id] = { text, createdAt: nowIso() };
        return s;
      });
      toast("Planner created", "Your day-wise plan is ready.");
      render();
    });

    $("#btnPlannerExport")?.addEventListener("click", () => {
      const plan = ensureState().planners[u.id]?.text;
      if (!plan) return toast("Nothing to export", "Create a plan first.");
      addNote(u.id, `Study plan (${new Date().toLocaleDateString()})`, plan);
      toast("Exported", "Plan saved to Notes.");
    });
  }

  if (hash === "#/app/settings") {
    const u = getCurrentUser();
    $("#settingsProfile")?.addEventListener("submit", (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const assistantName = String(fd.get("assistantName") || "").trim();
      const displayName = String(fd.get("displayName") || "").trim();
      if (!assistantName) return;
      setState((s) => {
        const user = s.users.find((x) => x.id === u.id);
        if (user) {
          user.assistantName = assistantName;
          user.displayName = displayName || user.displayName;
        }
        return s;
      });
      toast("Saved", "Settings updated.");
      setBrandFromUser();
      render();
    });

    $("#btnAskNotif2")?.addEventListener("click", async () => {
      const p = await ensureNotificationsPermission();
      toast("Notifications", `Permission: ${p}`);
      render();
    });

    $("#btnExport")?.addEventListener("click", () => {
      const data = ensureState();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "nova-ai-export.json";
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    });

    $("#btnReset")?.addEventListener("click", () => {
      if (!confirm("This will clear local data and log out. Continue?")) return;
      localStorage.removeItem(STORAGE_KEY);
      toast("Reset", "Local data cleared.");
      location.hash = "#/";
      render();
    });
  }
}

function fireReminder(reminder, { isTest = false } = {}) {
  const user = getCurrentUser();
  const assistantName = getAssistantNameForUser(user);
  const title = isTest ? `Test reminder: ${reminder.title}` : reminder.title;
  const reason = reminder.reason || "No reason provided.";

  const say = `${assistantName} reminder. ${reason}`;
  notify(title, reason);
  toast(title, reason, [
    {
      label: "Open",
      variant: "btn--primary",
      onClick: () => {
        openModal({
          title,
          body: `<div class="muted2">When: <span class="mono">${escapeHtml(formatDateTimeLocal(reminder.atMs))}</span></div>
                 <div style="height:10px"></div>
                 <div>${escapeHtml(reason)}</div>`,
          onSpeak: () => speak(say),
        });
        speak(say);
      },
    },
  ]);

  openModal({
    title,
    body: `<div class="muted2">When: <span class="mono">${escapeHtml(formatDateTimeLocal(reminder.atMs))}</span></div>
           <div style="height:10px"></div>
           <div>${escapeHtml(reason)}</div>`,
    onSpeak: () => speak(say),
  });
  speak(say);
}

function reminderLoopTick() {
  const u = getCurrentUser();
  if (!u) return;
  const s = ensureState();
  const due = s.reminders.filter((r) => r.userId === u.id && !r.fired && r.atMs <= Date.now());
  for (const r of due) {
    updateReminder(r.id, { fired: true });
    fireReminder(r);
  }
}

function startReminderLoop() {
  setInterval(reminderLoopTick, nextReminderPollMs());
}

window.addEventListener("hashchange", () => {
  stopVoiceInput(); // Stop any active voice input when navigating
  stopWakeWordListening(); // Stop wake word listening
  render();
});
window.addEventListener("DOMContentLoaded", () => {
  setBrandFromUser();
  $("#btnTryDemo")?.addEventListener("click", startDemo);
  render();
  startReminderLoop();
});

// Cleanup on page unload
window.addEventListener("beforeunload", () => {
  stopVoiceInput();
});

// Keyboard quality-of-life
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeModal();
});

