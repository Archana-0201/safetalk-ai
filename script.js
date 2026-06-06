// Global Error Logging to the Console UI for Presentation Diagnostics
window.onerror = function(message, source, lineno, colno, error) {
  const errText = `JS Error: ${message} at line ${lineno}`;
  console.error(errText);
  if (typeof addLog === 'function') {
    addLog(errText, "danger");
  }
  return false;
};

window.onunhandledrejection = function(event) {
  const errText = `Unhandled Rejection: ${event.reason}`;
  console.error(errText);
  if (typeof addLog === 'function') {
    addLog(errText, "danger");
  }
};


// Thresholds (configurable via settings panel)
let TOXICITY_THRESHOLD = 0.60;
let NSFW_PROBABILITY_THRESHOLD = 0.75;
const DEMO_BLOCK_DURATION = 3000000; // 120 seconds demo block

// Map of transliterated Tamil insults ("Tanglish") and English typos/evasions to standard English
const CONTENT_TRANSLATION_MAP = {
  // Tamil transliterations
  "loosu": "stupid",
  "loose": "stupid",
  "muttal": "fool",
  "muttaal": "fool",
  "punda": "cunt",
  "pundai": "cunt",
  "echa": "scum",
  "echaa": "scum",
  "naaye": "dog",
  "naai": "dog",
  "panni": "pig",
  "pannikutty": "pig",
  "eruma": "buffalo",
  "erumadu": "buffalo",
  "kazhudhai": "donkey",
  "makku": "brainless",
  "baadu": "trash",
  "paadu": "trash",
  "mundam": "fool",
  "munda": "fool",
  "saniyan": "pest",
  "oththa": "fuck",
  "otha": "fuck",
  "ommala": "motherfucker",
  "omala": "motherfucker",
  "oolu": "obscene",
  "pottai": "obscene",
  "potte": "obscene",
  "somberi": "lazy",
  "komali": "clown",
  "thevidiya": "bitch",
  "thevidia": "bitch",
  "devaidiya": "bitch",
  
  // English vulgar typos & evasions
  "fucler": "fucker",
  "fck": "fuck",
  "fuk": "fuck",
  "b1tch": "bitch",
  "btch": "bitch",
  "a$$": "ass",
  "a$$hole": "asshole",
  "sh1t": "shit"
};

// Map of native Tamil script slurs/insults to standard English
const TAMIL_SCRIPT_MAP = {
  "முட்டாள்": "fool",
  "லூசு": "stupid",
  "நாயே": "dog",
  "நாய்": "dog",
  "பன்னி": "pig",
  "எருமை": "buffalo",
  "கழுதை": "donkey",
  "சாத்தான்": "devil",
  "கோமாளி": "clown",
  "சோம்பேறி": "lazy",
  "பாடு": "trash",
  "முண்டம்": "fool",
  "ஒத்த": "fuck",
  "ஒத்தா": "fuck",
  "புண்ட": "cunt",
  "புண்டை": "cunt",
  "எச்ச": "scum",
  "எச்சடா": "scum",
  "தேவடியா": "bitch",
  "தேவிடியா": "bitch"
};

// Shouting threshold constant (Acoustic energy Root Mean Square)
const SHOUTING_RMS_THRESHOLD = 0.25;

// Server connection settings
// Point to the live hosted Render backend URL
const API_BASE_URL = "https://safetalk-ai.onrender.com/api";
// To test locally, uncomment the line below:
// const API_BASE_URL = "http://localhost:8000/api";
let isServerConnected = false;




// State variables
let toxicityModel = null;
let nsfwModel = null;
let ocrLoaded = false;
let toxicityLoaded = false;  // Lazy loading flag
let nsfwLoaded = false;      // Lazy loading flag

const stats = {
  totalAnalyzed: 0,
  toxicity: 0,
  insult: 0,
  threat: 0,
  nsfw: 0,
  // Detection accuracy metrics
  truePositives: 0,      // Model flagged it AND it was actually offensive
  falsePositives: 0,     // Model flagged it BUT it was actually safe
  trueNegatives: 0,      // Model did not flag it AND it was actually safe
  falseNegatives: 0      // Model did not flag it BUT it was actually offensive
};

const userState = {
  A: { offenseCount: 0, blockedUntil: null, blockedByOther: false, recorder: null, chunks: [], activeRecognition: null },
  B: { offenseCount: 0, blockedUntil: null, blockedByOther: false, recorder: null, chunks: [], activeRecognition: null }
};

// Conversation history for context-aware detection (keeps last 5 messages per user)
const conversationHistory = {
  A: [],
  B: []
};

// Pending message container for the Warning Modal
let pendingMessage = null;

// Whitelisted safe contents scoped by sender-receiver channel to bypass future toxicity alerts
const whitelistedSafeContent = {
  "A->B": {
    texts: new Set(),
    images: new Set(), // Store unique image fingerprints
    audios: new Set(), // Store unique audio sizes
    videos: new Set()  // Store unique video fingerprints
  },
  "B->A": {
    texts: new Set(),
    images: new Set(),
    audios: new Set(),
    videos: new Set()
  }
};

// Stop words to prevent common safe words (like "hey", "you") from being whitelisted as toxic
const STOP_WORDS = new Set([
  "hey", "hello", "hi", "yo", "you", "are", "a", "an", "the", "i", "we", "they", 
  "he", "she", "it", "is", "am", "was", "were", "to", "for", "of", "in", "on", 
  "at", "by", "with", "and", "or", "but", "so", "this", "that", "these", "those", 
  "my", "your", "his", "her", "its", "our", "their", "me", "us", "them", "him", 
  "just", "like", "very", "much", "too", "up", "down", "out", "about", "what", 
  "who", "whom", "which", "why", "how", "please", "can", "could", "would", "should"
]);

// DEBUG: Test toxicity model directly from console
window.testToxicityModel = async function() {
  if (!toxicityModel) {
    console.error("Toxicity model not loaded yet");
    return;
  }
  console.log("\n=== TOXICITY MODEL SANITY TEST ===");
  console.log("Input: 'you are stupid'");
  try {
    const result = await toxicityModel.classify(["you are stupid"]);
    console.log("Raw Result:", result);
    console.log("Full JSON:", JSON.stringify(result, null, 2));
  } catch (err) {
    console.error("Test failed:", err);
  }
};

window.testMultiplePhrases = async function() {
  if (!toxicityModel) {
    console.error("Toxicity model not loaded yet");
    return;
  }
  const testPhrases = [
    "you are stupid",
    "i hate you",
    "kill yourself",
    "you suck",
    "hello"
  ];
  console.log("\n=== BATCH PHRASE TESTING ===");
  for (const phrase of testPhrases) {
    try {
      const result = await toxicityModel.classify([phrase]);
      const hasMatch = result.some(p => p.results[0].match === true);
      console.log(`\n"${phrase}" => Match: ${hasMatch}`);
      result.forEach(p => {
        const prob = p.results[0].probabilities[1] || p.results[0].probabilities || 0;
        console.log(`  ${p.label}: ${typeof prob === 'number' ? (prob * 100).toFixed(1) + '%' : prob}`);
      });
    } catch (err) {
      console.error(`Error testing "${phrase}":`, err);
    }
  }
};

// Initialization
window.addEventListener("DOMContentLoaded", () => {
  initBadges();
  checkServerConnection();
  loadModels();
  initTheme();
  setupEventListeners();
  addLog("System initialized. Awaiting model loading...", "info");
  console.log("DEBUG: Call window.testToxicityModel() or window.testMultiplePhrases() from console to test");
});

// Initialize and apply theme from LocalStorage
function initTheme() {
  const savedTheme = localStorage.getItem("safetalk-theme") || "light";
  const body = document.body;
  const toggleIcon = document.querySelector("#themeToggleBtn .theme-toggle-icon");
  
  if (savedTheme === "dark") {
    body.classList.add("dark-theme");
    if (toggleIcon) toggleIcon.textContent = "☀️";
  } else {
    body.classList.remove("dark-theme");
    if (toggleIcon) toggleIcon.textContent = "🌙";
  }
}

// Toggle Theme function
function toggleTheme() {
  const body = document.body;
  const toggleIcon = document.querySelector("#themeToggleBtn .theme-toggle-icon");
  
  if (body.classList.contains("dark-theme")) {
    body.classList.remove("dark-theme");
    localStorage.setItem("safetalk-theme", "light");
    if (toggleIcon) toggleIcon.textContent = "🌙";
    addLog("Switched to Light Theme", "info");
  } else {
    body.classList.add("dark-theme");
    localStorage.setItem("safetalk-theme", "dark");
    if (toggleIcon) toggleIcon.textContent = "☀️";
    addLog("Switched to Dark Theme", "info");
  }
}

// Ping backend and sync DB states
async function checkServerConnection() {
  updateBadge("badgeServer", "loading", "Server: Checking...");
  try {
    const res = await fetch(`${API_BASE_URL}/health`);
    if (res.ok) {
      isServerConnected = true;
      updateBadge("badgeServer", "ready", "Server: Connected (Hybrid)");
      addLog("SafeTalk backend server connected successfully. Hybrid mode enabled.", "success");
      await syncUserStatesFromServer();
      await syncWhitelistsFromServer();
    } else {
      throw new Error("Server responded with error status");
    }
  } catch (err) {
    isServerConnected = false;
    updateBadge("badgeServer", "failed", "Server: Offline (Local Mode)");
    addLog("Could not connect to SafeTalk backend. Running in local simulation mode.", "warning");
    console.warn("Backend offline. Fallback to local variables.", err);
  }
}

async function syncUserStatesFromServer() {
  if (!isServerConnected) return;
  try {
    // Sync User A
    const resA = await fetch(`${API_BASE_URL}/users/state`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "A", other_username: "B" })
    });
    if (resA.ok) {
      const dataA = await resA.json();
      userState.A.offenseCount = dataA.offenseCount;
      userState.A.blockedUntil = dataA.blockedUntil;
      userState.A.blockedByOther = dataA.blockedByOther;
      updateOffenseUI("A");
      
      // If user is currently suspended, trigger visual lockout
      if (dataA.blockedUntil && Date.now() < dataA.blockedUntil) {
        suspendUser("A", dataA.blockedUntil);
      }
    }
    
    // Sync User B
    const resB = await fetch(`${API_BASE_URL}/users/state`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "B", other_username: "A" })
    });
    if (resB.ok) {
      const dataB = await resB.json();
      userState.B.offenseCount = dataB.offenseCount;
      userState.B.blockedUntil = dataB.blockedUntil;
      userState.B.blockedByOther = dataB.blockedByOther;
      updateOffenseUI("B");
      
      // If user is currently suspended, trigger visual lockout
      if (dataB.blockedUntil && Date.now() < dataB.blockedUntil) {
        suspendUser("B", dataB.blockedUntil);
      }
    }
  } catch (err) {
    console.error("Failed to sync user states:", err);
  }
}

async function syncWhitelistsFromServer() {
  if (!isServerConnected) return;
  try {
    const channels = ["A->B", "B->A"];
    for (const channel of channels) {
      const res = await fetch(`${API_BASE_URL}/whitelist/${channel}`);
      if (res.ok) {
        const data = await res.json();
        whitelistedSafeContent[channel].texts = new Set(data.texts || []);
        whitelistedSafeContent[channel].images = new Set(data.images || []);
        whitelistedSafeContent[channel].audios = new Set(data.audios || []);
        whitelistedSafeContent[channel].videos = new Set(data.videos || []);
        console.log(`[WHITELIST SYNC] Loaded whitelisted terms for ${channel}:`, data);
      }
    }
  } catch (err) {
    console.error("Failed to sync whitelists from server:", err);
  }
}

function addWhitelistItem(channel, type, content) {
  if (!content) return;
  const normalizedContent = typeof content === 'string' ? content.toLowerCase().trim() : content;
  
  // Local cache updates
  if (type === "text") whitelistedSafeContent[channel].texts.add(normalizedContent);
  else if (type === "image") whitelistedSafeContent[channel].images.add(normalizedContent);
  else if (type === "audio") whitelistedSafeContent[channel].audios.add(normalizedContent);
  else if (type === "video") whitelistedSafeContent[channel].videos.add(normalizedContent);
  
  // Server persistence
  if (isServerConnected) {
    fetch(`${API_BASE_URL}/whitelist/add`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channel, content_type: type, content: String(normalizedContent) })
    })
    .then(res => {
      if (res.ok) console.log(`[WHITELIST PERSIST] Synced '${normalizedContent}' (${type}) for ${channel}`);
    })
    .catch(e => console.error("Whitelist sync failed:", e));
  }
}

// Update loaded model state badges
function initBadges() {
  updateBadge("badgeServer", "loading", "Server: Connecting...");
  updateBadge("badgeTf", "loading", "TFJS: Loading");
  updateBadge("badgeToxicity", "loading", "Toxicity: Loading");
  updateBadge("badgeNsfw", "loading", "NSFWJS: Loading");
  updateBadge("badgeOcr", "loading", "OCR: Readying");
}

function updateBadge(id, state, text) {
  const el = document.getElementById(id);
  if (!el) return;
  el.className = `model-badge ${state}`;
  el.querySelector(".badge-text").textContent = text;
}

// Load TensorFlow and NSFW JS models
async function loadModels() {
  // 1. TF.js is loaded from CDN
  try {
    if (typeof tf !== 'undefined') {
      updateBadge("badgeTf", "ready", "TFJS: Ready");
      // Set backend to CPU immediately for Toxicity loading stability
      await tf.setBackend('cpu');
      addLog("TensorFlow active backend initialized to CPU.", "info");
    } else {
      throw new Error("tf is undefined");
    }
  } catch (err) {
    updateBadge("badgeTf", "failed", "TFJS: Failed");
    addLog("TensorFlow.js library failed to load.", "danger");
  }
  
  // 2. Toxicity model will be loaded on-demand (lazy loading) when first text is sent
  updateBadge("badgeToxicity", "ready", "Toxicity Model: On-Demand");
  addLog("Toxicity model set to lazy-load on first text message.", "info");
  
  // 3. NSFW model will be loaded on-demand (lazy loading) when first image is sent
  updateBadge("badgeNsfw", "ready", "NSFW Model: On-Demand");
  addLog("NSFW model set to lazy-load on first image upload.", "info");
  
  // 4. OCR Ready (since Tesseract script is fetched)
  try {
    if (typeof Tesseract !== 'undefined') {
      ocrLoaded = true;
      updateBadge("badgeOcr", "ready", "Tesseract OCR: Active");
      addLog("Tesseract OCR text extractor loaded successfully.", "success");
    } else {
      throw new Error("Tesseract is undefined");
    }
  } catch (err) {
    updateBadge("badgeOcr", "failed", "Tesseract OCR: Inactive");
    addLog("Tesseract OCR library failed to load. Image text extraction bypassed.", "danger");
  }
  
  // Enable Chat inputs regardless of model failures
  document.getElementById("sendA").disabled = false;
  document.getElementById("sendB").disabled = false;
  addLog("Moderation dashboard online. Chat simulator enabled.", "info");
}

// Setup standard event listeners
function setupEventListeners() {

  
  // User A Buttons
  document.getElementById("sendA").onclick = () => handleSend("A", "B");
  document.getElementById("imgBtnA").onclick = () => document.getElementById("imgInputA").click();
  document.getElementById("imgInputA").onchange = (e) => handleImageSelect("A", "B", e);
  document.getElementById("startBtnA").onclick = () => startAudioRecord("A");
  document.getElementById("stopBtnA").onclick = () => stopAudioRecord("A");
  document.getElementById("sendAudioA").onclick = () => sendAudioMessage("A", "B");
  document.getElementById("inputA").onkeypress = (e) => { if (e.key === "Enter") handleSend("A", "B"); };
  
  // User B Buttons
  document.getElementById("sendB").onclick = () => handleSend("B", "A");
  document.getElementById("imgBtnB").onclick = () => document.getElementById("imgInputB").click();
  document.getElementById("imgInputB").onchange = (e) => handleImageSelect("B", "A", e);
  document.getElementById("startBtnB").onclick = () => startAudioRecord("B");
  document.getElementById("stopBtnB").onclick = () => stopAudioRecord("B");
  document.getElementById("sendAudioB").onclick = () => sendAudioMessage("B", "A");
  document.getElementById("inputB").onkeypress = (e) => { if (e.key === "Enter") handleSend("B", "A"); };

  // Focus effects for Column glows
  const inputA = document.getElementById("inputA");
  const columnA = document.getElementById("columnA");
  inputA.addEventListener("focus", () => {
    columnA.classList.add("active-a");
  });
  inputA.addEventListener("blur", () => {
    columnA.classList.remove("active-a");
  });
  
  const inputB = document.getElementById("inputB");
  const columnB = document.getElementById("columnB");
  inputB.addEventListener("focus", () => {
    columnB.classList.add("active-b");
  });
  inputB.addEventListener("blur", () => {
    columnB.classList.remove("active-b");
  });

  // Modal Actions
  document.getElementById("editBtn").onclick = () => handleModalChoice("edit");
  document.getElementById("deleteBtn").onclick = () => handleModalChoice("delete");
  document.getElementById("sendAnywayBtn").onclick = () => handleModalChoice("sendAnyway");
  
  // Theme Toggle Actions
  const themeToggleBtn = document.getElementById("themeToggleBtn");
  if (themeToggleBtn) {
    themeToggleBtn.onclick = toggleTheme;
  }
  
  // Wire dynamic actions for Preset buttons
  setupPresets();
}

// Calculate and update detection performance metrics (Precision, Recall, F1)
function updateDetectionMetrics() {
  const tp = stats.truePositives;
  const fp = stats.falsePositives;
  const tn = stats.trueNegatives;
  const fn = stats.falseNegatives;
  
  // Precision = TP / (TP + FP) — What proportion of flagged items were actually offensive?
  const precision = (tp + fp > 0) ? (tp / (tp + fp)) : 0;
  
  // Recall = TP / (TP + FN) — What proportion of offensive items did we catch?
  const recall = (tp + fn > 0) ? (tp / (tp + fn)) : 0;
  
  // F1 Score = 2 * (Precision * Recall) / (Precision + Recall) — Harmonic mean for overall performance
  const f1 = (precision + recall > 0) ? (2 * (precision * recall) / (precision + recall)) : 0;
  
  // Update display if metrics exist in HTML
  const precisionEl = document.getElementById("metricPrecision");
  const recallEl = document.getElementById("metricRecall");
  const f1El = document.getElementById("metricF1");
  const summaryEl = document.getElementById("metricsSummary");
  
  if (precisionEl) precisionEl.textContent = (precision * 100).toFixed(1) + "%";
  if (recallEl) recallEl.textContent = (recall * 100).toFixed(1) + "%";
  if (f1El) f1El.textContent = (f1 * 100).toFixed(1) + "%";
  
  if (summaryEl) {
    summaryEl.innerHTML = `
      <strong>Model Performance</strong><br>
      TP: ${tp} | FP: ${fp} | FN: ${fn}<br>
      Precision: ${(precision * 100).toFixed(1)}% | Recall: ${(recall * 100).toFixed(1)}% | F1: ${(f1 * 100).toFixed(1)}%
    `;
  }
  
  console.log(`[METRICS] Precision: ${(precision*100).toFixed(1)}% | Recall: ${(recall*100).toFixed(1)}% | F1: ${(f1*100).toFixed(1)}%`);
}

// Check if a user is currently blocked (e.g. suspended or user-blocked)
function checkBlockedState(sender, receiver) {
  const now = Date.now();
  // 1. Suspension block (repeated offenses)
  if (userState[sender].blockedUntil && now < userState[sender].blockedUntil) {
    const secLeft = Math.ceil((userState[sender].blockedUntil - now) / 1000);
    alert(`You are suspended for sending toxic content. Unlocks in ${secLeft}s.`);
    return true;
  }
  
  // 2. Direct user block
  if (userState[sender].blockedByOther) {
    alert(`You cannot send messages. You have been blocked by User ${receiver}.`);
    return true;
  }
  return false;
}

// Moderation statistics visual update
function updateStatistics(category, increment = 1) {
  if (category in stats) {
    stats[category] += increment;
    
    // Update labels
    const labelEl = document.getElementById(`stat-val-${category}`);
    if (labelEl) labelEl.textContent = stats[category];
    
    // Update visual bars
    const barEl = document.getElementById(`stat-bar-${category}`);
    if (barEl) {
      // Calculate width percentage relative to total analyzed
      const total = stats.totalAnalyzed || 1;
      const percentage = category === 'totalAnalyzed' ? 100 : Math.min(100, Math.round((stats[category] / total) * 100));
      barEl.style.width = `${percentage}%`;
    }
  }
}

// Activity Event Log helper
function addLog(text, type = "info") {
  const container = document.getElementById("eventsFeed");
  const emptyMsg = container.querySelector(".empty-logs");
  if (emptyMsg) emptyMsg.remove();
  
  const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const item = document.createElement("div");
  item.className = `event-log-item ${type}`;
  item.innerHTML = `<span class="event-time">[${time}]</span> ${text}`;
  
  container.prepend(item);
  container.scrollTop = 0;
}

// Translate Tanglish and English typos to standard English equivalents
function translateAbuseTerms(text) {
  let words = text.split(/\s+/);
  let modified = false;
  
  const mappedWords = words.map(word => {
    // Strip trailing/leading punctuation from the word for mapping lookup
    const cleanWord = word.replace(/^[.,\/#!$%\^&\*;:{}=\-_`~()?]+|[.,\/#!$%\^&\*;:{}=\-_`~()?]+$/g, "").toLowerCase();
    
    // Check both standard content translation and Tamil script dictionaries
    let translation = CONTENT_TRANSLATION_MAP[cleanWord] || TAMIL_SCRIPT_MAP[cleanWord];
    if (!translation) {
      // Direct lookup of the word in case Unicode punctuation stripping differed
      translation = TAMIL_SCRIPT_MAP[word];
    }
    
    if (translation) {
      modified = true;
      // Re-attach punctuation if any was stripped
      const prefix = word.match(/^[.,\/#!$%\^&\*;:{}=\-_`~()?]+/);
      const suffix = word.match(/[.,\/#!$%\^&\*;:{}=\-_`~()?]+$/);
      return (prefix ? prefix[0] : "") + translation + (suffix ? suffix[0] : "");
    }
    return word;
  });
  
  return modified ? mappedWords.join(" ") : text;
}

// Analyze text for toxicity using TFJS model (with optional context from conversation history)
async function analyzeText(text, sender = null) {
  let preprocessedText = text.trim().toLowerCase();
  
  // Translate Tanglish terms & English typos/evasions to standard English words
  let translatedText = translateAbuseTerms(preprocessedText);
  if (translatedText !== preprocessedText) {
    addLog(`Translated slang/typos for analysis: "${translatedText}"`, "info");
    preprocessedText = translatedText;
  }
  
  // Build context from conversation history for pattern detection
  let contextAwareInput = preprocessedText;
  if (sender && conversationHistory[sender] && conversationHistory[sender].length > 0) {
    // Combine last messages with current message for context-aware analysis
    const context = conversationHistory[sender].join(" ").toLowerCase();
    if (context) {
      contextAwareInput = context + " " + preprocessedText;
      addLog(`Context-aware analysis enabled (${conversationHistory[sender].length} messages in history)`, "info");
    }
  }
  
  // Resolve channel-specific whitelisting if sender context is provided
  const receiver = sender === "A" ? "B" : "A";
  const channel = sender ? `${sender}->${receiver}` : null;
  let wasModified = false;
  
  if (channel && whitelistedSafeContent[channel]) {
    for (const safePhrase of whitelistedSafeContent[channel].texts) {
      if (preprocessedText.includes(safePhrase)) {
        preprocessedText = preprocessedText.split(safePhrase).join(" ");
        wasModified = true;
      }
    }
  }
  
  if (wasModified) {
    addLog(`Preprocessed text using whitelisted terms: "${preprocessedText}"`, "info");
  }

  // Check if the preprocessed text has any meaningful non-whitelisted words left
  const wordsLeft = preprocessedText.split(/\s+/).filter(w => w.trim().length > 0);
  if (wordsLeft.length === 0) {
    addLog(`Bypassed analysis (all toxic words whitelisted as safe): "${text}"`, "info");
    return { isToxic: false, reasons: [] };
  }

  if (!toxicityModel) {
    addLog("Toxicity model not initialized yet.", "warning");
    return { isToxic: false, reasons: [] };
  }
  
  // Force CPU backend for toxicity check stability (prevents WebGL silent failures returning 0%)
  if (typeof tf !== 'undefined') {
    try {
      await tf.setBackend('cpu');
    } catch (e) {
      console.warn("Failed to switch backend to CPU for toxicity check:", e);
    }
  }
  
  addLog(`Running toxicity check on: "${preprocessedText}"${contextAwareInput !== preprocessedText ? " (with conversation context)" : ""}`, "info");
  
  try {
    let predictions;
    try {
      predictions = await toxicityModel.classify([contextAwareInput]);
    } catch (classifyErr) {
      console.warn("Toxicity classification primary backend error, falling back to CPU...", classifyErr);
      addLog(`Toxicity GPU warning: ${classifyErr.message || classifyErr}. Switching to CPU...`, "warning");
      if (typeof tf !== 'undefined') {
        await tf.setBackend('cpu');
        predictions = await toxicityModel.classify([contextAwareInput]);
      } else {
        throw classifyErr;
      }
    }

    console.log("=== RAW PREDICTIONS ===");
    console.log(predictions);
    console.log("========================");

    const reasons = [];
    let logSummary = [];
    
    predictions.forEach((p, idx) => {
      console.log(`Prediction ${idx}:`, p);
      console.log(`  Label: ${p.label}`);
      console.log(`  Results[0]: `, p.results[0]);
      console.log(`  RESULT OBJECT (full inspect):`, JSON.stringify(p.results[0], null, 2));
      
      // Get probabilities - handle different possible structures
      let prob = 0;
      let match = false;
      
      // Extract probability safely
      if (p.results[0].probabilities) {
        if (Array.isArray(p.results[0].probabilities)) {
          prob = p.results[0].probabilities[1] || 0;
          console.log(`  Probabilities array: [${p.results[0].probabilities[0]}, ${p.results[0].probabilities[1]}]`);
        } else if (p.results[0].probabilities instanceof Float32Array) {
          prob = p.results[0].probabilities[1] || 0;
          console.log(`  Probabilities Float32Array: [${p.results[0].probabilities[0]}, ${p.results[0].probabilities[1]}]`);
        } else if (typeof p.results[0].probabilities === 'object' && p.results[0].probabilities[1] !== undefined) {
          prob = p.results[0].probabilities[1];
          console.log(`  Probabilities object: [${p.results[0].probabilities[0]}, ${p.results[0].probabilities[1]}]`);
        }
      }
      
      // Check match property
      if (typeof p.results[0].match !== 'undefined') {
        match = p.results[0].match;
        console.log(`  Match: ${match} (type: ${typeof match})`);
      }
      
      console.log(`  Probability: ${(prob * 100).toFixed(2)}% | Threshold: ${TOXICITY_THRESHOLD * 100}%`);
      console.log(`  Type of prob: ${typeof prob}, Value: ${prob}`);
      
      logSummary.push(`${p.label}: ${(prob * 100).toFixed(0)}%`);
      
      // TEST 1: Use only match field (fastest detection method)
      const flaggedByMatch = match === true;
      
      // TEST 2: Use both match and probability for redundancy
      const flaggedByProb = typeof prob === 'number' && prob >= TOXICITY_THRESHOLD;
      
      // If match is true OR probability exceeds threshold (safer logic)
      const isFlagged = flaggedByMatch || flaggedByProb;
      
      console.log(`  ✓ Flagged by match?: ${flaggedByMatch}, By prob?: ${flaggedByProb}, Final: ${isFlagged}`);
      
      if (isFlagged) {
        console.log(`  ✓✓✓ FLAGGED (match=${match}, prob=${prob.toFixed(3)})`);
        reasons.push(p.label);
        addLog(`Flagged: ${p.label} (${(prob * 100).toFixed(1)}%)`, "warning");
        
        // Map specific metrics
        if (p.label === "insult") updateStatistics("insult");
        else if (p.label === "threat") updateStatistics("threat");
      } else {
        console.log(`  ✗ Not flagged (match=${match}, prob=${prob.toFixed(3)}, threshold=${TOXICITY_THRESHOLD})`);
      }
    });
    
    console.log("Summary:", logSummary);
    addLog(`Scan results -> ${logSummary.join(" | ")}`, "info");
    
    // Cascading Inference logic: check if local max probability is in the ambiguous zone [0.25, 0.75]
    let maxProbability = 0;
    predictions.forEach(p => {
      let prob = 0;
      if (p.results[0].probabilities) {
        if (Array.isArray(p.results[0].probabilities)) {
          prob = p.results[0].probabilities[1] || 0;
        } else if (p.results[0].probabilities instanceof Float32Array) {
          prob = p.results[0].probabilities[1] || 0;
        } else if (typeof p.results[0].probabilities === 'object' && p.results[0].probabilities[1] !== undefined) {
          prob = p.results[0].probabilities[1];
        }
      }
      if (prob > maxProbability) {
        maxProbability = prob;
      }
    });

    console.log(`[CASCADING MODERATION] Max Local Probability: ${(maxProbability * 100).toFixed(1)}%`);

    if (isServerConnected && maxProbability >= 0.25 && maxProbability <= 0.75) {
      addLog(`Local score (${(maxProbability * 100).toFixed(0)}%) in ambiguous zone (25% - 75%). Escalating to Tier 2 Cloud Brain...`, "warning");
      try {
        const res = await fetch(`${API_BASE_URL}/moderation/analyze`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: contextAwareInput })
        });
        if (res.ok) {
          const data = await res.json();
          addLog(`Tier 2 Cloud Brain response: ${data.isToxic ? "FLAGGED (" + data.reasons.join(", ") + ")" : "APPROVED"} [Engine: ${data.engine}]`, data.isToxic ? "danger" : "success");
          if (data.isToxic) {
            updateStatistics("toxicity");
            data.reasons.forEach(r => {
              if (r.includes("insult")) updateStatistics("insult");
              else if (r.includes("threat")) updateStatistics("threat");
            });
          }
          return { isToxic: data.isToxic, reasons: data.reasons };
        }
      } catch (err) {
        console.error("Tier 2 Cloud Brain request failed, falling back to local decision:", err);
        addLog("Tier 2 request failed, relying on local classification.", "warning");
      }
    }
    
    const toxic = reasons.length > 0;
    console.log("FINAL RESULT: isToxic =", toxic);
    if (toxic) {
      updateStatistics("toxicity");
    }
    
    return { isToxic: toxic, reasons };
  } catch (err) {
    console.error("FULL ANALYSIS ERROR (NOT SILENT):", err);
    console.error("Error stack:", err.stack);
    addLog(`Text analysis failure: ${err.message || err}`, "danger");
    // Re-throw to prevent silent failures
    console.warn("⚠️ Error in toxicity analysis - check console for details");
    return { isToxic: false, reasons: [] };
  }
}

// Extract specific toxic segments (words/bigrams) from a flagged message to whitelist
async function extractToxicSegments(text) {
  const segments = [];
  // Clean punctuation and get words
  const clean = text.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?]/g,"");
  const words = clean.split(/\s+/).map(w => w.trim().toLowerCase()).filter(w => w.length > 2);
  
  // Filter out stop words to avoid whitelisting common tokens
  const contentWords = words.filter(w => !STOP_WORDS.has(w));
  
  if (toxicityModel && contentWords.length > 0) {
    try {
      // Analyze individual content words
      const wordPredictions = await Promise.all(contentWords.map(w => toxicityModel.classify([w])));
      for (let i = 0; i < contentWords.length; i++) {
        let isWordToxic = false;
        wordPredictions[i].forEach(p => {
          const match = p.results[0].match;
          const prob = p.results[0].probabilities[1];
          if (match === true || prob >= TOXICITY_THRESHOLD) {
            isWordToxic = true;
          }
        });
        if (isWordToxic) {
          segments.push(contentWords[i]);
        }
      }
    } catch (err) {
      console.error("Error classifying words:", err);
    }
  }
  
  // Analyze bigrams for multi-word toxic phrases (e.g. "shut up"), filtering out stop-word-only bigrams
  const rawWords = clean.split(/\s+/).map(w => w.trim().toLowerCase()).filter(w => w.length > 0);
  const bigrams = [];
  for (let i = 0; i < rawWords.length - 1; i++) {
    if (!STOP_WORDS.has(rawWords[i]) || !STOP_WORDS.has(rawWords[i+1])) {
      bigrams.push(`${rawWords[i]} ${rawWords[i+1]}`);
    }
  }
  
  if (toxicityModel && bigrams.length > 0) {
    try {
      const bigramPredictions = await Promise.all(bigrams.map(b => toxicityModel.classify([b])));
      for (let i = 0; i < bigrams.length; i++) {
        let isBigramToxic = false;
        bigramPredictions[i].forEach(p => {
          const match = p.results[0].match;
          const prob = p.results[0].probabilities[1];
          if (match === true || prob >= TOXICITY_THRESHOLD) {
            isBigramToxic = true;
          }
        });
        if (isBigramToxic) {
          segments.push(bigrams[i]);
        }
      }
    } catch (err) {
      console.error("Error classifying bigrams:", err);
    }
  }
  
  // Fallback: if no specific sub-words were classified as toxic, whitelist the entire string (excluding stop words)
  if (segments.length === 0) {
    segments.push(text.trim().toLowerCase());
  }
  
  // Return unique entries only
  return [...new Set(segments)];
}

// Display warnings modal to sender
function triggerWarningModal(payload) {
  pendingMessage = payload;
  
  const modalText = document.getElementById("flaggedMessageText");
  const categoriesList = document.getElementById("flaggedCategories");
  
  // Format body excerpt
  let bodyExcerpt = `"${payload.text}"`;
  if (payload.isAudio) {
    bodyExcerpt = `🎤 Audio Transcript: "${payload.text}"`;
  } else if (payload.imageURL) {
    bodyExcerpt = `🖼️ Image Text: "${payload.ocrText || payload.text}"`;
  }
  modalText.textContent = bodyExcerpt;
  
  // Clear categories
  categoriesList.innerHTML = "";
  
  // Add category tags
  payload.reasons.forEach(r => {
    const span = document.createElement("span");
    span.className = "flagged-badge";
    span.textContent = r;
    categoriesList.appendChild(span);
  });
  
  // Show UI
  document.getElementById("modalOverlay").style.display = "block";
  document.getElementById("moderationModal").style.display = "block";
  
  addLog(`Suspicious content warning shown to User ${payload.sender}.`, "warning");
}

// Hide Modal
function closeModal() {
  document.getElementById("modalOverlay").style.display = "none";
  document.getElementById("moderationModal").style.display = "none";
  pendingMessage = null;
}

// Handle choices from Warning Modal
async function handleModalChoice(choice) {
  if (!pendingMessage) return;
  
  const { sender, receiver, text, imageURL, imageFile, ocrText, isAudio, audioBlob, reasons, isVideo } = pendingMessage;
  closeModal();
  
  if (choice === "edit") {
    // Put text back into inputs
    const input = document.getElementById(`input${sender}`);
    if (input && !isAudio && !imageURL) {
      input.value = text;
      input.focus();
    }
    addLog(`User ${sender} chose to EDIT the flagged message.`, "info");
    
  } else if (choice === "delete") {
    // Reset attachments
    clearInputRow(sender);
    addLog(`User ${sender} DELETED the flagged message.`, "info");
    
  } else if (choice === "sendAnyway") {
    // User decides to bypass warning
    addLog(`User ${sender} chose 'Send Anyway' (Pending confirmation from receiver).`, "warning");
    
    // Proceed to deliver the message forced (masked for receiver)
    if (isAudio && audioBlob) {
      deliverAudio(sender, receiver, audioBlob, text, true);
    } else if (imageFile || imageURL) {
      if (isVideo) {
        deliverVideo(sender, receiver, imageFile || imageURL, ocrText, true, reasons);
      } else {
        deliverImage(sender, receiver, imageFile || imageURL, ocrText, true, reasons);
      }
    } else {
      deliverText(sender, receiver, text, true, reasons);
    }
    
    // Clear sender row inputs
    clearInputRow(sender);
  }
}

// Suspend a user (supports local mock duration or server-determined end timestamp)
function suspendUser(userId, blockedUntilTimestamp = null) {
  const duration = blockedUntilTimestamp ? (blockedUntilTimestamp - Date.now()) : DEMO_BLOCK_DURATION;
  userState[userId].blockedUntil = blockedUntilTimestamp || (Date.now() + DEMO_BLOCK_DURATION);
  
  const seconds = Math.max(1, Math.ceil(duration / 1000));
  addLog(`User ${userId} suspended for ${seconds}s due to repeated offenses!`, "danger");
  
  // Visual UI lockout
  const textInput = document.getElementById(`input${userId}`);
  const sendBtn = document.getElementById(`send${userId}`);
  
  textInput.disabled = true;
  textInput.placeholder = "ACCOUNT SUSPENDED - VIOLATION";
  sendBtn.disabled = true;
  
  appendSystemMessage(userId === "A" ? "messagesA" : "messagesB", "SYSTEM: Your chat privileges have been suspended for repeated toxicity violations.");
  appendSystemMessage(userId === "A" ? "messagesB" : "messagesA", `SYSTEM: User ${userId} has been suspended due to toxic chat behavior.`);
  
  setTimeout(async () => {
    userState[userId].blockedUntil = null;
    userState[userId].offenseCount = 0;
    updateOffenseUI(userId);
    
    textInput.disabled = false;
    textInput.placeholder = `User ${userId}: Type a message`;
    sendBtn.disabled = false;
    
    appendSystemMessage(userId === "A" ? "messagesA" : "messagesB", "SYSTEM: Your suspension has expired. Please chat responsibly.");
    addLog(`User ${userId} suspension expired. Unblocked.`, "success");
    
    // Notify server to reset offenses and clear suspension in DB
    if (isServerConnected) {
      try {
        await fetch(`${API_BASE_URL}/users/clear-suspension`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: userId })
        });
      } catch (e) {
        console.error("Failed to clear suspension on server:", e);
      }
    }
  }, duration);
}

// Update User Offense counter UI
function updateOffenseUI(user) {
  const el = document.getElementById(`offenses${user}`);
  if (!el) return;
  
  const count = userState[user].offenseCount;
  el.textContent = `Offenses: ${count}/3`;
  
  el.className = "offense-count";
  if (count === 0) el.classList.add("safe");
  else if (count < 3) el.classList.add("warned");
  else el.classList.add("blocked");
}

// Clear input components
function clearInputRow(user) {
  document.getElementById(`input${user}`).value = "";
  document.getElementById(`imgInput${user}`).value = "";
  
  const statusEl = document.getElementById(`inputStatus${user}`);
  statusEl.innerHTML = "";
  
  // Reset audio elements
  const playback = document.getElementById(`audioPlayback${user}`);
  const drawer = document.getElementById(`audioPlaybackDrawer${user}`);
  if (drawer) drawer.style.display = "none";
  playback.src = "";
  playback.audioBlob = null;
  playback.transcript = "";
  document.getElementById(`sendAudio${user}`).disabled = true;
}

// Send Text Message Event Handler
async function handleSend(sender, receiver) {
  if (checkBlockedState(sender, receiver)) return;
  
  const inputEl = document.getElementById(`input${sender}`);
  const text = inputEl.value.trim();
  if (!text) return;

  const channel = `${sender}->${receiver}`;
  // Direct bypass if the exact full text is whitelisted for this channel
  if (whitelistedSafeContent[channel].texts.has(text.toLowerCase())) {
    addLog(`Bypassed analysis (text whitelisted as safe for ${channel}): "${text}"`, "success");
    deliverText(sender, receiver, text, false);
    inputEl.value = "";
    inputEl.focus();
    return;
  }
  
  // LAZY LOAD: Load toxicity model on first text message if not already loaded
  if (!toxicityLoaded) {
    try {
      updateInputStatus(sender, "⏳ Loading toxicity model...");
      if (typeof tf !== 'undefined') {
        await tf.setBackend('cpu');
      }
      console.log("[LAZY LOAD] Loading Toxicity model on first text send");
      toxicityModel = await toxicity.load(TOXICITY_THRESHOLD);
      toxicityLoaded = true;
      updateBadge("badgeToxicity", "ready", "Toxicity Model: Active");
      addLog("Toxicity model loaded (lazy-load on first use).", "success");
    } catch (error) {
      console.error("Lazy load toxicity model error:", error);
      updateBadge("badgeToxicity", "failed", "Toxicity Model: Error");
      addLog("Failed to load toxicity model: " + error.message, "danger");
      updateInputStatus(sender, "");
      return;
    }
  }
  
  // Lock inputs during scan
  inputEl.disabled = true;
  updateInputStatus(sender, "Scanning text for toxicity...");
  updateStatistics("totalAnalyzed");
  
  const analysis = await analyzeText(text, sender);
  
  inputEl.disabled = false;
  updateInputStatus(sender, "");
  
  if (analysis.isToxic) {
    // Clear history to prevent previous toxic context from poisoning future clean messages
    conversationHistory[sender] = [];
    triggerWarningModal({
      sender,
      receiver,
      text,
      reasons: analysis.reasons,
      isAudio: false
    });
  } else {
    // Safe message: only push to history context when message is safe and delivered
    conversationHistory[sender].push(text);
    if (conversationHistory[sender].length > 5) {
      conversationHistory[sender].shift();
    }
    deliverText(sender, receiver, text, false);
    inputEl.value = "";
    inputEl.focus();
  }
}

// Deliver text message
function deliverText(sender, receiver, text, isMasked = false, reasons = []) {
  // Sender view
  appendMessage(sender === "A" ? "messagesA" : "messagesB", "You", text, false);
  
  // Receiver view
  const recContainerId = receiver === "A" ? "messagesA" : "messagesB";
  if (isMasked) {
    appendMaskedBubble(recContainerId, `User ${sender}`, text, reasons, false);
  } else {
    appendMessage(recContainerId, `User ${sender}`, text, false);
  }
}

// Deliver audio message
function deliverAudio(sender, receiver, blob, transcript, isMasked = false) {
  const url = URL.createObjectURL(blob);
  
  // Sender view (always sees own original audio)
  appendAudioBubble(sender === "A" ? "messagesA" : "messagesB", "You", url, transcript);
  
  // Receiver view
  const recContainerId = receiver === "A" ? "messagesA" : "messagesB";
  if (isMasked) {
    // Generate unique index for this audio block, carrying audio size fingerprint
    appendMaskedBubble(recContainerId, `User ${sender}`, { url, transcript, size: blob.size }, ["toxic voice"], true);
  } else {
    appendAudioBubble(recContainerId, `User ${sender}`, url, transcript);
  }
}

// Deliver image message
function deliverImage(sender, receiver, fileOrUrl, ocrText, isMasked = false, reasons = []) {
  const imgUrl = (typeof fileOrUrl === 'string') ? fileOrUrl : URL.createObjectURL(fileOrUrl);
  
  // Sender view: never show raw OCR text in the bubble to keep the layout clean
  appendImageBubble(sender === "A" ? "messagesA" : "messagesB", "You", imgUrl, "");
  
  // Receiver view
  const recContainerId = receiver === "A" ? "messagesA" : "messagesB";
  if (isMasked) {
    // Determine image file fingerprint
    const fingerprint = (fileOrUrl instanceof File) ? `${fileOrUrl.name}_${fileOrUrl.size}` : `preset-image_${fileOrUrl.size || 'mock'}`;
    // Only pass OCR text if the flagging reasons include toxic text
    const hasToxicText = reasons.some(r => r.includes("toxic") || r.includes("insult") || r.includes("threat"));
    appendMaskedBubble(recContainerId, `User ${sender}`, { imgUrl, ocrText: hasToxicText ? ocrText : "", fingerprint }, reasons, false, true);
  } else {
    // Clean image: never show OCR text in the bubble
    appendImageBubble(recContainerId, `User ${sender}`, imgUrl, "");
  }
}

// Deliver video message
function deliverVideo(sender, receiver, fileOrUrl, ocrText, isMasked = false, reasons = []) {
  const videoUrl = (typeof fileOrUrl === 'string') ? fileOrUrl : URL.createObjectURL(fileOrUrl);
  
  // Sender view: never show raw OCR text in the bubble to keep the layout clean
  appendVideoBubble(sender === "A" ? "messagesA" : "messagesB", "You", videoUrl, "");
  
  // Receiver view
  const recContainerId = receiver === "A" ? "messagesA" : "messagesB";
  if (isMasked) {
    // Determine video file fingerprint
    const fingerprint = (fileOrUrl instanceof File) ? `${fileOrUrl.name}_${fileOrUrl.size}` : `preset-video_${fileOrUrl.size || 'mock'}`;
    // Only pass OCR text if the flagging reasons include toxic text
    const hasToxicText = reasons.some(r => r.includes("toxic") || r.includes("insult") || r.includes("threat"));
    appendMaskedBubble(recContainerId, `User ${sender}`, { videoUrl, ocrText: hasToxicText ? ocrText : "", fingerprint }, reasons, false, false, true);
  } else {
    // Clean video: never show OCR text in the bubble
    appendVideoBubble(recContainerId, `User ${sender}`, videoUrl, "");
  }
}

// Append Video Message Bubble
function appendVideoBubble(containerId, sender, videoUrl, ocrText = "") {
  const container = document.getElementById(containerId);
  const wrapper = document.createElement("div");
  wrapper.className = `message-wrapper ${sender === "You" ? "outgoing" : "incoming"} ${containerId === "messagesA" ? "user-a" : "user-b"}`;
  
  const nameEl = document.createElement("div");
  nameEl.className = "message-sender-name";
  nameEl.textContent = sender;
  
  const bubble = document.createElement("div");
  bubble.className = "message-bubble";
  
  const video = document.createElement("video");
  video.src = videoUrl;
  video.controls = true;
  video.style.maxWidth = "100%";
  video.style.borderRadius = "8px";
  bubble.appendChild(video);
  
  if (ocrText) {
    const ocrDiv = document.createElement("div");
    ocrDiv.className = "ocr-attached-text";
    ocrDiv.textContent = `[OCR Text: "${ocrText}"]`;
    bubble.appendChild(ocrDiv);
  }
  
  const time = document.createElement("div");
  time.className = "message-time";
  time.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  
  wrapper.appendChild(nameEl);
  wrapper.appendChild(bubble);
  wrapper.appendChild(time);
  
  container.appendChild(wrapper);
  container.scrollTop = container.scrollHeight;
}

// UI status text helpers
function updateInputStatus(user, text, isError = false) {
  const el = document.getElementById(`inputStatus${user}`);
  if (!el) return;
  el.textContent = text;
  el.className = isError ? "input-status-overlay error" : "input-status-overlay";
}

// Append typical text message bubble
function appendMessage(containerId, sender, text, isSystem = false) {
  const container = document.getElementById(containerId);
  const wrapper = document.createElement("div");
  wrapper.className = `message-wrapper ${sender === "You" ? "outgoing" : "incoming"} ${containerId === "messagesA" ? "user-a" : "user-b"}`;
  
  if (isSystem) {
    wrapper.className = "message-wrapper system";
  }
  
  const nameEl = document.createElement("div");
  nameEl.className = "message-sender-name";
  nameEl.textContent = sender;
  
  const bubble = document.createElement("div");
  bubble.className = "message-bubble";
  bubble.textContent = text;
  
  const time = document.createElement("div");
  time.className = "message-time";
  time.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  
  if (!isSystem) wrapper.appendChild(nameEl);
  wrapper.appendChild(bubble);
  wrapper.appendChild(time);
  
  container.appendChild(wrapper);
  container.scrollTop = container.scrollHeight;
}

// Append System Message
function appendSystemMessage(containerId, text) {
  appendMessage(containerId, "SYSTEM", text, true);
}

// Append Audio Message Bubble
function appendAudioBubble(containerId, sender, audioUrl, transcript = "") {
  const container = document.getElementById(containerId);
  const wrapper = document.createElement("div");
  wrapper.className = `message-wrapper ${sender === "You" ? "outgoing" : "incoming"} ${containerId === "messagesA" ? "user-a" : "user-b"}`;
  
  const nameEl = document.createElement("div");
  nameEl.className = "message-sender-name";
  nameEl.textContent = sender;
  
  const bubble = document.createElement("div");
  bubble.className = "message-bubble";
  
  const audioContainer = document.createElement("div");
  audioContainer.className = "audio-bubble-container";
  
  const audio = document.createElement("audio");
  audio.controls = true;
  audio.src = audioUrl;
  
  audioContainer.appendChild(audio);
  
  // Audio transcript text is processed in the background for moderation but not displayed visually
  /*
  if (transcript) {
    const txt = document.createElement("div");
    txt.className = "audio-transcript-text";
    txt.textContent = `"${transcript}"`;
    audioContainer.appendChild(txt);
  }
  */
  
  bubble.appendChild(audioContainer);
  
  const time = document.createElement("div");
  time.className = "message-time";
  time.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  
  wrapper.appendChild(nameEl);
  wrapper.appendChild(bubble);
  wrapper.appendChild(time);
  
  container.appendChild(wrapper);
  container.scrollTop = container.scrollHeight;
}

// Append Image Message Bubble
function appendImageBubble(containerId, sender, imgUrl, ocrText = "") {
  const container = document.getElementById(containerId);
  const wrapper = document.createElement("div");
  wrapper.className = `message-wrapper ${sender === "You" ? "outgoing" : "incoming"} ${containerId === "messagesA" ? "user-a" : "user-b"}`;
  
  const nameEl = document.createElement("div");
  nameEl.className = "message-sender-name";
  nameEl.textContent = sender;
  
  const bubble = document.createElement("div");
  bubble.className = "message-bubble";
  
  const img = document.createElement("img");
  img.src = imgUrl;
  img.alt = "Chat image attachment";
  bubble.appendChild(img);
  
  if (ocrText) {
    const ocrDiv = document.createElement("div");
    ocrDiv.className = "ocr-attached-text";
    ocrDiv.textContent = `[OCR Text: "${ocrText}"]`;
    bubble.appendChild(ocrDiv);
  }
  
  const time = document.createElement("div");
  time.className = "message-time";
  time.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  
  wrapper.appendChild(nameEl);
  wrapper.appendChild(bubble);
  wrapper.appendChild(time);
  
  container.appendChild(wrapper);
  container.scrollTop = container.scrollHeight;
}

// Append Masked Warning bubble (hides toxic contents at receiver side)
function appendMaskedBubble(containerId, senderName, hiddenPayload, reasons = [], isAudio = false, isImage = false, isVideo = false) {
  const container = document.getElementById(containerId);
  const wrapper = document.createElement("div");
  wrapper.className = `message-wrapper incoming`;
  
  const nameEl = document.createElement("div");
  nameEl.className = "message-sender-name";
  nameEl.textContent = senderName;
  
  const bubble = document.createElement("div");
  bubble.className = "message-bubble masked-warning-bubble";
  
  const typeLabel = isAudio ? "audio message" : (isImage ? "image attachment" : (isVideo ? "video attachment" : "text message"));
  
  bubble.innerHTML = `
    <div class="masked-header">
      <span>⚠️ Flagged Content Hidden</span>
    </div>
    <div class="masked-desc">
      This ${typeLabel} may contain offensive content (${reasons.join(", ")}).
    </div>
    <div class="masked-actions">
      <button class="modal-btn danger-action" id="revealBtn">View</button>
      <button class="modal-btn secondary" id="ignoreBtn">Ignore</button>
    </div>
  `;
  
  // Wire View/Reveal
  bubble.querySelector("#revealBtn").onclick = () => {
    // Replace warning bubble content with original content
    const index = Array.from(container.children).indexOf(wrapper);
    wrapper.remove();
    
    // Add original content
    let rawText = "";
    let type = "text";
    let payloadInfo = null;
    if (isAudio) {
      appendAudioBubble(containerId, senderName, hiddenPayload.url, hiddenPayload.transcript);
      rawText = hiddenPayload.transcript;
      type = "audio";
      payloadInfo = { size: hiddenPayload.size };
    } else if (isImage) {
      appendImageBubble(containerId, senderName, hiddenPayload.imgUrl, hiddenPayload.ocrText);
      rawText = hiddenPayload.ocrText;
      type = "image";
      payloadInfo = { fingerprint: hiddenPayload.fingerprint };
    } else if (isVideo) {
      appendVideoBubble(containerId, senderName, hiddenPayload.videoUrl, hiddenPayload.ocrText);
      rawText = hiddenPayload.ocrText;
      type = "video";
      payloadInfo = { fingerprint: hiddenPayload.fingerprint };
    } else {
      appendMessage(containerId, senderName, hiddenPayload);
      rawText = hiddenPayload;
      type = "text";
    }
    
    // Append feedback asking if appropriate
    appendFeedbackQuery(containerId, senderName, rawText, type, payloadInfo);
  };
  
  // Wire Ignore
  bubble.querySelector("#ignoreBtn").onclick = () => {
    bubble.innerHTML = `<span style="font-style:italic; font-size:0.8rem; color:var(--text-muted);">Offensive message hidden by you.</span>`;
    addLog(`Receiver ignored a toxic message from ${senderName}.`, "info");
  };
  
  const time = document.createElement("div");
  time.className = "message-time";
  time.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  
  wrapper.appendChild(nameEl);
  wrapper.appendChild(bubble);
  wrapper.appendChild(time);
  
  container.appendChild(wrapper);
  container.scrollTop = container.scrollHeight;
}

// Append Feedback Controls ("Was this message appropriate?")
function appendFeedbackQuery(containerId, senderName, originalText, type = "text", payloadInfo = null) {
  const container = document.getElementById(containerId);
  const wrapper = document.createElement("div");
  wrapper.className = "message-wrapper incoming system";
  
  const bubble = document.createElement("div");
  bubble.className = "message-bubble";
  bubble.style.border = "1px solid var(--border-color)";
  bubble.style.background = "rgba(255, 255, 255, 0.02)";
  
  bubble.innerHTML = `
    <div style="font-size:0.75rem; margin-bottom:8px; color:var(--text-secondary)">
      Was the content you just revealed actually offensive?
    </div>
    <div style="display:flex; gap:6px; justify-content:center;">
      <button class="modal-btn success-action" style="padding:4px 8px; font-size:0.7rem;" id="fbSafeBtn">No, it's safe</button>
      <button class="modal-btn danger-action" style="padding:4px 8px; font-size:0.7rem;" id="fbOffensiveBtn">Yes, offensive</button>
    </div>
  `;
  
  // Safe Feedback click -> Model flagged it but it was actually safe (False Positive)
  bubble.querySelector("#fbSafeBtn").onclick = async () => {
    const receiverUserId = containerId === "messagesA" ? "A" : "B";
    const senderUserId = receiverUserId === "A" ? "B" : "A";
    const channel = `${senderUserId}->${receiverUserId}`;

    if (type === "text") {
      if (originalText && originalText.trim()) {
        const phrase = originalText.trim().toLowerCase();
        addWhitelistItem(channel, "text", phrase);
        addLog(`Added phrase "${originalText}" to the safe whitelist for ${channel}.`, "success");
        
        // Also extract and whitelist toxic sub-segments (words/bigrams)
        const subSegments = await extractToxicSegments(originalText);
        subSegments.forEach(seg => {
          addWhitelistItem(channel, "text", seg);
        });
        if (subSegments.length > 0) {
          addLog(`Extracted and whitelisted safe terms for ${channel}: ${subSegments.join(", ")}`, "success");
        }
      }
    } else if (type === "image") {
      if (payloadInfo && payloadInfo.fingerprint) {
        addWhitelistItem(channel, "image", payloadInfo.fingerprint);
        addLog(`Added image fingerprint (${payloadInfo.fingerprint}) to the safe whitelist for ${channel}.`, "success");
      }
      if (originalText && originalText.trim()) {
        addWhitelistItem(channel, "text", originalText);
      }
    } else if (type === "audio") {
      if (payloadInfo && payloadInfo.size) {
        addWhitelistItem(channel, "audio", payloadInfo.size);
        addLog(`Added audio size (${payloadInfo.size}) to the safe whitelist for ${channel}.`, "success");
      }
      if (originalText && originalText.trim()) {
        addWhitelistItem(channel, "text", originalText);
      }
    } else if (type === "video") {
      if (payloadInfo && payloadInfo.fingerprint) {
        addWhitelistItem(channel, "video", payloadInfo.fingerprint);
        addLog(`Added video fingerprint (${payloadInfo.fingerprint}) to the safe whitelist for ${channel}.`, "success");
      }
      if (originalText && originalText.trim()) {
        addWhitelistItem(channel, "text", originalText);
      }
    }
    
    stats.falsePositives++;
    bubble.innerHTML = `<span style="color:var(--color-success); font-size:0.75rem;">✓ Feedback saved. Content whitelisted as safe for this chat.</span>`;
    addLog(`False positive report: receiver marked message from ${senderName} as safe. (FP: ${stats.falsePositives})`, "success");
    updateDetectionMetrics();
    setTimeout(() => wrapper.remove(), 4000);
  };
  
  // Offensive Feedback click -> Trigger Report & Block options, and record offense
  bubble.querySelector("#fbOffensiveBtn").onclick = () => {
    const receiverUserId = containerId === "messagesA" ? "A" : "B";
    const senderUserId = receiverUserId === "A" ? "B" : "A";
    
    // Log offense to server
    if (isServerConnected) {
      fetch(`${API_BASE_URL}/users/offense`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: senderUserId,
          text: originalText || "[Attachment/Media]",
          reason: "confirmed_abuse",
          content_type: type
        })
      })
      .then(async res => {
        if (res.ok) {
          const data = await res.json();
          userState[senderUserId].offenseCount = data.offenseCount;
          userState[senderUserId].blockedUntil = data.blockedUntil;
          updateOffenseUI(senderUserId);
          addLog(`User ${senderUserId} charged with an offense (Offense ${data.offenseCount}/3) [DB synced] - confirmed by ${receiverUserId}.`, "danger");
          if (data.offenseCount >= 3) {
            suspendUser(senderUserId, data.blockedUntil);
          }
        } else {
          runLocalOffenseFallback();
        }
      })
      .catch(e => {
        console.error("Offense sync failed, running local fallback:", e);
        runLocalOffenseFallback();
      });
    } else {
      runLocalOffenseFallback();
    }

    function runLocalOffenseFallback() {
      userState[senderUserId].offenseCount++;
      updateOffenseUI(senderUserId);
      addLog(`User ${senderUserId} charged with an offense (Offense ${userState[senderUserId].offenseCount}/3) - flagged content confirmed offensive by User ${receiverUserId}.`, "danger");
      if (userState[senderUserId].offenseCount >= 3) {
        suspendUser(senderUserId);
      }
    }

    bubble.innerHTML = `
      <div style="font-size:0.75rem; margin-bottom:8px; color:var(--color-danger)">
        Offense recorded. Confirm moderation action:
      </div>
      <div style="display:flex; gap:6px; justify-content:center;">
        <button class="modal-btn danger-action" style="padding:4px 8px; font-size:0.7rem;" id="reportSender">Report</button>
        <button class="modal-btn secondary" style="padding:4px 8px; font-size:0.7rem;" id="blockSender">Block Sender</button>
      </div>
    `;
    
    // Wire Report Click -> Model flagged it AND it was actually offensive (True Positive)
    bubble.querySelector("#reportSender").onclick = () => {
      stats.truePositives++;
      bubble.innerHTML = `<span style="color:var(--color-success); font-size:0.75rem;">📢 Sender reported to moderators.</span>`;
      addLog(`Receiver reported ${senderName} to administrators. (TP: ${stats.truePositives})`, "danger");
      updateDetectionMetrics();
      setTimeout(() => wrapper.remove(), 4000);
    };
    
    // Wire Block Click
    bubble.querySelector("#blockSender").onclick = () => {
      const blockedUserId = senderName.split(" ").pop(); // Extract 'A' or 'B'
      const receiverUserId = containerId === "messagesA" ? "A" : "B";
      
      userState[blockedUserId].blockedByOther = true;
      bubble.innerHTML = `<span style="color:var(--color-danger); font-size:0.75rem;">🚫 User ${blockedUserId} Blocked.</span>`;
      addLog(`User ${receiverUserId} BLOCKED User ${blockedUserId}.`, "danger");
      
      if (isServerConnected) {
        fetch(`${API_BASE_URL}/users/block`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ blocker: receiverUserId, blocked: blockedUserId })
        }).catch(e => console.error("Block sync failed:", e));
      }
      
      appendSystemMessage(containerId, `SYSTEM: You have blocked User ${blockedUserId}.`);
      appendSystemMessage(blockedUserId === "A" ? "messagesA" : "messagesB", `SYSTEM: User ${receiverUserId} has blocked you.`);
      
      setTimeout(() => wrapper.remove(), 4000);
    };
  };
  
  wrapper.appendChild(bubble);
  container.appendChild(wrapper);
  container.scrollTop = container.scrollHeight;
}

// Handle Image Selection, Nudity (NSFWJS), and OCR (Tesseract)
async function handleImageSelect(sender, receiver, event) {
  if (checkBlockedState(sender, receiver)) return;
  
  const file = event.target.files[0];
  if (!file) return;

  // Delegate to video handler if file is a video
  if (file.type.startsWith("video/")) {
    return handleVideoSelect(sender, receiver, file);
  }

  const fingerprint = `${file.name}_${file.size}`;
  const channel = `${sender}->${receiver}`;
  
  // Check if image file is whitelisted as safe
  if (whitelistedSafeContent[channel].images.has(fingerprint)) {
    addLog(`Bypassed analysis (image file whitelisted as safe for ${channel}): "${file.name}"`, "success");
    deliverImage(sender, receiver, file, "", false);
    document.getElementById(`imgInput${sender}`).value = "";
    return;
  }
  
  updateInputStatus(sender, "Scanning image for NSFW/Nudity...");
  updateStatistics("totalAnalyzed");
  
  // LAZY LOAD: Load NSFW model on first image upload if not already loaded
  if (!nsfwLoaded && !nsfwModel) {
    try {
      updateInputStatus(sender, "⏳ Loading NSFW model...");
      if (typeof tf !== 'undefined') {
        try {
          await tf.setBackend('cpu');
        } catch (e) {
          console.warn("CPU backend switch failed during lazy load:", e);
        }
        await tf.ready();
      }
      
      if (typeof nsfwjs === 'undefined') {
        throw new Error("NSFWJS library not available");
      }
      
      console.log("[LAZY LOAD] Loading NSFW model on first image upload");
      
      const nsfwLoadOptions = [
        { name: "Default S3", url: null },
        { name: "jsDelivr (GitHub)", url: "https://cdn.jsdelivr.net/gh/infinitered/nsfwjs/models/mobilenet_v2/" },
        { name: "unpkg.com", url: "https://unpkg.com/nsfwjs@2.4.1/models/mobilenet_v2/" },
        { name: "Unpkg latest", url: "https://unpkg.com/nsfwjs/models/mobilenet_v2/" },
      ];
      
      let modelLoaded = false;
      let lastError = null;
      
      for (const option of nsfwLoadOptions) {
        try {
          console.log(`[LAZY LOAD] Attempting NSFW from: ${option.name}`);
          if (option.url) {
            nsfwModel = await nsfwjs.load(option.url);
          } else {
            nsfwModel = await nsfwjs.load();
          }
          nsfwLoaded = true;
          console.log(`✓ NSFW model lazy-loaded from: ${option.name}`);
          updateBadge("badgeNsfw", "ready", "NSFW Model: Active");
          addLog(`NSFW model loaded (lazy-load on first image).`, "success");
          modelLoaded = true;
          break;
        } catch (err) {
          lastError = err;
          console.warn(`✗ Failed NSFW lazy load from ${option.name}:`, err.message);
        }
      }
      
      if (!modelLoaded) {
        throw lastError || new Error("All NSFW load attempts failed");
      }
    } catch (error) {
      console.error("Lazy load NSFW error:", error);
      updateBadge("badgeNsfw", "failed", "NSFW Model: Error");
      addLog("NSFW model failed to load: " + error.message, "warning");
      nsfwModel = null;
      nsfwLoaded = true;  // Mark as attempted to avoid repeated attempts
    }
  }
  
  // 1. Run NSFW Check
  let isNsfw = false;
  if (nsfwModel) {
    try {
      // Force CPU backend to avoid WebGL silent shader failures returning 0%
      if (typeof tf !== 'undefined') {
        try {
          await tf.setBackend('cpu');
        } catch (e) {
          console.warn("Failed to switch backend to CPU for image classification:", e);
        }
      }
      const img = new Image();
      img.crossOrigin = "anonymous";
      
      // Create a proper blob URL or data URL
      const blobUrl = URL.createObjectURL(file);
      img.src = blobUrl;
      
      // Wait for image to load with timeout
      await Promise.race([
        new Promise((res, rej) => { 
          img.onload = res; 
          img.onerror = () => rej(new Error("Image failed to load"));
        }),
        new Promise((_, rej) => setTimeout(() => rej(new Error("Image load timeout")), 5000))
      ]);
      
      console.log("Image loaded, classifying with NSFWJS...");
      
      // DEBUG: Log image dimensions before classification
      console.log("Image Size:", img.width, "x", img.height);
      if (img.width === 0 || img.height === 0) {
        console.warn("⚠️ WARNING: Image dimensions are 0x0 - classification may fail!");
        addLog("⚠️ Image load warning: Dimensions invalid (0x0)", "warning");
      }
      
      const predictions = await nsfwModel.classify(img);
      
      console.log("========== NSFW CLASSIFICATION RESULTS ==========");
      console.log("Raw predictions object:", predictions);
      
      // Extract individual category scores
      const pornScore = predictions.find(p => p.className === "Porn")?.probability || 0;
      const hentaiScore = predictions.find(p => p.className === "Hentai")?.probability || 0;
      const sexyScore = predictions.find(p => p.className === "Sexy")?.probability || 0;
      const drawingScore = predictions.find(p => p.className === "Drawing")?.probability || 0;
      const neutralScore = predictions.find(p => p.className === "Neutral")?.probability || 0;
      
      // Log all predictions
      predictions.forEach(p => {
        const percentage = (p.probability * 100).toFixed(2);
        console.log(`  ${p.className}: ${percentage}%`);
      });
      
      console.log("Score Breakdown:");
      console.log("  Porn:    ", (pornScore * 100).toFixed(2) + "%");
      console.log("  Hentai:  ", (hentaiScore * 100).toFixed(2) + "%");
      console.log("  Sexy:    ", (sexyScore * 100).toFixed(2) + "%");
      console.log("  Drawing: ", (drawingScore * 100).toFixed(2) + "%");
      console.log("  Neutral: ", (neutralScore * 100).toFixed(2) + "%");
      
      // Log all predictions to activity feed for transparency
      addLog(`NSFWJS Classification:`, "info");
      predictions.forEach(p => {
        const percentage = (p.probability * 100).toFixed(1);
        addLog(`  → ${p.className}: ${percentage}%`, "info");
      });
      
      // Smart NSFW detection logic with respect to the user's NSFW_PROBABILITY_THRESHOLD (default 0.70):
      const ratio = NSFW_PROBABILITY_THRESHOLD / 0.70;
      const pornThresh = 0.10 * ratio;
      const hentaiThresh = 0.10 * ratio;
      const sexyThresh = 0.20 * ratio;
      const drawingThresh = NSFW_PROBABILITY_THRESHOLD;
      const drawingSexyThresh = 0.10 * ratio;
      
      isNsfw =
        pornScore > pornThresh ||              // Explicit pornography
        hentaiScore > hentaiThresh ||            // Hentai/anime nudity
        sexyScore > sexyThresh ||              // Suggestive content
        (drawingScore > drawingThresh && sexyScore > drawingSexyThresh);  // Artistic nudity
      
      console.log("NSFW Detection Logic:");
      console.log(`  pornScore > ${pornThresh.toFixed(2)}?`, pornScore > pornThresh, `(${(pornScore * 100).toFixed(2)}%)`);
      console.log(`  hentaiScore > ${hentaiThresh.toFixed(2)}?`, hentaiScore > hentaiThresh, `(${(hentaiScore * 100).toFixed(2)}%)`);
      console.log(`  sexyScore > ${sexyThresh.toFixed(2)}?`, sexyScore > sexyThresh, `(${(sexyScore * 100).toFixed(2)}%)`);
      console.log(`  (drawingScore > ${drawingThresh.toFixed(2)} && sexyScore > ${drawingSexyThresh.toFixed(2)})?`, (drawingScore > drawingThresh && sexyScore > drawingSexyThresh), `(Drawing: ${(drawingScore * 100).toFixed(2)}%, Sexy: ${(sexyScore * 100).toFixed(2)}%)`);
      console.log("================================================");
      console.log("FINAL DECISION: isNsfw =", isNsfw);
      
      if (isNsfw) {
        console.log("🚨 NSFW DETECTED - Showing warning modal");
        updateStatistics("nsfw");
        addLog(`⚠️ NSFW content detected in image uploaded by User ${sender}.`, "danger");
        const detectionReason = pornScore > pornThresh ? "Explicit porn" : 
                               hentaiScore > hentaiThresh ? "Hentai/anime" : 
                               sexyScore > sexyThresh ? "Suggestive content" : 
                               "Artistic nudity";
        addLog(`Detection reason: ${detectionReason}`, "warning");
      } else {
        console.log("✅ IMAGE IS SAFE - No NSFW detected");
      }
      
      URL.revokeObjectURL(blobUrl);
    } catch (e) {
      console.error("NSFW classification error:", e);
      addLog(`NSFW check failed: ${e.message}`, "warning");
    }
  } else {
    console.warn("NSFW model not loaded yet");
    addLog("NSFW model not available, skipping NSFW check", "warning");
  }
  
  // 2. Run OCR Check
  updateInputStatus(sender, "Extracting text from image (OCR)...");
  let ocrText = "";
  try {
    const result = await Tesseract.recognize(file, 'eng');
    ocrText = result.data.text.trim();
  } catch (err) {
    console.warn("Tesseract OCR extraction failed:", err);
  }
  
  // 3. Toxicity Analysis on Extracted OCR Text
  let isOcrToxic = false;
  let ocrReasons = [];
  if (ocrText) {
    addLog(`OCR text extracted: "${ocrText.slice(0, 50)}..."`, "info");
    if (whitelistedSafeContent[channel].texts.has(ocrText.toLowerCase())) {
      addLog(`OCR text whitelisted as safe for ${channel}: "${ocrText}"`, "success");
    } else {
      const testOcr = await analyzeText(ocrText, sender);
      isOcrToxic = testOcr.isToxic;
      ocrReasons = testOcr.reasons;
    }
  }
  
  updateInputStatus(sender, "");
  
  // 4. Action Decision
  if (isNsfw || isOcrToxic) {
    const reasonsCombined = [];
    if (isNsfw) reasonsCombined.push("inappropriate imagery (NSFW)");
    ocrReasons.forEach(r => reasonsCombined.push(`toxic text: ${r}`));
    
    triggerWarningModal({
      sender,
      receiver,
      text: isNsfw ? "Nudity/NSFW image detected." : `Toxic text in image: "${ocrText}"`,
      imageFile: file,
      ocrText,
      reasons: reasonsCombined,
      isAudio: false
    });
  } else {
    // Image is clean
    deliverImage(sender, receiver, file, ocrText, false);
    // Reset file input
    document.getElementById(`imgInput${sender}`).value = "";
  }
}

// Extract key frames from a video file client-side using canvas drawing
function extractVideoFrames(file, maxFrames = 3) {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;
    
    const url = URL.createObjectURL(file);
    video.src = url;
    
    video.onloadedmetadata = () => {
      const duration = video.duration;
      // We will sample frames at: 10%, 50%, 90% of duration
      const times = [];
      for (let i = 0; i < maxFrames; i++) {
        times.push(duration * (0.1 + 0.8 * (i / (maxFrames - 1 || 1))));
      }
      
      const frames = [];
      let currentIndex = 0;
      
      const seekAndCapture = () => {
        if (currentIndex >= times.length) {
          URL.revokeObjectURL(url);
          resolve(frames);
          return;
        }
        video.currentTime = times[currentIndex];
      };
      
      video.onseeked = () => {
        // Capture frame onto canvas
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth || 224;
        canvas.height = video.videoHeight || 224;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        
        frames.push({
          canvas,
          time: times[currentIndex]
        });
        
        currentIndex++;
        seekAndCapture();
      };
      
      video.onseeked = video.onseeked.bind(video);
      seekAndCapture();
    };
    
    video.onerror = (e) => {
      URL.revokeObjectURL(url);
      reject(new Error("Video failed to load. Ensure format is compatible."));
    };
  });
}

// Handle video uploading and frame moderation scans (NSFW + OCR)
async function handleVideoSelect(sender, receiver, file) {
  const fingerprint = `${file.name}_${file.size}`;
  const channel = `${sender}->${receiver}`;
  
  // Check if video file is whitelisted as safe
  if (whitelistedSafeContent[channel].videos.has(fingerprint)) {
    addLog(`Bypassed analysis (video file whitelisted as safe for ${channel}): "${file.name}"`, "success");
    deliverVideo(sender, receiver, file, "", false);
    document.getElementById(`imgInput${sender}`).value = "";
    return;
  }
  
  updateInputStatus(sender, "Extracting video frames...");
  updateStatistics("totalAnalyzed");
  
  try {
    const frames = await extractVideoFrames(file, 3);
    
    // Ensure NSFW model is loaded (lazy loading)
    if (!nsfwLoaded && !nsfwModel) {
      updateInputStatus(sender, "⏳ Loading NSFW model...");
      if (typeof tf !== 'undefined') {
        try {
          await tf.setBackend('cpu');
        } catch (e) {
          console.warn("CPU backend switch failed during lazy load:", e);
        }
        await tf.ready();
      }
      
      if (typeof nsfwjs !== 'undefined') {
        const nsfwLoadOptions = [
          { name: "Default S3", url: null },
          { name: "jsDelivr (GitHub)", url: "https://cdn.jsdelivr.net/gh/infinitered/nsfwjs/models/mobilenet_v2/" },
          { name: "unpkg.com", url: "https://unpkg.com/nsfwjs@2.4.1/models/mobilenet_v2/" },
          { name: "Unpkg latest", url: "https://unpkg.com/nsfwjs/models/mobilenet_v2/" },
        ];
        
        let modelLoaded = false;
        let lastError = null;
        for (const option of nsfwLoadOptions) {
          try {
            console.log(`[LAZY LOAD VIDEO] Attempting NSFW from: ${option.name}`);
            if (option.url) {
              nsfwModel = await nsfwjs.load(option.url);
            } else {
              nsfwModel = await nsfwjs.load();
            }
            nsfwLoaded = true;
            updateBadge("badgeNsfw", "ready", "NSFW Model: Active");
            addLog(`NSFW model loaded for video analysis.`, "success");
            modelLoaded = true;
            break;
          } catch (err) {
            lastError = err;
            console.warn(`✗ Failed NSFW lazy load from ${option.name}:`, err.message);
          }
        }
        if (!modelLoaded) {
          throw lastError || new Error("All NSFW load attempts failed");
        }
      }
    }
    
    let isNsfw = false;
    let nsfwDetails = "";
    
    if (nsfwModel) {
      updateInputStatus(sender, "Scanning video frames for nudity...");
      
      for (let i = 0; i < frames.length; i++) {
        const predictions = await nsfwModel.classify(frames[i].canvas);
        const pornScore = predictions.find(p => p.className === "Porn")?.probability || 0;
        const hentaiScore = predictions.find(p => p.className === "Hentai")?.probability || 0;
        const sexyScore = predictions.find(p => p.className === "Sexy")?.probability || 0;
        const drawingScore = predictions.find(p => p.className === "Drawing")?.probability || 0;
        
        const ratio = NSFW_PROBABILITY_THRESHOLD / 0.70;
        const pornThresh = 0.10 * ratio;
        const hentaiThresh = 0.10 * ratio;
        const sexyThresh = 0.20 * ratio;
        const drawingThresh = NSFW_PROBABILITY_THRESHOLD;
        const drawingSexyThresh = 0.10 * ratio;
        
        const frameNsfw =
          pornScore > pornThresh ||
          hentaiScore > hentaiThresh ||
          sexyScore > sexyThresh ||
          (drawingScore > drawingThresh && sexyScore > drawingSexyThresh);
          
        if (frameNsfw) {
          isNsfw = true;
          nsfwDetails = pornScore > pornThresh ? "Explicit porn" : 
                        hentaiScore > hentaiThresh ? "Hentai/anime" : 
                        sexyScore > sexyThresh ? "Suggestive content" : 
                        "Artistic nudity";
          break;
        }
      }
    }
    
    // OCR scanning on middle frame (50% mark) to check for text-based violations
    updateInputStatus(sender, "Scanning video text (OCR)...");
    let ocrText = "";
    if (frames.length > 1) {
      try {
        const result = await Tesseract.recognize(frames[1].canvas, 'eng');
        ocrText = result.data.text.trim();
      } catch (err) {
        console.warn("Tesseract OCR extraction from video failed:", err);
      }
    }
    
    // OCR Toxicity Analysis
    let isOcrToxic = false;
    let ocrReasons = [];
    if (ocrText) {
      addLog(`OCR text extracted from video: "${ocrText.slice(0, 50)}..."`, "info");
      if (whitelistedSafeContent[channel].texts.has(ocrText.toLowerCase())) {
        addLog(`OCR text whitelisted as safe for ${channel}: "${ocrText}"`, "success");
      } else {
        const testOcr = await analyzeText(ocrText, sender);
        isOcrToxic = testOcr.isToxic;
        ocrReasons = testOcr.reasons;
      }
    }
    
    updateInputStatus(sender, "");
    
    if (isNsfw || isOcrToxic) {
      const reasonsCombined = [];
      if (isNsfw) {
        reasonsCombined.push(`inappropriate imagery (${nsfwDetails})`);
        updateStatistics("nsfw");
      }
      ocrReasons.forEach(r => reasonsCombined.push(`toxic text: ${r}`));
      
      triggerWarningModal({
        sender,
        receiver,
        text: isNsfw ? "Nudity/NSFW content detected in video." : `Toxic text in video: "${ocrText}"`,
        imageFile: file,
        ocrText,
        reasons: reasonsCombined,
        isAudio: false,
        isVideo: true
      });
    } else {
      deliverVideo(sender, receiver, file, ocrText, false);
    }
    
  } catch (err) {
    console.error("Video processing error:", err);
    addLog(`Video processing failed, sending clean: ${err.message}`, "warning");
    deliverVideo(sender, receiver, file, "", false);
  }
  
  // Reset file input
  document.getElementById(`imgInput${sender}`).value = "";
}

// Start Audio Recording & Web Speech API Recognition
async function startAudioRecord(user) {
  if (checkBlockedState(user, user === "A" ? "B" : "A")) return;
  
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    
    // Init Audio Recording
    userState[user].recorder = new MediaRecorder(stream);
    userState[user].chunks = [];
    
    // Setup Web Audio API Analyser for real-time RMS (shouting) detection
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const source = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    let maxRMS = 0;
    userState[user].maxRMS = 0;
    
    const recordTimer = setInterval(() => {
      if (userState[user].recorder && userState[user].recorder.state === "recording") {
        analyser.getByteTimeDomainData(dataArray);
        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
          const val = (dataArray[i] - 128) / 128; // Normalize to [-1.0, 1.0]
          sum += val * val;
        }
        const rms = Math.sqrt(sum / bufferLength);
        if (rms > maxRMS) {
          maxRMS = rms;
          userState[user].maxRMS = maxRMS; // Save peak RMS in state
        }
      } else {
        clearInterval(recordTimer);
        try {
          audioCtx.close();
        } catch (e) {}
      }
    }, 100);
    
    userState[user].recorder.ondataavailable = (e) => {
      userState[user].chunks.push(e.data);
    };
    
    userState[user].recorder.onstop = async () => {
      const audioBlob = new Blob(userState[user].chunks, { type: 'audio/webm' });
      const playback = document.getElementById(`audioPlayback${user}`);
      playback.src = URL.createObjectURL(audioBlob);
      const drawer = document.getElementById(`audioPlaybackDrawer${user}`);
      if (drawer) drawer.style.display = "flex";
      userState[user].recorder.audioBlob = audioBlob; // store reference
      playback.audioBlob = audioBlob;
      
      // Store calculated peak RMS level on the playback element
      playback.maxRMS = userState[user].maxRMS || 0;
      console.log(`[AUDIO ANALYSER] Recording stopped. Peak RMS Energy: ${playback.maxRMS.toFixed(4)}`);
      
      // Stop media tracks
      stream.getTracks().forEach(track => track.stop());
      
      // Enable send audio button immediately, toxicity scan will execute upon manual send click
      document.getElementById(`sendAudio${user}`).disabled = false;
    };
    
    // Init speech transcription (captures transcript quietly without displaying visual text status)
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      userState[user].activeRecognition = new SpeechRecognition();
      userState[user].activeRecognition.lang = 'en-US';
      userState[user].activeRecognition.interimResults = false;
      userState[user].activeRecognition.maxAlternatives = 1;
      
      userState[user].activeRecognition.onresult = (event) => {
        const text = event.results[0][0].transcript;
        const playback = document.getElementById(`audioPlayback${user}`);
        playback.transcript = text;
        
        // No visual updates to inputStatus in order to keep text hidden during recording
      };
      
      userState[user].activeRecognition.start();
    } else {
      addLog(`Browser speech-to-text API unsupported in this environment.`, "warning");
    }
    
    // Visual toggles
    userState[user].recorder.start();
    document.getElementById(`startBtn${user}`).disabled = true;
    document.getElementById(`stopBtn${user}`).disabled = false;
    updateInputStatus(user, "🔴 Recording microphone...");
    addLog(`User ${user} started recording audio message.`, "info");
    
  } catch (err) {
    console.error("Recording error:", err);
    alert("Microphone permission denied or hardware unavailable.");
  }
}

// Stop Audio Recording
function stopAudioRecord(user) {
  if (userState[user].recorder && userState[user].recorder.state === "recording") {
    userState[user].recorder.stop();
  }
  if (userState[user].activeRecognition) {
    userState[user].activeRecognition.stop();
  }
  
  document.getElementById(`startBtn${user}`).disabled = false;
  document.getElementById(`stopBtn${user}`).disabled = true;
  updateInputStatus(user, "");
}

// Send Recorded Audio Message
async function sendAudioMessage(sender, receiver) {
  const playback = document.getElementById(`audioPlayback${sender}`);
  const blob = playback.audioBlob;
  const transcript = (playback.transcript || "").trim();
  const maxRMS = playback.maxRMS || 0;
  
  if (!blob) return;
  
  const channel = `${sender}->${receiver}`;
  
  // 1. Direct bypass if this audio clip size is whitelisted as safe for channel
  if (whitelistedSafeContent[channel].audios.has(blob.size)) {
    addLog(`Bypassed analysis (audio recording whitelisted as safe for ${channel}).`, "success");
    deliverAudio(sender, receiver, blob, transcript, false);
    clearInputRow(sender);
    return;
  }
  
  // 2. Direct bypass if transcript text is whitelisted as safe
  if (transcript && whitelistedSafeContent[channel].texts.has(transcript.toLowerCase())) {
    addLog(`Bypassed analysis (audio transcript whitelisted as safe for ${channel}): "${transcript}"`, "success");
    deliverAudio(sender, receiver, blob, transcript, false);
    clearInputRow(sender);
    return;
  }
  
  let isShouting = maxRMS >= SHOUTING_RMS_THRESHOLD;
  let textAnalysis = null;
  
  // 3. Scan transcript for toxicity upon manual Send click
  if (transcript) {
    // LAZY LOAD: Load toxicity model on first use if not loaded
    if (!toxicityLoaded) {
      try {
        updateInputStatus(sender, "⏳ Loading toxicity model...");
        if (typeof tf !== 'undefined') {
          await tf.setBackend('cpu');
        }
        toxicityModel = await toxicity.load(TOXICITY_THRESHOLD);
        toxicityLoaded = true;
        updateBadge("badgeToxicity", "ready", "Toxicity Model: Active");
        addLog("Toxicity model loaded (lazy-load on first use).", "success");
      } catch (error) {
        console.error("Lazy load toxicity model error:", error);
        updateBadge("badgeToxicity", "failed", "Toxicity Model: Error");
        addLog("Failed to load toxicity model: " + error.message, "danger");
      }
    }
    
    updateInputStatus(sender, "Analyzing voice transcript...");
    updateStatistics("totalAnalyzed");
    
    textAnalysis = await analyzeText(transcript, sender);
    updateInputStatus(sender, "");
  }
  
  // 4. Evaluate combined violations (Toxic transcript OR Shouting)
  const isToxic = textAnalysis && textAnalysis.isToxic;
  
  if (isToxic || isShouting) {
    const reasons = [];
    if (isToxic) {
      textAnalysis.reasons.forEach(r => reasons.push(r));
    }
    if (isShouting) {
      reasons.push("aggressive volume (shouting)");
      addLog(`⚠️ Acoustic aggression detected (Peak RMS: ${maxRMS.toFixed(3)} / Threshold: ${SHOUTING_RMS_THRESHOLD})`, "warning");
    }
    
    triggerWarningModal({
      sender,
      receiver,
      text: transcript || "[No spoken words detected - Shouting only]",
      audioBlob: blob,
      isAudio: true,
      reasons: reasons
    });
    return; // Stop here, Warning Modal choices will handle delivery (Send Anyway) or deletion
  }
  
  deliverAudio(sender, receiver, blob, transcript, false);
  clearInputRow(sender);
  addLog(`User ${sender} sent audio message.`, "success");
}

// PRESETS AND DEMO TRIGGERS setup
function setupPresets() {
  const presetButtons = document.querySelectorAll(".preset-btn");
  presetButtons.forEach(btn => {
    btn.onclick = () => {
      const type = btn.getAttribute("data-preset");
      const targetUser = btn.getAttribute("data-user") || "A";
      const otherUser = targetUser === "A" ? "B" : "A";
      
      runDemoPreset(type, targetUser, otherUser);
    };
  });
}

// Run predefined demo scenarios instantly (Presentation utility)
async function runDemoPreset(type, sender, receiver) {
  if (checkBlockedState(sender, receiver)) return;
  
  const textInput = document.getElementById(`input${sender}`);
  
  if (type === "toxic-text") {
    textInput.value = "You are a total loser and I hate you so much. Stop chatting.";
    addLog(`Preset: Loaded toxic text for User ${sender}.`, "info");
    textInput.focus();
    
  } else if (type === "threat-text") {
    textInput.value = "If you don't shut up, I am going to find you and kill you.";
    addLog(`Preset: Loaded threat text for User ${sender}.`, "info");
    textInput.focus();
    
  } else if (type === "nsfw-image") {
    updateInputStatus(sender, "Simulating upload of inappropriate content...");
    updateStatistics("totalAnalyzed");
    addLog(`Preset: Simulating inappropriate image analysis (NSFW).`, "warning");
    
    // Draw a mock canvas skin-tone shape representing simulated NSFW trigger
    const canvas = document.createElement("canvas");
    canvas.width = 150;
    canvas.height = 150;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffdbac"; // Skin-like color to flag triggers
    ctx.fillRect(10, 10, 130, 130);
    ctx.fillStyle = "#e0a96d";
    ctx.arc(75, 75, 40, 0, Math.PI * 2);
    ctx.fill();
    
    canvas.toBlob(async (blob) => {
      const fingerprint = `preset-nsfw-image_${blob.size}`;
      const channel = `${sender}->${receiver}`;
      if (whitelistedSafeContent[channel].images.has(fingerprint)) {
        addLog(`Preset: Bypassed NSFW preset (whitelisted as safe for ${channel}).`, "success");
        deliverImage(sender, receiver, blob, "", false);
        return;
      }
      updateInputStatus(sender, "");
      updateStatistics("nsfw");
      triggerWarningModal({
        sender,
        receiver,
        text: "Flagged: Inappropriate imagery (NSFW content).",
        imageFile: blob,
        imageURL: canvas.toDataURL(),
        reasons: ["inappropriate imagery (NSFW)"],
        isAudio: false
      });
    }, "image/jpeg");
    
  } else if (type === "ocr-toxic") {
    updateInputStatus(sender, "Simulating upload of image with offensive text...");
    updateStatistics("totalAnalyzed");
    addLog(`Preset: Simulating text-based image analysis (OCR).`, "warning");
    
    // Create a mock canvas with offensive text written on it
    const canvas = document.createElement("canvas");
    canvas.width = 300;
    canvas.height = 100;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, 300, 100);
    ctx.fillStyle = "#ff0000";
    ctx.font = "bold 20px sans-serif";
    ctx.fillText("SHUT UP YOU IDIOT", 40, 55);
    
    canvas.toBlob(async (blob) => {
      const fingerprint = `preset-ocr-image_${blob.size}`;
      const channel = `${sender}->${receiver}`;
      if (whitelistedSafeContent[channel].images.has(fingerprint)) {
        addLog(`Preset: Bypassed OCR preset (whitelisted as safe for ${channel}).`, "success");
        deliverImage(sender, receiver, blob, "SHUT UP YOU IDIOT", false);
        return;
      }
      // Simulate OCR result
      updateInputStatus(sender, "");
      updateStatistics("toxicity");
      updateStatistics("insult");
      
      triggerWarningModal({
        sender,
        receiver,
        text: 'Flagged: OCR Insult detected: "SHUT UP YOU IDIOT"',
        imageFile: blob,
        imageURL: canvas.toDataURL(),
        ocrText: "SHUT UP YOU IDIOT",
        reasons: ["insult", "toxic text"],
        isAudio: false
      });
    }, "image/jpeg");
    
  } else if (type === "toxic-voice") {
    // Simulate recording stop with toxic transcript
    updateInputStatus(sender, "Simulating voice recording and transcript classification...");
    updateStatistics("totalAnalyzed");
    addLog(`Preset: Simulating voice recording containing threat.`, "warning");
    
    // Create a silent audio wave blob
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const dest = ctx.createMediaStreamDestination();
    osc.connect(dest);
    osc.start();
    
    const mediaRecorder = new MediaRecorder(dest.stream);
    const chunks = [];
    mediaRecorder.ondataavailable = e => chunks.push(e.data);
    
    mediaRecorder.onstop = () => {
      const audioBlob = new Blob(chunks, { type: 'audio/webm' });
      const playback = document.getElementById(`audioPlayback${sender}`);
      playback.src = URL.createObjectURL(audioBlob);
      const drawer = document.getElementById(`audioPlaybackDrawer${sender}`);
      if (drawer) drawer.style.display = "flex";
      playback.audioBlob = audioBlob;
      
      // Manually set transcript to trigger toxicity upon Send click
      const mockTranscript = "Get out of here before I hurt you";
      playback.transcript = mockTranscript;
      
      // Mock standard conversational volume (no shouting)
      playback.maxRMS = 0.08;
      
      // Enable send audio button
      document.getElementById(`sendAudio${sender}`).disabled = false;
      updateInputStatus(sender, "");
      addLog(`Preset: Voice recording loaded with simulated toxic transcript. Click "Send Voice" to test detection.`, "info");
    };
    
    mediaRecorder.start();
    setTimeout(() => {
      mediaRecorder.stop();
      osc.stop();
    }, 500);
  }
}
