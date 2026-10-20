/*
 * SpendSense AI — application controller.
 *
 * Data lives in localStorage when signed out ("offline mode") and in Cloud Firestore under
 * users/{uid}/... when signed in. Every amount is stored in the currency it was entered in and
 * converted to the workspace base currency for display, totals, budgets and AI context.
 *
 * AI requests go through /.netlify/functions/ai-proxy (Firebase-authenticated, rate-limited).
 * For local development you can call OpenRouter directly by running, in the console:
 *   localStorage.setItem("dev_api_key", "<your OpenRouter key>")
 */
"use strict";

// =============================================================================
// CONFIGURATION
// =============================================================================
const DEV_MODEL_NAME = "google/gemini-3-flash-preview"; // only used for direct local-dev calls
const AI_PROXY_URL = "/.netlify/functions/ai-proxy";

const firebaseConfig = {
  apiKey: "AIzaSyByVjSfugsyO9p9c1k_5rpf_z8Nb6zGX4s",
  authDomain: "my-expense-tracker-50a7a.firebaseapp.com",
  projectId: "my-expense-tracker-50a7a",
  storageBucket: "my-expense-tracker-50a7a.firebasestorage.app",
  messagingSenderId: "934094765182",
  appId: "1:934094765182:web:569093ec8f60beed122c2f",
  measurementId: "G-BYNBF8DQDS",
};

const CURRENCIES = {
  USD: { symbol: "$", name: "US Dollar" },
  EUR: { symbol: "€", name: "Euro" },
  GBP: { symbol: "£", name: "British Pound" },
  INR: { symbol: "₹", name: "Indian Rupee" },
  JPY: { symbol: "¥", name: "Japanese Yen" },
  CAD: { symbol: "CA$", name: "Canadian Dollar" },
  AUD: { symbol: "A$", name: "Australian Dollar" },
  CHF: { symbol: "CHF", name: "Swiss Franc" },
  CNY: { symbol: "CN¥", name: "Chinese Yuan" },
  SGD: { symbol: "S$", name: "Singapore Dollar" },
  NZD: { symbol: "NZ$", name: "New Zealand Dollar" },
  AED: { symbol: "AED", name: "UAE Dirham" },
  SAR: { symbol: "SAR", name: "Saudi Riyal" },
  OMR: { symbol: "OMR", name: "Omani Rial" },
  SEK: { symbol: "kr", name: "Swedish Krona" },
  NOK: { symbol: "kr", name: "Norwegian Krone" },
  DKK: { symbol: "kr", name: "Danish Krone" },
  ZAR: { symbol: "R", name: "South African Rand" },
  RUB: { symbol: "₽", name: "Russian Ruble" },
  PHP: { symbol: "₱", name: "Philippine Peso" },
  BRL: { symbol: "R$", name: "Brazilian Real" },
  THB: { symbol: "฿", name: "Thai Baht" },
  MYR: { symbol: "RM", name: "Malaysian Ringgit" },
};

// Fallback USD rates, refreshed from open.er-api.com (and cached for offline use).
let usdRates = {
  USD: 1.0, EUR: 0.92, GBP: 0.78, INR: 88.5, JPY: 151.0, CAD: 1.38, AUD: 1.53, CHF: 0.8, CNY: 7.12, SGD: 1.3,
  NZD: 1.72, AED: 3.6725, SAR: 3.75, OMR: 0.385, SEK: 9.45, NOK: 10.05, DKK: 6.42, ZAR: 17.4, RUB: 81.0,
  PHP: 58.0, BRL: 5.4, THB: 32.6, MYR: 4.22,
};

const CATEGORIES = [
  { name: "Food & Dining", color: "bg-emerald-500", text: "text-emerald-400", border: "border-emerald-500/20", icon: "🍔", chartColor: "#10b981" },
  { name: "Groceries", color: "bg-lime-500", text: "text-lime-400", border: "border-lime-500/20", icon: "🛒", chartColor: "#84cc16" },
  { name: "Shopping", color: "bg-purple-500", text: "text-purple-400", border: "border-purple-500/20", icon: "🛍️", chartColor: "#a855f7" },
  { name: "Transport", color: "bg-cyan-500", text: "text-cyan-400", border: "border-cyan-500/20", icon: "🚗", chartColor: "#06b6d4" },
  { name: "Utilities", color: "bg-blue-500", text: "text-blue-400", border: "border-blue-500/20", icon: "⚡", chartColor: "#3b82f6" },
  { name: "Rent", color: "bg-orange-500", text: "text-orange-400", border: "border-orange-500/20", icon: "🏠", chartColor: "#f97316" },
  { name: "Entertainment", color: "bg-pink-500", text: "text-pink-400", border: "border-pink-500/20", icon: "🎬", chartColor: "#ec4899" },
  { name: "Subscriptions", color: "bg-indigo-500", text: "text-indigo-400", border: "border-indigo-500/20", icon: "📱", chartColor: "#6366f1" },
  { name: "Health & Fitness", color: "bg-red-500", text: "text-red-400", border: "border-red-500/20", icon: "💪", chartColor: "#ef4444" },
  { name: "Travel", color: "bg-teal-500", text: "text-teal-400", border: "border-teal-500/20", icon: "✈️", chartColor: "#14b8a6" },
  { name: "Education", color: "bg-amber-500", text: "text-amber-400", border: "border-amber-500/20", icon: "📚", chartColor: "#f59e0b" },
  { name: "Salary/Income", color: "bg-green-500", text: "text-green-400", border: "border-green-500/20", icon: "💰", chartColor: "#22c55e" },
  { name: "Miscellaneous", color: "bg-slate-500", text: "text-slate-400", border: "border-slate-500/20", icon: "🏷️", chartColor: "#64748b" },
];
const CATEGORY_NAMES = CATEGORIES.map((c) => c.name);
const INCOME = "Salary/Income";
const MISC_CATEGORY = CATEGORIES.find((c) => c.name === "Miscellaneous");
const categoryInfo = (name) => CATEGORIES.find((c) => c.name === name) || MISC_CATEGORY;
const PAYMENT_METHODS = ["Credit Card", "Debit Card", "UPI", "Cash", "Apple Pay", "Google Pay", "Bank Transfer", "Direct Deposit"];

const DEFAULT_GREETING =
  "Hey! I'm **SpendSense AI**, your personal money copilot. I can see your transactions, budgets and goals, so ask me anything — *“Why did I spend more this month?”*, *“Can I afford a ₹20k phone?”* or *“Plan my week on a budget.”*";

const TAB_META = {
  dashboard: ["Dashboard", "Your month at a glance, with proactive alerts."],
  expenses: ["Expenses Ledger", "Search, filter and edit every transaction."],
  ocr: ["Receipt Scanner", "Snap a receipt and let AI fill in the details."],
  coach: ["AI Money Coach", "Ask anything about your spending, budgets and goals."],
  budgets: ["Budgets & Goals", "Monthly limits and savings milestones."],
  settings: ["Settings", "Currency, income, security, backups and support."],
};

// =============================================================================
// STATE
// =============================================================================
let db = null;
let auth = null;
let userId = null;
let currentUser = null;
const unsub = { expenses: null, budgets: null, goals: null, chat: null, settings: null };

let expenses = [];
let budgets = [];
let goals = [];
let chatMessages = [];
let chatNotices = []; // local-only assistant notices (sign-in prompts, limits); never stored or sent to the AI

let currentGlobalCurrency = "USD";
let monthlyIncome = 0;
let incomeCurrency = null;
let monthlyBudgetLimit = 0;
let budgetCurrency = null;
let weeklyTarget = 0;
let weeklyCurrency = null;
let useWeeklyTargetOverride = false;

let notifications = [];
let activeTab = "dashboard";
let activeFilter = "All";
let ledgerSearch = "";
let ledgerPeriod = "all";
let ledgerSort = "date-desc";
let spendingChartInstance = null;
let activeOcrResult = null;
let lastAddedExpenseId = null;
let importPrompted = false;
let authResolved = false;
let localDataLoaded = false; // true only while the in-memory data is the device's offline data
let justSignedIn = false;
const aiUsage = { remaining: null, limit: 10 };
let chatBusy = false;

// =============================================================================
// SMALL UTILITIES
// =============================================================================
const $ = (id) => document.getElementById(id);

const LS = {
  get(key, fallback = null) {
    try {
      const v = localStorage.getItem(key);
      return v === null ? fallback : v;
    } catch {
      return fallback;
    }
  },
  getJSON(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v ? JSON.parse(v) : fallback;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, typeof value === "string" ? value : JSON.stringify(value));
    } catch (e) {
      console.warn("localStorage write failed", e);
    }
  },
  remove(key) {
    try {
      localStorage.removeItem(key);
    } catch {}
  },
};

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const newLocalId = () =>
  "local-" + (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

const pad2 = (n) => String(n).padStart(2, "0");
const toISODate = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const todayISO = () => toISODate(new Date());
const isValidISODate = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(parseISODate(s).getTime());
function parseISODate(s) {
  const [y, m, d] = String(s).split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}
const monthKeyOf = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
const addDays = (d, n) => {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() + n);
  return x;
};
const daysBetween = (a, b) => Math.round((parseISODate(toISODate(b)) - parseISODate(toISODate(a))) / 86_400_000);
function formatDisplayDate(iso) {
  if (!isValidISODate(iso)) return iso || "";
  const d = parseISODate(iso);
  const diff = daysBetween(d, new Date());
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: d.getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
}

const sum = (arr, fn) => arr.reduce((s, x) => s + (fn ? fn(x) : x), 0);
const debounce = (fn, ms) => {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
};
const refreshIcons = () => {
  if (window.lucide) lucide.createIcons();
};

// =============================================================================
// MONEY
// =============================================================================
function convert(amount, from, to = currentGlobalCurrency) {
  const value = Number(amount) || 0;
  if (!from || from === to) return value;
  const rFrom = usdRates[from];
  const rTo = usdRates[to];
  if (!rFrom || !rTo) return value;
  return (value / rFrom) * rTo;
}
const toBase = (amount, currency) => convert(amount, currency || currentGlobalCurrency, currentGlobalCurrency);

const moneyFormatters = {};
function formatMoney(value, code = currentGlobalCurrency, opts = {}) {
  const key = `${code}|${opts.compact ? 1 : 0}|${opts.whole ? 1 : 0}`;
  if (!moneyFormatters[key]) {
    const locale = code === "INR" ? "en-IN" : navigator.language || "en-US";
    try {
      moneyFormatters[key] = new Intl.NumberFormat(locale, {
        style: "currency",
        currency: code,
        currencyDisplay: "symbol",
        ...(opts.whole ? { minimumFractionDigits: 0, maximumFractionDigits: 0 } : {}),
        ...(opts.compact ? { notation: "compact", maximumFractionDigits: 1 } : {}),
      });
    } catch {
      moneyFormatters[key] = { format: (v) => `${(CURRENCIES[code] || {}).symbol || code} ${Number(v).toFixed(2)}` };
    }
  }
  return moneyFormatters[key].format(Number(value) || 0);
}
// Formats an amount that is already in the base currency.
const formatCurrency = (amount) => formatMoney(amount, currentGlobalCurrency);

// Detect a sensible default currency from the device's time zone / locale.
function detectDefaultCurrency() {
  const TZ = {
    "Asia/Kolkata": "INR", "Asia/Calcutta": "INR", "Asia/Dubai": "AED", "Asia/Riyadh": "SAR", "Asia/Muscat": "OMR",
    "Europe/London": "GBP", "Asia/Tokyo": "JPY", "Asia/Shanghai": "CNY", "Asia/Singapore": "SGD",
    "Pacific/Auckland": "NZD", "Europe/Zurich": "CHF", "Europe/Stockholm": "SEK", "Europe/Oslo": "NOK",
    "Europe/Copenhagen": "DKK", "Africa/Johannesburg": "ZAR", "Europe/Moscow": "RUB", "Asia/Manila": "PHP",
    "America/Sao_Paulo": "BRL", "Asia/Bangkok": "THB", "Asia/Kuala_Lumpur": "MYR",
  };
  const REGION = {
    US: "USD", IN: "INR", GB: "GBP", JP: "JPY", CA: "CAD", AU: "AUD", CH: "CHF", CN: "CNY", SG: "SGD", NZ: "NZD",
    AE: "AED", SA: "SAR", OM: "OMR", SE: "SEK", NO: "NOK", DK: "DKK", ZA: "ZAR", RU: "RUB", PH: "PHP", BR: "BRL",
    TH: "THB", MY: "MYR", DE: "EUR", FR: "EUR", ES: "EUR", IT: "EUR", NL: "EUR", BE: "EUR", AT: "EUR", IE: "EUR",
    PT: "EUR", FI: "EUR", GR: "EUR", LU: "EUR", SK: "EUR", SI: "EUR", EE: "EUR", LV: "EUR", LT: "EUR", HR: "EUR",
  };
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
    if (TZ[tz]) return TZ[tz];
    if (tz.startsWith("Australia/")) return "AUD";
    if (/^Europe\/(Berlin|Paris|Madrid|Rome|Amsterdam|Brussels|Vienna|Dublin|Lisbon|Helsinki|Athens)/.test(tz)) return "EUR";
    if (/^America\/(Toronto|Vancouver|Edmonton|Winnipeg|Halifax)/.test(tz)) return "CAD";
    for (const lang of navigator.languages || [navigator.language]) {
      const region = new Intl.Locale(lang).maximize().region;
      if (REGION[region]) return REGION[region];
    }
  } catch {}
  return "USD";
}

// =============================================================================
// DATA NORMALISATION & LOCAL STORAGE
// =============================================================================
function normalizeExpense(raw) {
  const ex = { ...raw };
  ex.amount = Math.abs(Number(ex.amount)) || 0;
  ex.currency = CURRENCIES[ex.currency] ? ex.currency : currentGlobalCurrency;
  ex.category = CATEGORY_NAMES.includes(ex.category) ? ex.category : "Miscellaneous";
  ex.date = isValidISODate(ex.date) ? ex.date : todayISO();
  ex.merchant = String(ex.merchant || "").trim() || "Untitled expense";
  ex.note = ex.note ? String(ex.note) : "";
  ex.paymentMethod = ex.paymentMethod || "";
  ex.isSubscription = Boolean(ex.isSubscription);
  ex.createdAt = Number(ex.createdAt) || 0;
  return ex;
}
const normalizeBudget = (raw) => ({
  ...raw,
  limit: Number(raw.limit ?? raw.limitAmount) || 0,
  currency: CURRENCIES[raw.currency] ? raw.currency : currentGlobalCurrency,
});
const normalizeGoal = (raw) => ({
  ...raw,
  name: String(raw.name || "Savings goal"),
  targetAmount: Number(raw.targetAmount) || 0,
  currentAmount: Number(raw.currentAmount) || 0,
  currency: CURRENCIES[raw.currency] ? raw.currency : currentGlobalCurrency,
  deadline: isValidISODate(raw.deadline) ? raw.deadline : "",
});
const sortExpenses = (list) =>
  list.sort((a, b) => (a.date === b.date ? (b.createdAt || 0) - (a.createdAt || 0) : a.date < b.date ? 1 : -1));

// Older versions cached cloud documents (20-char Firestore ids) in the offline storage keys.
// Those records already live in the cloud, so they must not be treated as offline data.
const looksLikeCloudId = (id) => typeof id === "string" && /^[A-Za-z0-9]{20}$/.test(id);

function readLocalOfflineData() {
  const strip = (list) => (Array.isArray(list) ? list.filter((x) => x && !looksLikeCloudId(x.id)) : []);
  return {
    expenses: strip(LS.getJSON("spendsense_expenses", [])),
    budgets: strip(LS.getJSON("spendsense_budgets", [])),
    goals: strip(LS.getJSON("spendsense_goals", [])),
    chat: (LS.getJSON("spendsense_chat", []) || []).filter((m) => m && m.text && m.role && !m.id),
  };
}

function loadLocalSession() {
  const local = readLocalOfflineData();
  expenses = sortExpenses(local.expenses.map(normalizeExpense));
  budgets = local.budgets.map(normalizeBudget);
  goals = local.goals.map(normalizeGoal);
  chatMessages = local.chat;

  monthlyIncome = parseFloat(LS.get("spendsense_monthly_income", "0")) || 0;
  incomeCurrency = LS.get("spendsense_income_currency");
  monthlyBudgetLimit = parseFloat(LS.get("spendsense_monthly_budget", "0")) || 0;
  budgetCurrency = LS.get("spendsense_budget_currency");
  weeklyTarget = parseFloat(LS.get("spendsense_weekly_target", "0")) || 0;
  weeklyCurrency = LS.get("spendsense_weekly_currency");
  useWeeklyTargetOverride = LS.get("spendsense_use_weekly_override") === "true";
  localDataLoaded = true;
  syncSettingsInputs();
}

// Only offline-mode data is written to localStorage. Signed-in data stays in Firestore, so signing out
// on a shared device does not leave a copy of the account's ledger behind.
// Nothing is written until the local data has been loaded, so an early render can't overwrite it.
function saveLocalSession() {
  if (currentUser || !localDataLoaded) return;
  LS.set("spendsense_expenses", expenses);
  LS.set("spendsense_budgets", budgets);
  LS.set("spendsense_goals", goals);
  LS.set("spendsense_chat", chatMessages.slice(-100));
  LS.set("spendsense_weekly_target", String(weeklyTarget));
  LS.set("spendsense_monthly_budget", String(monthlyBudgetLimit));
  LS.set("spendsense_monthly_income", String(monthlyIncome));
  LS.set("spendsense_use_weekly_override", String(useWeeklyTargetOverride));
  if (incomeCurrency) LS.set("spendsense_income_currency", incomeCurrency);
  if (budgetCurrency) LS.set("spendsense_budget_currency", budgetCurrency);
  if (weeklyCurrency) LS.set("spendsense_weekly_currency", weeklyCurrency);
}

function clearLocalOfflineData() {
  [
    "spendsense_expenses", "spendsense_budgets", "spendsense_goals", "spendsense_chat", "spendsense_weekly_target",
    "spendsense_monthly_budget", "spendsense_monthly_income", "spendsense_use_weekly_override",
    "spendsense_income_currency", "spendsense_budget_currency", "spendsense_weekly_currency",
  ].forEach((k) => LS.remove(k));
}

// Settings expressed in the base currency
const getMonthlyIncome = () => convert(monthlyIncome, incomeCurrency || currentGlobalCurrency);
const getMonthlyBudget = () => convert(monthlyBudgetLimit, budgetCurrency || currentGlobalCurrency);
const getWeeklyTargetSetting = () => convert(weeklyTarget, weeklyCurrency || currentGlobalCurrency);
const budgetLimitBase = (b) => convert(b.limit, b.currency);
const goalTargetBase = (g) => convert(g.targetAmount, g.currency);
const goalCurrentBase = (g) => convert(g.currentAmount, g.currency);
const round2 = (v) => Math.round(v * 100) / 100;

function syncSettingsInputs() {
  const setVal = (id, v) => {
    const el = $(id);
    if (el) el.value = v > 0 ? round2(v) : "";
  };
  setVal("setting-monthly-income", getMonthlyIncome());
  setVal("quick-monthly-budget-input", getMonthlyBudget());
  setVal("setting-weekly-target", getWeeklyTargetSetting());
  const cb = $("setting-use-weekly-override");
  if (cb) cb.checked = useWeeklyTargetOverride;
  const dd = $("setting-global-currency-dropdown");
  if (dd) dd.value = currentGlobalCurrency;
}

// Learn categories from the user's own ledger so repeat merchants are categorised the way they prefer.
function buildMerchantMemory() {
  const memory = {};
  const N = window.SSNLU;
  if (!N) return memory;
  for (const ex of [...expenses].reverse()) memory[N.merchantKey(ex.merchant)] = ex.category;
  return memory;
}

// =============================================================================
// ANALYTICS
// =============================================================================
const isIncome = (ex) => ex.category === INCOME;
const amountBase = (ex) => toBase(ex.amount, ex.currency);
const inRange = (ex, start, end) => ex.date >= start && ex.date <= end;

function getStats(now = new Date()) {
  const mk = monthKeyOf(now);
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevKey = monthKeyOf(prev);
  const dayOfMonth = now.getDate();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const thisMonth = expenses.filter((e) => e.date.startsWith(mk));
  const lastMonth = expenses.filter((e) => e.date.startsWith(prevKey));
  const spend = (list) => sum(list.filter((e) => !isIncome(e)), amountBase);

  const spentThisMonth = spend(thisMonth);
  const incomeThisMonth = sum(thisMonth.filter(isIncome), amountBase);
  const lastMonthTotal = spend(lastMonth);
  const lastMonthSamePoint = spend(lastMonth.filter((e) => parseInt(e.date.slice(8), 10) <= dayOfMonth));

  const byCategory = {};
  for (const e of thisMonth) if (!isIncome(e)) byCategory[e.category] = (byCategory[e.category] || 0) + amountBase(e);
  const lastByCategory = {};
  for (const e of lastMonth) if (!isIncome(e)) lastByCategory[e.category] = (lastByCategory[e.category] || 0) + amountBase(e);

  const weekStart = toISODate(addDays(now, -6));
  const today = toISODate(now);
  const spentLast7 = spend(expenses.filter((e) => inRange(e, weekStart, today)));
  const spentToday = spend(expenses.filter((e) => e.date === today));

  const projected = dayOfMonth > 0 ? (spentThisMonth / dayOfMonth) * daysInMonth : spentThisMonth;
  const income = getMonthlyIncome() > 0 ? getMonthlyIncome() : incomeThisMonth;
  const monthlyBudget = getMonthlyBudget();

  return {
    monthKey: mk, dayOfMonth, daysInMonth, daysLeft: daysInMonth - dayOfMonth + 1,
    thisMonth, spentThisMonth, incomeThisMonth, lastMonthTotal, lastMonthSamePoint,
    byCategory, lastByCategory, spentLast7, spentToday, projected, income, monthlyBudget,
    savings: income - spentThisMonth,
    savingsRate: income > 0 ? ((income - spentThisMonth) / income) * 100 : null,
  };
}

function effectiveWeeklyTarget() {
  if (useWeeklyTargetOverride && getWeeklyTargetSetting() > 0) return getWeeklyTargetSetting();
  if (getMonthlyBudget() > 0) return (getMonthlyBudget() * 12) / 52;
  return getWeeklyTargetSetting();
}

// Recurring payments: explicitly flagged ones plus merchants charged a similar amount in 2+ different months.
function detectRecurring() {
  const N = window.SSNLU;
  const key = (m) => (N ? N.merchantKey(m) : String(m).toLowerCase());
  const cutoff = toISODate(addDays(new Date(), -125));
  const groups = {};
  for (const e of expenses) {
    if (isIncome(e)) continue;
    const k = key(e.merchant);
    (groups[k] = groups[k] || []).push(e);
  }
  const result = [];
  for (const list of Object.values(groups)) {
    const latest = list[0];
    const flagged = list.some((e) => e.isSubscription);
    const recent = list.filter((e) => e.date >= cutoff);
    const months = new Set(recent.map((e) => e.date.slice(0, 7)));
    let similar = false;
    if (months.size >= 2) {
      const amounts = recent.map(amountBase);
      const avg = sum(amounts) / amounts.length;
      similar = avg > 0 && amounts.every((a) => Math.abs(a - avg) / avg <= 0.15);
    }
    if (flagged || similar) {
      result.push({ merchant: latest.merchant, amount: amountBase(latest), lastDate: latest.date, flagged, category: latest.category, id: latest.id });
    }
  }
  return result.sort((a, b) => b.amount - a.amount);
}

// Outliers: a purchase far above the typical (median) spend in its category over the last 90 days.
function detectAnomalies() {
  const since90 = toISODate(addDays(new Date(), -90));
  const since30 = toISODate(addDays(new Date(), -30));
  const byCat = {};
  for (const e of expenses) {
    if (isIncome(e) || e.date < since90) continue;
    (byCat[e.category] = byCat[e.category] || []).push(e);
  }
  const minGap = convert(10, "USD");
  const out = [];
  for (const list of Object.values(byCat)) {
    if (list.length < 4) continue;
    const values = list.map(amountBase).sort((a, b) => a - b);
    const mid = Math.floor(values.length / 2);
    const median = values.length % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
    for (const e of list) {
      const v = amountBase(e);
      if (e.date >= since30 && median > 0 && v >= median * 2.5 && v - median >= minGap) {
        out.push({ id: e.id, merchant: e.merchant, amount: v, median, multiplier: v / median, category: e.category, date: e.date });
      }
    }
  }
  return out.sort((a, b) => b.multiplier - a.multiplier).slice(0, 3);
}

// =============================================================================
// FIREBASE: INIT, AUTH STATE & SYNC
// =============================================================================
const userDoc = () => db.collection("users").doc(userId);
const isCloud = () => Boolean(db && userId);

function cloudWrite(promise, what) {
  return Promise.resolve(promise).catch((err) => {
    console.error(`Sync error (${what}):`, err);
    showToast(err && err.code === "permission-denied" ? `Permission denied while saving ${what}.` : `Couldn't save ${what}. Please try again.`, "error");
    throw err;
  });
}

function unsubscribeAll() {
  Object.keys(unsub).forEach((k) => {
    if (unsub[k]) {
      unsub[k]();
      unsub[k] = null;
    }
  });
}

function initializeFirebaseApp() {
  if (typeof firebase === "undefined") {
    console.warn("Firebase SDK not loaded. Operating in offline mode.");
    handleSignedOut();
    return;
  }
  try {
    firebase.initializeApp(firebaseConfig);
    auth = firebase.auth();
    db = firebase.firestore();
    auth.getRedirectResult().catch((error) => {
      if (error && error.code && error.code !== "auth/popup-closed-by-user") console.error("Redirect sign-in error:", error);
    });
    auth.onAuthStateChanged((user) => (user ? handleSignedIn(user) : handleSignedOut()));
  } catch (err) {
    console.error("Firebase initialization error:", err);
    showToast("Cloud sync is unavailable. Running offline.", "error");
    handleSignedOut();
  }
}

function handleSignedIn(user) {
  authResolved = true;
  localDataLoaded = false;
  userId = user.uid;
  currentUser = user;
  importPrompted = false;
  expenses = [];
  budgets = [];
  goals = [];
  chatMessages = [];
  chatNotices = [];
  hideAuthModal();
  updateAuthUI();
  subscribeToCloud();
  refreshAIUsage();
  if (justSignedIn) {
    showToast(`Welcome${user.displayName ? `, ${user.displayName.split(" ")[0]}` : ""}! Your data is syncing.`, "success");
    justSignedIn = false;
  }
}

function handleSignedOut() {
  const wasSignedIn = Boolean(currentUser);
  authResolved = true;
  unsubscribeAll();
  userId = null;
  currentUser = null;
  chatNotices = [];
  aiUsage.remaining = null;
  loadLocalSession();
  updateAuthUI();
  renderAIUsage();
  setupAppInterface();
  renderChatMessages();
  if (wasSignedIn) showToast("Signed out. Showing data stored on this device.", "info");
}

function subscribeToCloud() {
  unsubscribeAll();
  const ref = userDoc();
  const loaded = { expenses: false, budgets: false, goals: false };
  const onLoaded = (k) => {
    loaded[k] = true;
    if (loaded.expenses && loaded.budgets && loaded.goals) maybeOfferLocalImport();
  };
  const onError = (what) => (err) => {
    console.warn(`${what} sync error:`, err);
    if (err.code === "permission-denied") showToast(`Cloud access to ${what} was denied.`, "error");
  };

  unsub.expenses = ref.collection("expenses").onSnapshot((snap) => {
    expenses = sortExpenses(snap.docs.map((d) => normalizeExpense({ ...d.data(), id: d.id })));
    scheduleRender();
    onLoaded("expenses");
  }, onError("expenses"));

  unsub.budgets = ref.collection("budgets").onSnapshot((snap) => {
    budgets = snap.docs.map((d) => normalizeBudget({ ...d.data(), id: d.id }));
    scheduleRender();
    onLoaded("budgets");
  }, onError("budgets"));

  unsub.goals = ref.collection("goals").onSnapshot((snap) => {
    goals = snap.docs.map((d) => normalizeGoal({ ...d.data(), id: d.id }));
    scheduleRender();
    onLoaded("goals");
  }, onError("goals"));

  unsub.chat = ref.collection("chatMessages").orderBy("timestamp", "asc").limitToLast(80).onSnapshot((snap) => {
    chatMessages = snap.docs.map((d) => ({ ...d.data(), id: d.id }));
    renderChatMessages();
  }, onError("chat"));

  unsub.settings = ref.onSnapshot((doc) => {
    const data = doc.exists ? doc.data() : {};
    monthlyIncome = Number(data.monthlyIncome) || 0;
    incomeCurrency = data.incomeCurrency || data.globalCurrency || null;
    monthlyBudgetLimit = Number(data.monthlyBudgetLimit) || 0;
    budgetCurrency = data.budgetCurrency || data.globalCurrency || null;
    weeklyTarget = Number(data.weeklyTarget) || 0;
    weeklyCurrency = data.weeklyCurrency || data.globalCurrency || null;
    useWeeklyTargetOverride = Boolean(data.useWeeklyTargetOverride);
    if (data.globalCurrency && CURRENCIES[data.globalCurrency] && data.globalCurrency !== currentGlobalCurrency) {
      currentGlobalCurrency = data.globalCurrency;
      LS.set("spendsense_global_currency", currentGlobalCurrency);
    }
    syncSettingsInputs();
    scheduleRender();
  }, onError("settings"));
}

// Offer to move data that was created offline on this device into the signed-in account.
async function maybeOfferLocalImport() {
  if (!currentUser || importPrompted) return;
  importPrompted = true;
  const local = readLocalOfflineData();
  const counts = [
    local.expenses.length && `${local.expenses.length} transaction${local.expenses.length > 1 ? "s" : ""}`,
    local.budgets.length && `${local.budgets.length} budget${local.budgets.length > 1 ? "s" : ""}`,
    local.goals.length && `${local.goals.length} goal${local.goals.length > 1 ? "s" : ""}`,
  ].filter(Boolean);
  if (!counts.length || LS.get(`spendsense_import_declined_${userId}`) === "true") return;

  const ok = await showConfirmationModal(
    "Import data from this device?",
    `You have ${counts.join(", ")} saved on this device from offline mode. Add them to your account so they sync everywhere?`,
    { icon: "upload", color: "violet", confirmText: "Import", cancelText: "Not now", danger: false }
  );
  if (!ok) {
    LS.set(`spendsense_import_declined_${userId}`, "true");
    return;
  }
  try {
    const ref = userDoc();
    const writes = [];
    local.expenses.forEach((e) => {
      const { id, ...data } = normalizeExpense(e);
      writes.push([ref.collection("expenses").doc(), { ...data, createdAt: data.createdAt || Date.now() }]);
    });
    local.budgets.forEach((b) => {
      const { id, ...data } = normalizeBudget(b);
      const existing = budgets.find((x) => x.category === data.category);
      writes.push([existing ? ref.collection("budgets").doc(existing.id) : ref.collection("budgets").doc(), data]);
    });
    local.goals.forEach((g) => {
      const { id, ...data } = normalizeGoal(g);
      writes.push([ref.collection("goals").doc(), data]);
    });
    for (let i = 0; i < writes.length; i += 400) {
      const batch = db.batch();
      writes.slice(i, i + 400).forEach(([docRef, data]) => batch.set(docRef, data));
      await batch.commit();
    }
    // Carry over offline settings the account doesn't have yet
    const patch = {};
    const localNum = (k) => parseFloat(LS.get(k, "0")) || 0;
    if (!(monthlyIncome > 0) && localNum("spendsense_monthly_income") > 0) {
      patch.monthlyIncome = localNum("spendsense_monthly_income");
      patch.incomeCurrency = LS.get("spendsense_income_currency") || currentGlobalCurrency;
    }
    if (!(monthlyBudgetLimit > 0) && localNum("spendsense_monthly_budget") > 0) {
      patch.monthlyBudgetLimit = localNum("spendsense_monthly_budget");
      patch.budgetCurrency = LS.get("spendsense_budget_currency") || currentGlobalCurrency;
    }
    if (!(weeklyTarget > 0) && localNum("spendsense_weekly_target") > 0) {
      patch.weeklyTarget = localNum("spendsense_weekly_target");
      patch.weeklyCurrency = LS.get("spendsense_weekly_currency") || currentGlobalCurrency;
      patch.useWeeklyTargetOverride = LS.get("spendsense_use_weekly_override") === "true";
    }
    if (Object.keys(patch).length) await ref.set(patch, { merge: true });
    clearLocalOfflineData();
    showToast(`Imported ${counts.join(", ")} into your account.`, "success");
  } catch (err) {
    console.error("Import failed:", err);
    showToast("Import failed. Your offline data is still on this device.", "error");
  }
}

// =============================================================================
// BOOTSTRAP
// =============================================================================
window.addEventListener("DOMContentLoaded", () => {
  currentGlobalCurrency = LS.get("spendsense_global_currency") || detectDefaultCurrency();
  if (!CURRENCIES[currentGlobalCurrency]) currentGlobalCurrency = "USD";

  const cachedRates = LS.getJSON("spendsense_rates", null);
  if (cachedRates && cachedRates.rates) usdRates = { ...usdRates, ...cachedRates.rates };

  setupGlobalListeners();
  setupExpenseFormHelpers();

  // Password reset links (?mode=resetPassword&oobCode=...)
  const params = new URLSearchParams(window.location.search);
  if (params.get("mode") === "resetPassword" && params.get("oobCode")) {
    $("reset-oob-code").value = params.get("oobCode");
    openModal("modal-reset-password");
  }

  if (!LS.get("spendsense_onboarded")) {
    const sel = $("onboarding-currency");
    if (sel) sel.value = currentGlobalCurrency;
    openModal("onboarding-modal");
  }

  initBiometricLock();
  syncSettingsInputs();
  const initialTab = (location.hash || "").replace("#", "");
  switchTab(TAB_META[initialTab] ? initialTab : "dashboard", { replace: true });

  initializeFirebaseApp();
  initializeExchangeRates();
  renderAIUsage();
  refreshIcons();

  // If auth takes unusually long (e.g. Firebase blocked), show local data instead of an empty screen.
  setTimeout(() => {
    if (!authResolved) {
      loadLocalSession();
      setupAppInterface();
      renderChatMessages();
    }
  }, 2500);
});

function setupGlobalListeners() {
  // Delegated handler for buttons rendered from data (no inline JS built from user content).
  document.addEventListener("click", (e) => {
    const el = e.target.closest("[data-action]");
    if (!el) return;
    const { action } = el.dataset;
    const handler = ACTIONS[action];
    if (handler) {
      e.preventDefault();
      handler(el.dataset, el);
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeTopModal();
  });

  // Click on a modal's dimmed backdrop closes it
  CLOSABLE_MODALS.forEach((id) => {
    const el = $(id);
    if (el) el.addEventListener("mousedown", (e) => {
      if (e.target === el) closeModalById(id);
    });
  });

  window.addEventListener("popstate", () => {
    const tab = (location.hash || "").replace("#", "");
    if (TAB_META[tab] && tab !== activeTab) switchTab(tab, { fromHistory: true });
  });

  window.addEventListener("offline", () => showToast("You're offline. Changes will sync when you reconnect.", "info"));
  window.addEventListener("online", () => showToast("Back online.", "success"));

  const search = $("ledger-search");
  if (search) search.addEventListener("input", debounce((e) => {
    ledgerSearch = e.target.value.trim().toLowerCase();
    renderLedgerTable();
  }, 150));
}

// Actions triggered by data-action attributes
const ACTIONS = {
  chat: (d) => triggerAIChatMessage(d.prompt || ""),
  tab: (d) => switchTab(d.tab),
  "edit-expense": (d) => editExpenseRecord(d.id),
  "delete-expense": (d) => deleteExpenseRecord(d.id),
  deposit: (d) => openDepositModal(d.id),
  "goal-plan": (d) => triggerAISavingsGoalStrategy(d.id),
  "delete-goal": (d) => deleteGoalRecord(d.id),
  "delete-budget": (d) => deleteBudgetRecord(d.id),
  "edit-budget": (d) => openBudgetModal(d.category),
  "dismiss-notif": (d) => dismissNotification(d.id),
  "notif-action": (d) => runNotificationAction(d.id),
  filter: (d) => {
    activeFilter = d.category;
    renderFilterButtons();
    renderLedgerTable();
  },
  "show-auth": () => showAuthModal(),
  "voice-example": (d) => handleVoiceText(d.text),
  "voice-save": () => confirmVoiceIntent(),
  "voice-edit": () => editVoiceIntentInForm(),
  "voice-pick-goal": (d) => {
    if (voiceState.intent) {
      voiceState.intent.goalId = d.id;
      voiceState.intent.goalName = (goals.find((g) => g.id === d.id) || {}).name;
      confirmVoiceIntent();
    }
  },
  "voice-undo": () => undoLastExpense(),
  "voice-close": () => closeVoiceAssist(),
  "copy-text": (d, el) => {
    const target = el.closest(".chat-bubble");
    const text = target ? target.innerText.replace(/\s*Copy\s*$/, "") : "";
    navigator.clipboard?.writeText(text).then(() => showToast("Copied to clipboard", "success"));
  },
};

// =============================================================================
// MODALS
// =============================================================================
const CLOSABLE_MODALS = [
  "modal-expense", "modal-budget", "modal-goal", "modal-deposit", "modal-goal-strategy", "modal-notification-center",
  "modal-forgot-password", "modal-voice-assist", "privacy-modal", "auth-modal", "modal-reset-password",
];
const modalStack = [];

function openModal(id) {
  const el = $(id);
  if (!el) return;
  el.classList.remove("hidden");
  el.classList.add("flex");
  const idx = modalStack.indexOf(id);
  if (idx !== -1) modalStack.splice(idx, 1);
  modalStack.push(id);
  document.body.classList.add("overflow-hidden");
  refreshIcons();
}

function closeModalById(id) {
  const handlers = {
    "modal-voice-assist": closeVoiceAssist,
    "confirmation-modal": closeConfirmationModal,
    "auth-modal": hideAuthModal,
    "modal-reset-password": closeResetPasswordModal,
  };
  if (handlers[id]) handlers[id]();
  else closeModal(id);
}

function closeModal(id) {
  const el = $(id);
  if (!el) return;
  el.classList.add("hidden");
  el.classList.remove("flex");
  const idx = modalStack.indexOf(id);
  if (idx !== -1) modalStack.splice(idx, 1);
  if (!modalStack.some((m) => $(m) && !$(m).classList.contains("hidden"))) document.body.classList.remove("overflow-hidden");
}

function closeTopModal() {
  const mobileMenu = $("mobile-profile-menu");
  if (mobileMenu && !mobileMenu.classList.contains("hidden")) return toggleMobileProfileMenu();
  for (let i = modalStack.length - 1; i >= 0; i--) {
    const id = modalStack[i];
    const el = $(id);
    if (!el || el.classList.contains("hidden")) continue;
    if (id === "confirmation-modal" || CLOSABLE_MODALS.includes(id)) closeModalById(id);
    return;
  }
}

// --- Confirmation dialog (promise based, optional text/password input) ---
let confirmationCallback = null;
let confirmationRequiredText = null;

function showConfirmationModal(title, message, opts = {}) {
  if (typeof opts === "string") opts = { icon: opts, color: arguments[3] }; // legacy signature
  const { icon = "alert-triangle", color = "amber", confirmText = "Confirm", cancelText = "Cancel", danger = true, input = null } = opts;
  return new Promise((resolve) => {
    if (confirmationCallback) confirmationCallback(false);
    confirmationCallback = resolve;
    confirmationRequiredText = input && input.mustEqual ? input.mustEqual : null;

    $("confirmation-title").textContent = title;
    $("confirmation-message").textContent = message;
    const colors = { amber: "text-amber-400", red: "text-red-400", violet: "text-violet-400", blue: "text-blue-400", emerald: "text-emerald-400" };
    const iconWrap = $("confirmation-icon-wrap");
    iconWrap.innerHTML = `<i data-lucide="${esc(icon)}" class="w-8 h-8 ${colors[color] || colors.amber}"></i>`;

    const btn = $("confirmation-confirm-btn");
    btn.textContent = confirmText;
    btn.className = danger
      ? "flex-1 py-3 px-4 rounded-xl bg-gradient-to-r from-red-600 to-red-500 hover:from-red-500 hover:to-red-400 text-white font-bold transition-all shadow-lg text-sm disabled:opacity-40 disabled:cursor-not-allowed"
      : "flex-1 py-3 px-4 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white font-bold transition-all shadow-lg text-sm disabled:opacity-40 disabled:cursor-not-allowed";
    $("confirmation-cancel-btn").textContent = cancelText;

    const wrap = $("confirmation-input-wrap");
    const field = $("confirmation-input");
    if (input) {
      wrap.classList.remove("hidden");
      $("confirmation-input-label").textContent = input.label || "";
      field.type = input.type || "text";
      field.value = "";
      field.placeholder = input.placeholder || "";
      btn.disabled = Boolean(confirmationRequiredText);
      setTimeout(() => field.focus(), 50);
    } else {
      wrap.classList.add("hidden");
      btn.disabled = false;
    }
    openModal("confirmation-modal");
    if (!input) setTimeout(() => btn.focus(), 50);
  });
}

function onConfirmationInput() {
  if (confirmationRequiredText) {
    $("confirmation-confirm-btn").disabled = $("confirmation-input").value.trim() !== confirmationRequiredText;
  }
}

function closeConfirmationModal() {
  closeModal("confirmation-modal");
  if (confirmationCallback) {
    const cb = confirmationCallback;
    confirmationCallback = null;
    cb(false);
  }
}

function confirmAction() {
  const field = $("confirmation-input");
  const needsInput = !$("confirmation-input-wrap").classList.contains("hidden");
  if (confirmationRequiredText && field.value.trim() !== confirmationRequiredText) return;
  closeModal("confirmation-modal");
  if (confirmationCallback) {
    const cb = confirmationCallback;
    confirmationCallback = null;
    cb(needsInput ? field.value : true);
  }
}

function openPrivacyModal() {
  openModal("privacy-modal");
}
function closePrivacyModal() {
  closeModal("privacy-modal");
}

// =============================================================================
// ONBOARDING & RESET
// =============================================================================
function completeOnboarding() {
  LS.set("spendsense_onboarded", "true");
  const sel = $("onboarding-currency");
  if (sel && CURRENCIES[sel.value] && sel.value !== currentGlobalCurrency) setGlobalCurrency(sel.value, { silent: true });
  else LS.set("spendsense_global_currency", currentGlobalCurrency);
  closeModal("onboarding-modal");
  showToast("You're all set! Add your first expense or try Voice.", "success");
}

async function resetAppToOnboarding() {
  const signedIn = Boolean(auth && currentUser);
  const ok = await showConfirmationModal(
    signedIn ? "Sign out and reset this device?" : "Reset the app?",
    signedIn
      ? "You'll be signed out and everything stored on this device (including offline-mode data) will be removed. Your cloud data stays safe in your account."
      : "This permanently erases all transactions, budgets, goals and settings stored on this device.",
    { icon: "refresh-cw", color: "red", confirmText: signedIn ? "Sign out & reset" : "Erase & reset" }
  );
  if (!ok) return;
  if (signedIn) await auth.signOut().catch(() => {});
  try {
    localStorage.clear();
  } catch {}
  window.location.replace(window.location.pathname);
}

// =============================================================================
// AUTHENTICATION UI
// =============================================================================
async function handleAuthAction() {
  if (currentUser) {
    const ok = await showConfirmationModal("Sign out?", "Your data stays synced in the cloud and will be here when you sign back in.", {
      icon: "log-out", color: "violet", confirmText: "Sign out", danger: false,
    });
    if (ok) auth.signOut();
  } else {
    showAuthModal();
  }
}

function updateAuthUI() {
  const signedIn = Boolean(currentUser);
  const displayName = signedIn ? currentUser.displayName || currentUser.email || "User" : "";

  const setBtn = (btnId, textId, signedInClass, signedOutClass, signedInText, signedOutText) => {
    const btn = $(btnId);
    if (!btn) return;
    btn.className = signedIn ? signedInClass : signedOutClass;
    $(textId).textContent = signedIn ? signedInText : signedOutText;
    const icon = btn.querySelector("i,svg");
    if (icon) icon.outerHTML = `<i data-lucide="${signedIn ? "log-out" : "log-in"}" class="${btnId === "mobile-auth-action-btn" ? "w-5 h-5" : "w-3.5 h-3.5"}"></i>`;
  };
  setBtn(
    "auth-action-btn", "auth-action-text",
    "w-full flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl bg-violet-500/10 border border-violet-500/30 text-violet-200 hover:bg-violet-500/20 transition-all text-xs font-semibold",
    "w-full flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl bg-violet-600 hover:bg-violet-500 text-white transition-all border border-violet-500 text-xs font-semibold",
    "Sign Out", "Sign In"
  );
  setBtn(
    "mobile-auth-action-btn", "mobile-auth-action-text",
    "w-full py-4 px-6 rounded-xl bg-violet-900/30 border border-violet-500/50 text-violet-100 font-bold hover:bg-violet-800/40 transition-all text-sm flex items-center justify-center gap-2",
    "w-full py-4 px-6 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white font-bold transition-all shadow-lg text-sm flex items-center justify-center gap-2",
    "Sign Out", "Sign In to Sync Data"
  );

  $("user-id-display").textContent = signedIn ? displayName : "Offline mode";
  const mobileUserDisplay = $("mobile-user-display");
  if (mobileUserDisplay) mobileUserDisplay.textContent = signedIn ? displayName : "Offline mode";
  const sync = $("sync-status-indicator");
  if (sync) {
    sync.innerHTML = signedIn
      ? `<div class="w-2 h-2 rounded-full bg-emerald-500"></div><span class="text-[10px] font-semibold text-emerald-400">Cloud synced</span>`
      : `<div class="w-2 h-2 rounded-full bg-slate-500"></div><span class="text-[10px] font-semibold text-slate-400">This device only</span>`;
  }

  updateMobileProfileDropdown();
  updateSupportFormVisibility();
  refreshIcons();
}

function updateMobileProfileDropdown() {
  const signedIn = Boolean(currentUser);
  const displayName = signedIn ? currentUser.displayName || currentUser.email || "User" : "Guest";
  const initials = signedIn
    ? displayName.split(/[\s@._-]+/).filter(Boolean).map((n) => n[0]).join("").substring(0, 2).toUpperCase()
    : "?";
  $("mobile-profile-initials").textContent = initials;
  $("menu-profile-initials").textContent = initials;
  $("menu-profile-name").textContent = signedIn ? displayName : "Guest User";
  $("menu-profile-email").textContent = signedIn ? currentUser.email || "" : "Not signed in";
  $("mobile-menu-auth-text").textContent = signedIn ? "Sign Out" : "Sign In";
  $("mobile-profile-online").classList.toggle("hidden", !signedIn);
  const icon = $("mobile-menu-auth-btn").querySelector("i,svg");
  if (icon) icon.outerHTML = `<i data-lucide="${signedIn ? "log-out" : "log-in"}" class="w-4 h-4"></i>`;
}

function toggleMobileProfileMenu() {
  $("mobile-profile-menu").classList.toggle("hidden");
}

function showAuthModal() {
  ["signin-error-msg", "signup-error-msg"].forEach((id) => $(id).classList.add("hidden"));
  openModal("auth-modal");
  setTimeout(() => $("signin-email").focus(), 60);
}
function hideAuthModal() {
  closeModal("auth-modal");
}
function skipAuthAndExplore() {
  hideAuthModal();
  showToast("Using offline mode. Sign in anytime to sync and unlock AI.", "info");
}

function switchAuthTab(tab) {
  const active = "flex-1 py-2.5 px-4 rounded-xl text-sm font-bold transition-all bg-violet-600 text-white";
  const inactive = "flex-1 py-2.5 px-4 rounded-xl text-sm font-bold transition-all bg-slate-800 text-slate-300 hover:bg-slate-700";
  $("auth-tab-signin").className = tab === "signin" ? active : inactive;
  $("auth-tab-signup").className = tab === "signup" ? active : inactive;
  $("signin-form").classList.toggle("hidden", tab !== "signin");
  $("signup-form").classList.toggle("hidden", tab === "signin");
}

function togglePasswordVisibility(inputId, iconId) {
  const input = $(inputId);
  const show = input.type === "password";
  input.type = show ? "text" : "password";
  const icon = $(iconId);
  if (icon) icon.outerHTML = `<i data-lucide="${show ? "eye-off" : "eye"}" id="${iconId}" class="w-4 h-4"></i>`;
  refreshIcons();
}

const PASSWORD_SPECIAL = /[^A-Za-z0-9]/;
function passwordPolicyErrors(password) {
  const errors = [];
  if (password.length < 8) errors.push("at least 8 characters");
  if (!/[A-Z]/.test(password)) errors.push("1 uppercase letter (A-Z)");
  if (!/[0-9]/.test(password)) errors.push("1 number (0-9)");
  if (!PASSWORD_SPECIAL.test(password)) errors.push("1 special character");
  return errors;
}

function updatePasswordPolicy() {
  const password = $("signup-password").value;
  const checks = {
    "policy-length": password.length >= 8,
    "policy-uppercase": /[A-Z]/.test(password),
    "policy-number": /[0-9]/.test(password),
    "policy-special": PASSWORD_SPECIAL.test(password),
  };
  Object.entries(checks).forEach(([id, passed]) => {
    const el = $(id);
    el.className = `flex items-center gap-1.5 ${passed ? "text-emerald-400" : "text-slate-500"}`;
    const dot = el.querySelector(".policy-dot");
    if (dot) dot.className = `policy-dot w-2.5 h-2.5 rounded-full border ${passed ? "bg-emerald-400 border-emerald-400" : "border-slate-600"}`;
  });
}

function setButtonLoading(prefix, loading, text) {
  const btn = $(`${prefix}-submit-btn`);
  btn.disabled = loading;
  btn.classList.toggle("opacity-70", loading);
  btn.classList.toggle("cursor-not-allowed", loading);
  $(`${prefix}-btn-text`).textContent = text;
  $(`${prefix}-btn-loader`).classList.toggle("hidden", !loading);
}

function showFormError(id, title, help = "") {
  const el = $(id);
  el.innerHTML = `<strong>${esc(title)}</strong>${help ? `<br><span class="text-slate-400 text-[10px]">${esc(help)}</span>` : ""}`;
  el.classList.remove("hidden");
}

const AUTH_ERRORS = {
  "auth/user-not-found": ["No account found with this email", "Check the address or create an account."],
  "auth/wrong-password": ["Incorrect password", "Try again or use “Forgot password?”."],
  "auth/invalid-credential": ["Email or password is incorrect", "Check your details or reset your password."],
  "auth/invalid-login-credentials": ["Email or password is incorrect", "Check your details or reset your password."],
  "auth/invalid-email": ["Invalid email address", "Please enter a valid email."],
  "auth/too-many-requests": ["Too many attempts", "Please wait a few minutes and try again."],
  "auth/network-request-failed": ["Network error", "Check your internet connection and try again."],
  "auth/email-already-in-use": ["Email already registered", "Try signing in instead."],
  "auth/weak-password": ["Password too weak", "Use at least 8 characters with a number and symbol."],
  "auth/user-disabled": ["This account has been disabled", "Contact support for help."],
};

async function handleEmailSignIn(event) {
  event.preventDefault();
  if (!auth) return showToast("Sign-in is unavailable right now. Please try again later.", "error");
  $("signin-error-msg").classList.add("hidden");
  setButtonLoading("signin", true, "Signing in...");
  try {
    justSignedIn = true;
    await auth.signInWithEmailAndPassword($("signin-email").value.trim(), $("signin-password").value);
    $("signin-password").value = "";
  } catch (error) {
    justSignedIn = false;
    const [title, help] = AUTH_ERRORS[error.code] || ["Sign in failed", "Please check your email and password."];
    showFormError("signin-error-msg", title, help);
  } finally {
    setButtonLoading("signin", false, "Sign In with Email");
  }
}

async function handleEmailSignUp(event) {
  event.preventDefault();
  if (!auth) return showToast("Sign-up is unavailable right now. Please try again later.", "error");
  const name = $("signup-name").value.trim();
  const email = $("signup-email").value.trim();
  const password = $("signup-password").value;
  $("signup-error-msg").classList.add("hidden");

  if (password !== $("signup-password-confirm").value) {
    return showFormError("signup-error-msg", "Passwords do not match", "Please type the same password in both fields.");
  }
  const policyErrors = passwordPolicyErrors(password);
  if (policyErrors.length) {
    return showFormError("signup-error-msg", "Password requirements not met", `Your password needs ${policyErrors.join(", ")}.`);
  }

  setButtonLoading("signup", true, "Creating account...");
  try {
    justSignedIn = true;
    const cred = await auth.createUserWithEmailAndPassword(email, password);
    await cred.user.updateProfile({ displayName: name });
    updateAuthUI();
    cred.user.sendEmailVerification().catch(() => {});
    showToast(`Welcome, ${name.split(" ")[0]}! Your account is ready.`, "success");
  } catch (error) {
    justSignedIn = false;
    const [title, help] = AUTH_ERRORS[error.code] || ["Sign up failed", "Please try again."];
    showFormError("signup-error-msg", title, help);
  } finally {
    setButtonLoading("signup", false, "Create Account");
  }
}

async function handleGoogleSignIn() {
  if (!auth) return showToast("Sign-in is unavailable right now. Please try again later.", "error");
  const provider = new firebase.auth.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  justSignedIn = true;
  try {
    await auth.signInWithPopup(provider);
  } catch (error) {
    justSignedIn = false;
    if (["auth/popup-closed-by-user", "auth/cancelled-popup-request"].includes(error.code)) return;
    if (error.code === "auth/popup-blocked" || error.code === "auth/operation-not-supported-in-this-environment") {
      justSignedIn = true;
      return auth.signInWithRedirect(provider);
    }
    const messages = {
      "auth/unauthorized-domain": "Google sign-in isn't enabled for this domain yet.",
      "auth/operation-not-allowed": "Google sign-in isn't enabled for this app.",
      "auth/network-request-failed": "Network error. Check your connection and try again.",
    };
    showToast(messages[error.code] || "Google sign-in failed. Please try again.", "error");
    console.error("Google sign in error:", error);
  }
}

function openForgotPasswordModal() {
  $("forgot-error-msg").classList.add("hidden");
  $("forgot-success-msg").classList.add("hidden");
  $("forgot-email").value = $("signin-email").value || "";
  hideAuthModal();
  openModal("modal-forgot-password");
  setTimeout(() => $("forgot-email").focus(), 60);
}
function closeForgotPasswordModal() {
  closeModal("modal-forgot-password");
}

async function handleForgotPasswordSubmit(e) {
  e.preventDefault();
  if (!auth) return showToast("Password reset is unavailable right now.", "error");
  const email = $("forgot-email").value.trim();
  $("forgot-error-msg").classList.add("hidden");
  $("forgot-success-msg").classList.add("hidden");
  setButtonLoading("forgot", true, "Sending...");
  try {
    await auth.sendPasswordResetEmail(email);
    // Same message whether or not the account exists, to avoid revealing registered emails.
    const box = $("forgot-success-msg");
    box.innerHTML = `<strong>Check your email</strong><br><span class="text-slate-300">If an account exists for <strong>${esc(email)}</strong>, a reset link is on its way. Check spam too.</span>`;
    box.classList.remove("hidden");
  } catch (error) {
    if (error.code === "auth/user-not-found") {
      const box = $("forgot-success-msg");
      box.innerHTML = `<strong>Check your email</strong><br><span class="text-slate-300">If an account exists for <strong>${esc(email)}</strong>, a reset link is on its way. Check spam too.</span>`;
      box.classList.remove("hidden");
    } else {
      const [title] = AUTH_ERRORS[error.code] || ["Couldn't send the reset email"];
      showFormError("forgot-error-msg", title);
    }
  } finally {
    setButtonLoading("forgot", false, "Send Reset Link");
  }
}

function closeResetPasswordModal() {
  closeModal("modal-reset-password");
  const url = new URL(window.location);
  url.search = "";
  window.history.replaceState({}, document.title, url);
}

async function handleResetPasswordSubmit(e) {
  e.preventDefault();
  const newPassword = $("reset-new-password").value;
  const errors = passwordPolicyErrors(newPassword);
  if (errors.length) return showFormError("reset-error-msg", "Password requirements not met", `Your password needs ${errors.join(", ")}.`);
  if (!auth) return showFormError("reset-error-msg", "Password reset is unavailable right now.");
  setButtonLoading("reset", true, "Updating...");
  $("reset-error-msg").classList.add("hidden");
  try {
    await auth.confirmPasswordReset($("reset-oob-code").value, newPassword);
    $("reset-success-msg").innerHTML = "<strong>Password updated!</strong><br>You can now sign in with your new password.";
    $("reset-success-msg").classList.remove("hidden");
    setButtonLoading("reset", false, "Success!");
    setTimeout(() => {
      closeResetPasswordModal();
      showAuthModal();
    }, 1800);
  } catch (error) {
    showFormError("reset-error-msg", "This reset link is invalid or has expired.", "Request a new link from the sign-in screen.");
    setButtonLoading("reset", false, "Update Password");
  }
}

// =============================================================================
// BIOMETRIC LOCK (WebAuthn platform authenticator: Face ID / Touch ID / Windows Hello / fingerprint)
// =============================================================================
const LOCK_KEY = "spendsense_lock_cred";
const LOCK_AFTER_MS = 5 * 60 * 1000;
let hiddenAt = null;

const b64urlEncode = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64urlDecode = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
const isLockEnabled = () => LS.get("spendsense_biometrics") === "true" && Boolean(LS.get(LOCK_KEY));

async function platformAuthenticatorAvailable() {
  try {
    return Boolean(window.PublicKeyCredential && (await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()));
  } catch {
    return false;
  }
}

function initBiometricLock() {
  // Earlier versions only simulated a lock; drop that flag so nobody is locked out without a credential.
  if (LS.get("spendsense_biometrics") === "true" && !LS.get(LOCK_KEY)) LS.set("spendsense_biometrics", "false");
  $("setting-biometric-toggle").checked = isLockEnabled();
  if (isLockEnabled()) showLockScreen();

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) hiddenAt = Date.now();
    else if (hiddenAt && isLockEnabled() && Date.now() - hiddenAt > LOCK_AFTER_MS) showLockScreen();
  });
  platformAuthenticatorAvailable().then((ok) => {
    const status = $("biometric-status-text");
    if (status && !ok) status.textContent = "Not available on this device/browser.";
  });
}

function showLockScreen() {
  $("biometric-error").classList.add("hidden");
  openModal("biometric-modal");
}

async function simulateBiometricSuccess() {
  // Kept for backwards compatibility with the old button handler name.
  return unlockWithBiometrics();
}

async function unlockWithBiometrics() {
  const errorBox = $("biometric-error");
  errorBox.classList.add("hidden");
  try {
    const credId = LS.get(LOCK_KEY);
    if (!credId) throw new Error("No credential");
    await navigator.credentials.get({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        allowCredentials: [{ id: b64urlDecode(credId), type: "public-key", transports: ["internal", "hybrid"] }],
        userVerification: "required",
        timeout: 60000,
      },
    });
    closeModal("biometric-modal");
    hiddenAt = null;
  } catch (err) {
    console.warn("Biometric unlock failed:", err);
    errorBox.textContent = err && err.name === "NotAllowedError" ? "Verification was cancelled or timed out. Try again." : "Couldn't verify. Try again.";
    errorBox.classList.remove("hidden");
  }
}

async function disableBiometricsTemporarily() {
  // "Can't unlock?" — resetting the lock also removes this device's data, so the lock can't simply be bypassed.
  const signedIn = Boolean(currentUser);
  const ok = await showConfirmationModal(
    "Reset the app lock?",
    signedIn
      ? "You'll be signed out and this device's data will be cleared. Your cloud data is safe — sign in again to restore it."
      : "Without verification, the only way to reset the lock is to erase all data stored on this device.",
    { icon: "shield-alert", color: "red", confirmText: signedIn ? "Sign out & reset" : "Erase & reset" }
  );
  if (!ok) return;
  if (signedIn && auth) await auth.signOut().catch(() => {});
  try {
    localStorage.clear();
  } catch {}
  LS.set("spendsense_onboarded", "true");
  window.location.replace(window.location.pathname);
}

async function toggleBiometricSetting(e) {
  const checkbox = e.target;
  if (!checkbox.checked) {
    LS.set("spendsense_biometrics", "false");
    LS.remove(LOCK_KEY);
    showToast("App lock turned off.", "info");
    return;
  }
  if (!(await platformAuthenticatorAvailable())) {
    checkbox.checked = false;
    return showToast("This device doesn't support Face ID / fingerprint / Windows Hello in the browser.", "error");
  }
  try {
    const cred = await navigator.credentials.create({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        rp: { name: "SpendSense AI" },
        user: { id: crypto.getRandomValues(new Uint8Array(16)), name: currentUser?.email || "spendsense-user", displayName: "SpendSense app lock" },
        pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
        authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required", residentKey: "discouraged" },
        timeout: 60000,
        attestation: "none",
      },
    });
    LS.set(LOCK_KEY, b64urlEncode(cred.rawId));
    LS.set("spendsense_biometrics", "true");
    showToast("App lock enabled. You'll verify with your device when opening SpendSense.", "success");
  } catch (err) {
    checkbox.checked = false;
    console.warn("Biometric enrol failed:", err);
    showToast("App lock wasn't enabled (verification cancelled).", "info");
  }
}

// =============================================================================
// SUPPORT FORM
// =============================================================================
async function handleSupportFormSubmit(event) {
  event.preventDefault();
  if (!currentUser) return showToast("Please sign in to contact support.", "error");
  const form = event.target;
  $("support-user-id").value = userId;
  $("support-user-email-verified").value = currentUser.emailVerified ? "Yes" : "No";
  $("support-timestamp").value = new Date().toISOString();
  const btn = form.querySelector('button[type="submit"]');
  btn.disabled = true;
  try {
    const res = await fetch("/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(new FormData(form)).toString(),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    $("support-success-message").classList.remove("hidden");
    form.reset();
    updateSupportFormUserInfo();
    setTimeout(() => $("support-success-message").classList.add("hidden"), 6000);
    showToast("Message sent. We'll get back to you soon.", "success");
  } catch (error) {
    console.error("Support form error:", error);
    showToast("Couldn't send your message. Please try again.", "error");
  } finally {
    btn.disabled = false;
  }
}

function updateSupportFormVisibility() {
  const signedIn = Boolean(currentUser);
  $("support-form-section").classList.toggle("hidden", !signedIn);
  $("delete-account-section").classList.toggle("hidden", !signedIn);
  if (signedIn) updateSupportFormUserInfo();
}

function updateSupportFormUserInfo() {
  if (!currentUser) return;
  if (currentUser.displayName) $("support-name").value = currentUser.displayName;
  if (currentUser.email) $("support-email").value = currentUser.email;
}

// =============================================================================
// SETTINGS
// =============================================================================
function saveSettingsPatch(patch) {
  if (isCloud()) {
    return cloudWrite(userDoc().set(patch, { merge: true }), "settings").catch(() => {});
  }
  saveLocalSession();
  return Promise.resolve();
}

function setGlobalCurrency(code, { silent = false } = {}) {
  if (!CURRENCIES[code]) return;
  currentGlobalCurrency = code;
  LS.set("spendsense_global_currency", code);
  if (isCloud()) saveSettingsPatch({ globalCurrency: code });
  syncSettingsInputs();
  setupAppInterface();
  renderChatMessages();
  if (!silent) showToast(`Showing all amounts in ${code}. Existing entries were converted at live rates.`, "success");
}

function changeGlobalCurrency(e) {
  setGlobalCurrency(e.target.value);
}

function parsePositiveInput(id, { allowZero = true } = {}) {
  const raw = $(id).value.trim();
  const value = parseFloat(raw);
  if (raw === "" || Number.isNaN(value) || value < 0 || (!allowZero && value === 0)) {
    showToast("Please enter a valid amount.", "error");
    $(id).focus();
    return null;
  }
  return round2(value);
}

function saveWeeklyTarget() {
  const value = parsePositiveInput("setting-weekly-target");
  if (value === null) return;
  weeklyTarget = value;
  weeklyCurrency = currentGlobalCurrency;
  if (value > 0 && !useWeeklyTargetOverride) {
    useWeeklyTargetOverride = true;
    $("setting-use-weekly-override").checked = true;
  }
  saveSettingsPatch({ weeklyTarget: value, weeklyCurrency, useWeeklyTargetOverride });
  showToast(value > 0 ? `Weekly target set to ${formatCurrency(value)}.` : "Weekly target cleared.", "success");
  setupAppInterface();
}

function toggleWeeklyOverride(e) {
  useWeeklyTargetOverride = e.target.checked;
  saveSettingsPatch({ useWeeklyTargetOverride });
  showToast(useWeeklyTargetOverride ? "Using your custom weekly target." : "Weekly target now follows your monthly budget.", "info");
  setupAppInterface();
}

function saveMonthlyIncome() {
  const value = parsePositiveInput("setting-monthly-income");
  if (value === null) return;
  monthlyIncome = value;
  incomeCurrency = currentGlobalCurrency;
  saveSettingsPatch({ monthlyIncome: value, incomeCurrency });
  showToast(value > 0 ? `Monthly income set to ${formatCurrency(value)}.` : "Monthly income cleared.", "success");
  setupAppInterface();
}

function saveQuickMonthlyBudget(valueOverride) {
  const value = typeof valueOverride === "number" ? round2(valueOverride) : parsePositiveInput("quick-monthly-budget-input");
  if (value === null) return;
  monthlyBudgetLimit = value;
  budgetCurrency = currentGlobalCurrency;
  saveSettingsPatch({ monthlyBudgetLimit: value, budgetCurrency });
  if (getMonthlyIncome() > 0 && value > getMonthlyIncome()) showToast(`Heads up: that budget is more than your monthly income (${formatCurrency(getMonthlyIncome())}).`, "info");
  else showToast(value > 0 ? `Monthly budget set to ${formatCurrency(value)}.` : "Monthly budget cleared.", "success");
  syncSettingsInputs();
  setupAppInterface();
}

// =============================================================================
// EXCHANGE RATES
// =============================================================================
async function initializeExchangeRates(forceNotify = false) {
  const statusText = $("rates-api-status-text");
  const statusIcon = $("rates-status-icon");
  const cached = LS.getJSON("spendsense_rates", null);
  if (!forceNotify && cached && Date.now() - cached.ts < 6 * 3600_000) {
    statusText.textContent = `Live rates from ${new Date(cached.ts).toLocaleString()}.`;
    statusText.className = "text-[10px] text-emerald-400 font-semibold";
    return;
  }
  try {
    const res = await fetch("https://open.er-api.com/v6/latest/USD");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data || !data.rates) throw new Error("No rates");
    const rates = {};
    Object.keys(CURRENCIES).forEach((c) => {
      if (data.rates[c]) rates[c] = data.rates[c];
    });
    usdRates = { ...usdRates, ...rates };
    LS.set("spendsense_rates", { rates, ts: Date.now() });
    const updated = data.time_last_update_utc ? new Date(data.time_last_update_utc).toLocaleDateString() : new Date().toLocaleDateString();
    statusText.textContent = `Connected — rates updated ${updated}.`;
    statusText.className = "text-[10px] text-emerald-400 font-semibold";
    statusIcon.setAttribute("class", "w-5 h-5 text-emerald-400");
    if (forceNotify) showToast("Exchange rates updated.", "success");
    setupAppInterface();
  } catch (err) {
    statusText.textContent = cached ? `Offline — using rates from ${new Date(cached.ts).toLocaleDateString()}.` : "Offline — using built-in reference rates.";
    statusText.className = "text-[10px] text-slate-400 font-medium";
    if (forceNotify) showToast("Couldn't reach the rates service. Using saved rates.", "info");
  }
}

// =============================================================================
// TOASTS
// =============================================================================
function showToast(message, type = "success") {
  const container = $("toast-container");
  if (!container) return;
  const toast = document.createElement("div");
  const tone = type === "error" ? "border-red-500/70" : type === "info" ? "border-cyan-500/70" : "border-emerald-500/70";
  const iconColor = type === "error" ? "text-red-400" : type === "info" ? "text-cyan-400" : "text-emerald-400";
  toast.setAttribute("role", type === "error" ? "alert" : "status");
  toast.className = `flex items-center gap-3 px-4 py-3 rounded-2xl shadow-2xl border ${tone} transition-all duration-300 transform translate-y-2 opacity-0 pointer-events-none max-w-sm bg-slate-900`;
  toast.innerHTML = `<i data-lucide="${type === "error" ? "alert-triangle" : type === "info" ? "info" : "check-circle"}" class="w-5 h-5 flex-shrink-0 ${iconColor}"></i><span class="text-xs font-semibold text-slate-100"></span>`;
  toast.querySelector("span").textContent = message;
  container.appendChild(toast);
  while (container.children.length > 4) container.firstElementChild.remove();
  refreshIcons();
  setTimeout(() => toast.classList.remove("translate-y-2", "opacity-0"), 30);
  setTimeout(() => {
    toast.classList.add("translate-y-2", "opacity-0");
    setTimeout(() => toast.remove(), 300);
  }, type === "error" ? 6000 : 4000);
}

// =============================================================================
// NAVIGATION
// =============================================================================
const TABS = Object.keys(TAB_META);

function switchTab(tabId, opts = {}) {
  if (!TAB_META[tabId]) tabId = "dashboard";
  activeTab = tabId;
  TABS.forEach((t) => {
    $(`tab-${t}`).classList.toggle("hidden", t !== tabId);
    const side = $(`tab-btn-${t}`);
    side.className =
      t === tabId
        ? "w-full flex items-center gap-3 py-3 px-4 rounded-xl text-sm font-bold transition-all duration-200 bg-violet-600/15 text-violet-300 border border-violet-500/25 relative"
        : "w-full flex items-center gap-3 py-3 px-4 rounded-xl text-sm font-semibold transition-all duration-200 text-slate-400 hover:text-slate-100 hover:bg-slate-800 border border-transparent relative";
    if (t === tabId) side.setAttribute("aria-current", "page");
    else side.removeAttribute("aria-current");
    const mobile = $(`mobile-tab-${t}`);
    if (mobile) mobile.className = `flex flex-col items-center justify-center w-12 h-12 ${t === tabId ? "text-violet-400 font-bold" : "text-slate-400"} relative`;
  });
  $("page-title").textContent = TAB_META[tabId][0];
  $("page-subtitle").textContent = TAB_META[tabId][1];
  document.title = `${TAB_META[tabId][0]} · SpendSense AI`;

  if (!opts.fromHistory) {
    const url = `#${tabId}`;
    if (opts.replace) history.replaceState(null, "", url);
    else if (location.hash !== url) history.pushState(null, "", url);
  }
  if (tabId === "coach") {
    renderChatMessages();
    if (window.matchMedia("(min-width: 768px)").matches) setTimeout(() => $("chat-input-field").focus(), 50);
  }
  window.scrollTo({ top: 0 });
  scheduleRender();
}

// =============================================================================
// RENDERING
// =============================================================================
let renderQueued = false;
function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  setTimeout(() => {
    renderQueued = false;
    setupAppInterface();
  }, 0);
}

function setupAppInterface() {
  const stats = getStats();
  calculateFinancialMetrics(stats);
  renderInteractiveChart(stats);
  renderAnomaliesEngine();
  renderRecentLogs();
  renderLedgerTable();
  renderFilterButtons();
  renderSavingsGoals();
  renderSubscriptionsCorner();
  renderCategoryBudgetConfiguration(stats);
  renderQuickBudgetCard(stats);
  generateNotifications(stats);
  renderNotificationCenterList();
  renderOcrPresetPrices();
  saveLocalSession();
  refreshIcons();
}

function trendHTML(current, previous) {
  if (!(previous > 0)) {
    return `<i data-lucide="calendar" class="w-3.5 h-3.5"></i><span>${current > 0 ? "No data for last month yet" : "Nothing spent yet this month"}</span>`;
  }
  const pct = ((current - previous) / previous) * 100;
  const up = pct > 0;
  return `<i data-lucide="${up ? "trending-up" : "trending-down"}" class="w-3.5 h-3.5"></i><span>${up ? "Up" : "Down"} ${Math.abs(pct).toFixed(0)}% vs. same point last month</span>`;
}

function calculateFinancialMetrics(stats = getStats()) {
  $("stat-total-spent").textContent = formatCurrency(stats.spentThisMonth);
  const trend = $("stat-spent-trend");
  const up = stats.lastMonthSamePoint > 0 && stats.spentThisMonth > stats.lastMonthSamePoint;
  trend.className = `text-[11px] mt-2 flex items-center gap-1 font-semibold ${stats.lastMonthSamePoint > 0 ? (up ? "text-red-400" : "text-emerald-400") : "text-slate-400"}`;
  trend.innerHTML = trendHTML(stats.spentThisMonth, stats.lastMonthSamePoint);

  $("stat-total-income").textContent = formatCurrency(stats.income);
  const incomeSub = $("stat-income-sub");
  if (getMonthlyIncome() > 0) {
    incomeSub.className = "text-[11px] text-slate-400 mt-2 flex items-center gap-1 font-semibold";
    incomeSub.innerHTML = `<i data-lucide="wallet" class="w-3.5 h-3.5 text-emerald-400"></i><span>From your settings${stats.incomeThisMonth > 0 ? ` · ${esc(formatCurrency(stats.incomeThisMonth))} logged` : ""}</span>`;
  } else if (stats.incomeThisMonth > 0) {
    incomeSub.className = "text-[11px] text-emerald-400 mt-2 flex items-center gap-1 font-semibold";
    incomeSub.innerHTML = `<i data-lucide="check-circle" class="w-3.5 h-3.5"></i><span>Income logged this month</span>`;
  } else {
    incomeSub.className = "text-[11px] text-slate-400 mt-2 flex items-center gap-1 font-semibold";
    incomeSub.innerHTML = `<button data-action="tab" data-tab="settings" class="text-violet-400 hover:underline">Set your monthly income →</button>`;
  }

  const rateEl = $("stat-savings-rate");
  if (stats.savingsRate === null) {
    rateEl.textContent = "—";
    $("stat-savings-sub").textContent = "Add income to see your savings rate";
  } else {
    rateEl.textContent = `${stats.savingsRate.toFixed(0)}%`;
    $("stat-savings-sub").textContent = `${stats.savings >= 0 ? "Saved" : "Overspent"} ${formatCurrency(Math.abs(stats.savings))} this month`;
  }
  rateEl.className = `text-lg md:text-2xl font-black leading-tight truncate ${stats.savingsRate !== null && stats.savingsRate < 0 ? "text-red-400" : "text-violet-400"}`;
  $("savings-rate-bar").style.width = `${Math.max(0, Math.min(100, stats.savingsRate || 0))}%`;

  const weekly = effectiveWeeklyTarget();
  $("stat-week-limit").textContent = weekly > 0 ? formatCurrency(weekly) : "Not set";
  const weekSub = $("stat-daily-limit-sub");
  if (weekly > 0) {
    const pct = (stats.spentLast7 / weekly) * 100;
    weekSub.innerHTML = `<span class="${pct > 100 ? "text-red-400" : pct > 80 ? "text-amber-400" : "text-slate-400"}">${esc(formatCurrency(stats.spentLast7))} spent in the last 7 days</span>`;
    $("stat-week-bar").style.width = `${Math.min(100, pct)}%`;
    $("stat-week-bar").className = `h-full rounded-full ${pct > 100 ? "bg-red-500" : pct > 80 ? "bg-amber-500" : "bg-cyan-500"}`;
  } else {
    weekSub.innerHTML = `<button data-action="tab" data-tab="budgets" class="text-violet-400 hover:underline">Set a monthly budget →</button>`;
    $("stat-week-bar").style.width = "0%";
  }

  generateProactiveCopilotTip(stats);
}

function generateProactiveCopilotTip(stats = getStats()) {
  const headline = $("copilot-tip-headline");
  const message = $("copilot-tip-message");
  const btn = $("copilot-chat-btn");
  const set = (h, m, prompt) => {
    headline.textContent = h;
    message.textContent = m;
    btn.dataset.prompt = prompt;
  };

  if (!expenses.length) {
    return set("Let's get you started", "Log a few expenses (try the mic: “spent 250 on lunch”) and I'll start spotting patterns for you.", "Help me set up a simple monthly budget. Ask me a couple of questions first.");
  }
  if (stats.spentThisMonth === 0) {
    return set("Fresh month", "Nothing logged this month yet. Set a budget now so you can track your pace from day one.", "Suggest a realistic monthly budget for me based on my past spending.");
  }
  const budget = stats.monthlyBudget;
  if (budget > 0 && stats.projected > budget * 1.03) {
    const remaining = Math.max(0, budget - stats.spentThisMonth);
    return set(
      "⚠️ You're on pace to overspend",
      `At this rate you'll spend about ${formatCurrency(stats.projected)} this month — ${formatCurrency(stats.projected - budget)} over budget. Keep daily spending under ${formatCurrency(remaining / stats.daysLeft)} to stay on track.`,
      `I'm projected to spend ${formatCurrency(stats.projected)} this month against a ${formatCurrency(budget)} budget. Which of my categories should I cut, and by how much, to finish on budget?`
    );
  }
  const overCat = budgets
    .map((b) => ({ b, spent: stats.byCategory[b.category] || 0, limit: budgetLimitBase(b) }))
    .filter((x) => x.limit > 0 && x.spent / x.limit >= 0.9)
    .sort((a, b) => b.spent / b.limit - a.spent / a.limit)[0];
  if (overCat) {
    const pct = Math.round((overCat.spent / overCat.limit) * 100);
    return set(
      `${categoryInfo(overCat.b.category).icon} ${overCat.b.category} at ${pct}% of budget`,
      `${formatCurrency(overCat.spent)} of ${formatCurrency(overCat.limit)} used with ${stats.daysLeft} day${stats.daysLeft === 1 ? "" : "s"} left this month.`,
      `My ${overCat.b.category} spending is ${formatCurrency(overCat.spent)} of a ${formatCurrency(overCat.limit)} budget. Give me 3 specific ways to cut back for the rest of the month.`
    );
  }
  const rising = Object.entries(stats.byCategory)
    .map(([cat, v]) => ({ cat, v, last: stats.lastByCategory[cat] || 0 }))
    .filter((x) => x.last > 0 && x.v > x.last * 1.25 && x.v - x.last > convert(20, "USD"))
    .sort((a, b) => b.v - b.last - (a.v - a.last))[0];
  if (rising) {
    return set(
      `${categoryInfo(rising.cat).icon} ${rising.cat} is up`,
      `You've already spent ${formatCurrency(rising.v)} on ${rising.cat} this month vs ${formatCurrency(rising.last)} in all of last month.`,
      `Why is my ${rising.cat} spending higher this month than last month? Look at my transactions and tell me what changed.`
    );
  }
  const [topCat, topAmt] = Object.entries(stats.byCategory).sort((a, b) => b[1] - a[1])[0] || [];
  if (budget > 0) {
    const remaining = budget - stats.spentThisMonth;
    return set(
      "✅ On track this month",
      `${formatCurrency(remaining)} left of your ${formatCurrency(budget)} budget — about ${formatCurrency(remaining / stats.daysLeft)} a day for the next ${stats.daysLeft} days.${topCat ? ` Top category: ${topCat}.` : ""}`,
      "I'm on track with my budget. How can I turn the leftover into savings this month?"
    );
  }
  return set(
    `${categoryInfo(topCat).icon} ${topCat} leads your spending`,
    `${formatCurrency(topAmt)} of ${formatCurrency(stats.spentThisMonth)} this month (${Math.round((topAmt / stats.spentThisMonth) * 100)}%). Set a monthly budget to unlock pace tracking.`,
    `My biggest category this month is ${topCat} at ${formatCurrency(topAmt)}. Is that reasonable, and what budget would you suggest for it?`
  );
}

function renderInteractiveChart(stats = getStats()) {
  const entries = Object.entries(stats.byCategory).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const total = stats.spentThisMonth;
  $("chart-center-total").textContent = formatMoney(total, currentGlobalCurrency, { compact: total >= 100000 });

  if (typeof Chart !== "undefined") {
    const data = entries.length ? entries.map(([, v]) => round2(v)) : [1];
    const colors = entries.length ? entries.map(([c]) => categoryInfo(c).chartColor) : ["#1e293b"];
    const labels = entries.length ? entries.map(([c]) => c) : ["No spending"];
    if (spendingChartInstance) {
      spendingChartInstance.data.labels = labels;
      spendingChartInstance.data.datasets[0].data = data;
      spendingChartInstance.data.datasets[0].backgroundColor = colors;
      spendingChartInstance.options.plugins.tooltip.enabled = entries.length > 0;
      spendingChartInstance.update("none");
    } else {
      spendingChartInstance = new Chart($("spendingChart").getContext("2d"), {
        type: "doughnut",
        data: { labels, datasets: [{ data, backgroundColor: colors, borderWidth: 0, hoverOffset: 4 }] },
        options: {
          cutout: "78%",
          animation: { duration: 300 },
          plugins: {
            legend: { display: false },
            tooltip: { enabled: entries.length > 0, callbacks: { label: (ctx) => ` ${ctx.label}: ${formatCurrency(ctx.raw)}` } },
          },
        },
      });
    }
  }

  const list = $("categories-allocated-list");
  if (!entries.length) {
    list.innerHTML = `<div class="text-xs text-slate-500 py-6 text-center">${expenses.length ? "No spending logged this month yet." : "Your category breakdown appears here once you log expenses."}</div>`;
    return;
  }
  list.innerHTML = entries
    .map(([cat, spent]) => {
      const info = categoryInfo(cat);
      const pct = total > 0 ? (spent / total) * 100 : 0;
      const budget = budgets.find((b) => b.category === cat);
      const limit = budget ? budgetLimitBase(budget) : 0;
      return `<div class="space-y-1">
        <div class="flex justify-between items-center text-xs gap-2">
          <div class="flex items-center gap-2 min-w-0">
            <span class="w-2.5 h-2.5 rounded-full flex-shrink-0" style="background-color:${info.chartColor}"></span>
            <span class="text-slate-300 font-bold text-[11px] truncate">${esc(cat)} <span class="text-slate-500 font-semibold">${pct.toFixed(0)}%</span></span>
          </div>
          <span class="font-bold text-slate-100 text-[11px] whitespace-nowrap">${esc(formatCurrency(spent))}${limit > 0 ? ` <span class="text-slate-500 font-normal">/ ${esc(formatCurrency(limit))}</span>` : ""}</span>
        </div>
        <div class="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden"><div class="h-full rounded-full" style="background-color:${info.chartColor};width:${Math.min(100, limit > 0 ? (spent / limit) * 100 : pct).toFixed(1)}%"></div></div>
      </div>`;
    })
    .join("");
}

function renderAnomaliesEngine() {
  const banner = $("anomaly-banner");
  const list = $("anomaly-alerts-list");
  const dismissed = new Set(LS.getJSON("spendsense_dismissed_anomalies", []));
  const anomalies = detectAnomalies().filter((a) => !dismissed.has(a.id));
  if (!anomalies.length) {
    banner.classList.add("hidden");
    list.innerHTML = "";
    return;
  }
  banner.classList.remove("hidden");
  list.innerHTML = anomalies
    .map(
      (a) => `<div class="text-xs text-amber-100 bg-slate-900 py-2.5 px-3 rounded-xl border border-amber-500/20 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <span><strong>${esc(a.merchant)}</strong> · ${esc(formatCurrency(a.amount))} on ${esc(formatDisplayDate(a.date))} is <strong>${a.multiplier.toFixed(1)}×</strong> your typical ${esc(a.category)} spend (${esc(formatCurrency(a.median))}).</span>
        <span class="flex gap-3 flex-shrink-0">
          <button data-action="chat" data-prompt="${esc(`My ${formatCurrency(a.amount)} purchase at ${a.merchant} on ${a.date} is much higher than my usual ${a.category} spending. Is this a concern, and how should I plan around it?`)}" class="text-[10px] text-amber-400 font-black hover:underline">Ask coach</button>
          <button onclick="dismissAnomaly('${esc(a.id)}')" class="text-[10px] text-slate-400 hover:text-slate-200 font-bold">Dismiss</button>
        </span>
      </div>`
    )
    .join("");
}

function dismissAnomaly(id) {
  const dismissed = LS.getJSON("spendsense_dismissed_anomalies", []);
  dismissed.push(id);
  LS.set("spendsense_dismissed_anomalies", dismissed.slice(-200));
  renderAnomaliesEngine();
}

function amountCellHTML(ex, size = "text-sm") {
  const inc = isIncome(ex);
  const main = `<span class="${size} font-black ${inc ? "text-emerald-400" : "text-slate-100"}">${inc ? "+" : "−"}${esc(formatCurrency(amountBase(ex)))}</span>`;
  const original = ex.currency !== currentGlobalCurrency ? `<span class="block text-[10px] text-slate-500 font-mono">${esc(formatMoney(ex.amount, ex.currency))}</span>` : "";
  return main + original;
}

function renderRecentLogs() {
  const container = $("recent-logs-list");
  const items = expenses.slice(0, 6);
  if (!items.length) {
    container.innerHTML = `<div class="text-xs text-slate-500 py-8 text-center space-y-3"><p>No transactions yet.</p><button onclick="openExpenseModal()" class="py-2 px-4 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-bold">Add your first expense</button></div>`;
    return;
  }
  container.innerHTML = items
    .map((ex) => {
      const cat = categoryInfo(ex.category);
      return `<button data-action="edit-expense" data-id="${esc(ex.id)}" class="w-full text-left py-3 flex items-center justify-between gap-3 hover:bg-slate-800 px-2 rounded-xl transition-colors">
        <div class="flex items-center gap-3 min-w-0">
          <div class="w-10 h-10 rounded-xl bg-slate-800 flex items-center justify-center text-lg flex-shrink-0">${cat.icon}</div>
          <div class="min-w-0">
            <h5 class="text-xs font-bold text-slate-200 truncate">${esc(ex.merchant)}${ex.isSubscription ? ` <span class="text-[9px] bg-violet-500/10 text-violet-400 py-0.5 px-1.5 rounded font-mono font-semibold ml-1">Recurring</span>` : ""}</h5>
            <div class="flex items-center gap-1.5 mt-0.5 text-[10px] text-slate-400 font-medium"><span>${esc(formatDisplayDate(ex.date))}</span><span>•</span><span class="truncate">${esc(ex.category)}</span></div>
          </div>
        </div>
        <div class="text-right flex-shrink-0">${amountCellHTML(ex)}</div>
      </button>`;
    })
    .join("");
}

function ledgerRows() {
  const now = new Date();
  const ranges = {
    "this-month": [toISODate(new Date(now.getFullYear(), now.getMonth(), 1)), toISODate(now)],
    "last-month": [toISODate(new Date(now.getFullYear(), now.getMonth() - 1, 1)), toISODate(new Date(now.getFullYear(), now.getMonth(), 0))],
    "last-30": [toISODate(addDays(now, -29)), toISODate(now)],
    "this-year": [`${now.getFullYear()}-01-01`, `${now.getFullYear()}-12-31`],
  };
  const range = ranges[ledgerPeriod];
  let rows = expenses.filter((ex) => {
    if (activeFilter !== "All" && ex.category !== activeFilter) return false;
    if (range && !inRange(ex, range[0], range[1])) return false;
    if (ledgerSearch) {
      const hay = `${ex.merchant} ${ex.note} ${ex.category} ${ex.paymentMethod} ${ex.amount}`.toLowerCase();
      if (!hay.includes(ledgerSearch)) return false;
    }
    return true;
  });
  const sorters = {
    "date-desc": null,
    "date-asc": (a, b) => (a.date === b.date ? (a.createdAt || 0) - (b.createdAt || 0) : a.date < b.date ? -1 : 1),
    "amount-desc": (a, b) => amountBase(b) - amountBase(a),
    "amount-asc": (a, b) => amountBase(a) - amountBase(b),
  };
  if (sorters[ledgerSort]) rows = [...rows].sort(sorters[ledgerSort]);
  return rows;
}

function renderLedgerTable() {
  const body = $("expenses-table-body");
  const mobile = $("expenses-mobile-list");
  const rows = ledgerRows();
  $("ledger-count").textContent = rows.length;
  const spent = sum(rows.filter((e) => !isIncome(e)), amountBase);
  const income = sum(rows.filter(isIncome), amountBase);
  $("ledger-total").textContent = rows.length ? `${formatCurrency(spent)} spent${income > 0 ? ` · ${formatCurrency(income)} income` : ""}` : "";

  if (!rows.length) {
    const msg = expenses.length ? "No transactions match these filters." : "No transactions yet — add one with the + button or the mic.";
    body.innerHTML = `<tr><td colspan="7" class="py-12 text-center text-slate-400 text-xs">${msg}</td></tr>`;
    mobile.innerHTML = `<div class="py-10 text-center text-slate-400 text-xs">${msg}</div>`;
    return;
  }

  const actions = (ex) => `<div class="flex items-center justify-center gap-1">
      <button data-action="edit-expense" data-id="${esc(ex.id)}" aria-label="Edit ${esc(ex.merchant)}" class="p-2 text-slate-400 hover:text-violet-400 hover:bg-slate-700 rounded-lg transition-all"><i data-lucide="pencil" class="w-3.5 h-3.5"></i></button>
      <button data-action="delete-expense" data-id="${esc(ex.id)}" aria-label="Delete ${esc(ex.merchant)}" class="p-2 text-slate-400 hover:text-red-400 hover:bg-slate-700 rounded-lg transition-all"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i></button>
    </div>`;

  body.innerHTML = rows
    .map((ex) => {
      const cat = categoryInfo(ex.category);
      return `<tr class="hover:bg-slate-800/60 transition-colors">
        <td class="py-3.5 px-5 font-mono text-slate-400 text-[11px] whitespace-nowrap">${esc(ex.date)}</td>
        <td class="py-3.5 px-5 font-bold text-slate-200"><div class="flex items-center gap-1.5">${esc(ex.merchant)}${ex.isSubscription ? `<span class="text-[9px] bg-violet-500/10 text-violet-400 py-0.5 px-1.5 rounded font-mono">Recurring</span>` : ""}</div></td>
        <td class="py-3.5 px-5"><span class="inline-block whitespace-nowrap py-1 px-2.5 rounded-full text-[10px] font-bold bg-slate-800 ${cat.text} border ${cat.border}">${cat.icon} ${esc(ex.category)}</span></td>
        <td class="py-3.5 px-5 text-slate-400 text-[11px] whitespace-nowrap">${esc(ex.paymentMethod || "—")}</td>
        <td class="py-3.5 px-5 text-slate-400 italic max-w-xs truncate">${esc(ex.note || "—")}</td>
        <td class="py-3.5 px-5 text-right whitespace-nowrap">${amountCellHTML(ex)}</td>
        <td class="py-3.5 px-5 text-center">${actions(ex)}</td>
      </tr>`;
    })
    .join("");

  mobile.innerHTML = rows
    .map((ex) => {
      const cat = categoryInfo(ex.category);
      return `<div class="py-3 flex items-center gap-3">
        <button data-action="edit-expense" data-id="${esc(ex.id)}" class="flex items-center gap-3 flex-1 min-w-0 text-left">
          <div class="w-10 h-10 rounded-xl bg-slate-800 flex items-center justify-center text-lg flex-shrink-0">${cat.icon}</div>
          <div class="min-w-0">
            <p class="text-xs font-bold text-slate-200 truncate">${esc(ex.merchant)}</p>
            <p class="text-[10px] text-slate-400 truncate">${esc(formatDisplayDate(ex.date))} · ${esc(ex.category)}${ex.note ? ` · ${esc(ex.note)}` : ""}</p>
          </div>
        </button>
        <div class="text-right flex-shrink-0">${amountCellHTML(ex, "text-xs")}</div>
        <button data-action="delete-expense" data-id="${esc(ex.id)}" aria-label="Delete ${esc(ex.merchant)}" class="p-2 text-slate-500 hover:text-red-400 rounded-lg"><i data-lucide="trash-2" class="w-4 h-4"></i></button>
      </div>`;
    })
    .join("");
}

function setLedgerPeriod(value) {
  ledgerPeriod = value;
  renderLedgerTable();
  refreshIcons();
}
function setLedgerSort(value) {
  ledgerSort = value;
  renderLedgerTable();
  refreshIcons();
}

function renderFilterButtons() {
  const container = $("expenses-filters");
  const used = new Set(expenses.map((e) => e.category));
  if (activeFilter !== "All" && !used.has(activeFilter)) activeFilter = "All";
  const chip = (label, value) =>
    `<button data-action="filter" data-category="${esc(value)}" class="py-1.5 px-3 rounded-xl text-xs font-bold whitespace-nowrap transition-colors ${activeFilter === value ? "bg-violet-600 text-white shadow-md" : "bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700"}">${label}</button>`;
  container.innerHTML = chip("All", "All") + CATEGORIES.filter((c) => used.has(c.name)).map((c) => chip(`${c.icon} ${esc(c.name)}`, c.name)).join("");
}

function goalPlanNumbers(g) {
  const target = goalTargetBase(g);
  const current = goalCurrentBase(g);
  const gap = Math.max(0, target - current);
  let monthsLeft = null;
  if (g.deadline) {
    const days = daysBetween(new Date(), parseISODate(g.deadline));
    monthsLeft = days / 30.44;
  }
  const perMonth = monthsLeft && monthsLeft > 0 ? gap / Math.max(monthsLeft, 0.25) : null;
  return { target, current, gap, monthsLeft, perMonth, pct: target > 0 ? Math.min(100, (current / target) * 100) : 0 };
}

function renderSavingsGoals() {
  const mini = $("savings-goals-list");
  const large = $("savings-milestones-grid-container");
  if (!goals.length) {
    const empty = `<div class="text-xs text-slate-500 text-center py-6 space-y-3"><p>No savings goals yet.</p><button onclick="openGoalModal()" class="py-2 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold">Create a goal</button></div>`;
    mini.innerHTML = empty;
    large.innerHTML = empty;
    return;
  }
  const sorted = [...goals].sort((a, b) => (a.deadline || "9999") < (b.deadline || "9999") ? -1 : 1);
  mini.innerHTML = sorted
    .map((g) => {
      const p = goalPlanNumbers(g);
      return `<div class="space-y-2 p-3 bg-slate-950/40 rounded-2xl border border-slate-800/60">
        <div class="flex justify-between items-center text-xs gap-2"><span class="font-bold text-slate-300 truncate">${esc(g.name)}</span><span class="font-mono text-slate-500">${p.pct.toFixed(0)}%</span></div>
        <div class="w-full bg-slate-800 h-2 rounded-full overflow-hidden"><div class="bg-gradient-to-r from-emerald-500 to-cyan-500 h-full" style="width:${p.pct}%"></div></div>
        <div class="flex justify-between items-center text-[10px] text-slate-400 font-semibold mt-1 gap-2">
          <span>${esc(formatCurrency(p.current))} / ${esc(formatCurrency(p.target))}</span>
          <div class="flex gap-3">
            <button data-action="goal-plan" data-id="${esc(g.id)}" class="text-violet-400 font-black hover:underline">Plan</button>
            <button data-action="deposit" data-id="${esc(g.id)}" class="text-emerald-400 font-bold hover:underline">Deposit +</button>
          </div>
        </div>
      </div>`;
    })
    .join("");

  large.innerHTML = sorted
    .map((g) => {
      const p = goalPlanNumbers(g);
      let paceText = "";
      if (p.gap <= 0) paceText = `<span class="text-emerald-400">🎉 Goal reached!</span>`;
      else if (p.monthsLeft === null) paceText = "No deadline set";
      else if (p.monthsLeft <= 0) paceText = `<span class="text-red-400">Deadline passed · ${esc(formatCurrency(p.gap))} to go</span>`;
      else paceText = `Save ~${esc(formatCurrency(p.perMonth))}/month to hit ${esc(formatDisplayDate(g.deadline))}`;
      return `<div class="p-4 rounded-2xl bg-slate-900 border border-slate-800 space-y-3">
        <div class="flex justify-between items-center gap-2"><span class="text-xs font-black text-slate-200 truncate">${esc(g.name)}</span><span class="text-xs text-slate-500 font-mono whitespace-nowrap">${esc(formatCurrency(p.current))} / <strong class="text-slate-100">${esc(formatCurrency(p.target))}</strong></span></div>
        <div class="w-full bg-slate-800 h-2.5 rounded-full overflow-hidden"><div class="bg-gradient-to-r from-emerald-500 to-cyan-500 h-full" style="width:${p.pct}%"></div></div>
        <div class="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2 text-[10px] text-slate-400 font-semibold">
          <span>${p.pct.toFixed(0)}% · ${paceText}</span>
          <div class="flex gap-3">
            <button data-action="goal-plan" data-id="${esc(g.id)}" class="text-violet-400 font-extrabold flex items-center gap-1"><i data-lucide="sparkles" class="w-3 h-3"></i> Savings plan</button>
            <button data-action="delete-goal" data-id="${esc(g.id)}" class="text-red-400 hover:underline font-bold">Remove</button>
            <button data-action="deposit" data-id="${esc(g.id)}" class="text-emerald-400 font-bold hover:underline">Deposit +</button>
          </div>
        </div>
      </div>`;
    })
    .join("");
}

function renderSubscriptionsCorner() {
  const container = $("subscription-detector-list");
  const summary = $("subscription-summary");
  const recurring = detectRecurring();
  if (!recurring.length) {
    summary.textContent = "No recurring payments detected yet. Mark an expense as a subscription, or log the same bill in two different months.";
    container.innerHTML = "";
    return;
  }
  const total = sum(recurring, (r) => r.amount);
  summary.innerHTML = `${recurring.length} recurring payment${recurring.length > 1 ? "s" : ""} ≈ <strong class="text-slate-200">${esc(formatCurrency(total))}/month</strong> (${esc(formatCurrency(total * 12))}/year).`;
  container.innerHTML = recurring
    .slice(0, 6)
    .map(
      (sub) => `<div class="p-3 rounded-xl bg-slate-800/50 border border-slate-700/50 flex items-center justify-between gap-2 text-xs hover:bg-slate-800 transition-all">
        <div class="min-w-0">
          <span class="font-bold text-slate-200 block truncate">${esc(sub.merchant)}</span>
          <span class="text-[9px] text-slate-400">${sub.flagged ? "Subscription" : "Detected as recurring"} · last ${esc(formatDisplayDate(sub.lastDate))}</span>
        </div>
        <div class="text-right flex-shrink-0">
          <span class="font-bold text-red-400 block">−${esc(formatCurrency(sub.amount))}</span>
          <button data-action="chat" data-prompt="${esc(`Draft a short, polite email to cancel my ${sub.merchant} subscription (${formatCurrency(sub.amount)}/month) and ask whether any unused period can be refunded.`)}" class="text-[9px] text-violet-400 font-bold hover:underline mt-1 block">Draft cancellation</button>
        </div>
      </div>`
    )
    .join("");
}

function renderCategoryBudgetConfiguration(stats = getStats()) {
  const container = $("monthly-limits-grid-container");
  if (!budgets.length) {
    container.innerHTML = `<div class="text-xs text-slate-500 py-6 text-center">No category budgets yet. Add one to get alerts before you overspend.</div>`;
    return;
  }
  const sorted = [...budgets].sort((a, b) => (stats.byCategory[b.category] || 0) / (budgetLimitBase(b) || 1) - (stats.byCategory[a.category] || 0) / (budgetLimitBase(a) || 1));
  container.innerHTML = sorted
    .map((b) => {
      const cat = categoryInfo(b.category);
      const limit = budgetLimitBase(b);
      const spent = stats.byCategory[b.category] || 0;
      const pct = limit > 0 ? (spent / limit) * 100 : 0;
      const projected = stats.dayOfMonth > 0 ? (spent / stats.dayOfMonth) * stats.daysInMonth : spent;
      const status =
        pct >= 100
          ? `<span class="font-semibold text-red-400">Over by ${esc(formatCurrency(spent - limit))}</span>`
          : projected > limit
            ? `<span class="font-semibold text-amber-400">${esc(formatCurrency(limit - spent))} left · on pace to exceed</span>`
            : `<span class="font-semibold text-emerald-400">${esc(formatCurrency(limit - spent))} left</span>`;
      return `<div class="p-4 rounded-2xl bg-slate-900 border border-slate-800 space-y-2.5 shadow-sm">
        <div class="flex justify-between items-center gap-2">
          <div class="flex items-center gap-2 min-w-0"><span class="text-lg">${cat.icon}</span><span class="text-xs font-bold text-slate-100 truncate">${esc(b.category)}</span></div>
          <span class="text-xs text-slate-300 font-mono whitespace-nowrap">${esc(formatCurrency(spent))} / <strong class="text-white">${esc(formatCurrency(limit))}</strong></span>
        </div>
        <div class="w-full bg-slate-800 h-2.5 rounded-full overflow-hidden"><div class="h-full ${pct >= 100 ? "bg-red-500" : pct >= 80 || projected > limit ? "bg-amber-500" : "bg-emerald-500"}" style="width:${Math.min(100, pct)}%"></div></div>
        <div class="flex justify-between text-[10px] text-slate-400 font-medium gap-2">
          <span>${pct.toFixed(0)}% used this month</span>
          <div class="flex gap-3">${status}
            <button data-action="edit-budget" data-category="${esc(b.category)}" class="text-violet-400 hover:underline font-bold">Edit</button>
            <button data-action="delete-budget" data-id="${esc(b.id)}" class="text-red-400 hover:underline font-bold">Remove</button>
          </div>
        </div>
      </div>`;
    })
    .join("");
}

function renderQuickBudgetCard(stats = getStats()) {
  const budget = stats.monthlyBudget;
  const container = $("quick-budget-progress-container");
  const preview = $("quick-budget-daily-preview");
  if (!(budget > 0)) {
    container.classList.add("hidden");
    preview.classList.add("hidden");
  } else {
    container.classList.remove("hidden");
    preview.classList.remove("hidden");
    const pct = (stats.spentThisMonth / budget) * 100;
    const remaining = budget - stats.spentThisMonth;
    const bar = $("quick-budget-progress-bar");
    bar.style.width = `${Math.min(100, pct)}%`;
    bar.className = `h-full rounded-full transition-all duration-500 ${pct >= 100 ? "bg-red-500" : pct >= 80 ? "bg-amber-500" : "bg-gradient-to-r from-cyan-500 to-blue-500"}`;
    $("quick-budget-progress-text").textContent = `${formatCurrency(stats.spentThisMonth)} / ${formatCurrency(budget)} (${pct.toFixed(0)}%)`;
    $("quick-budget-remaining").textContent = remaining >= 0 ? `${formatCurrency(remaining)} remaining` : `${formatCurrency(-remaining)} over budget`;
    $("quick-budget-remaining").className = remaining >= 0 ? "text-slate-400" : "text-red-400 font-bold";
    $("quick-budget-daily-amount").textContent = formatCurrency(budget / stats.daysInMonth);
    $("quick-budget-daily-remaining").textContent =
      remaining > 0 ? `${formatCurrency(remaining / stats.daysLeft)}/day for ${stats.daysLeft} day${stats.daysLeft === 1 ? "" : "s"}` : "Budget used up";
    const proj = $("quick-budget-projection");
    proj.textContent = stats.spentThisMonth > 0 ? `Projected month-end: ${formatCurrency(stats.projected)}` : "";
    proj.className = `text-[10px] mt-1 ${stats.projected > budget ? "text-amber-400" : "text-slate-500"}`;
  }
  const input = $("quick-monthly-budget-input");
  if (getMonthlyIncome() > 0) input.placeholder = `e.g. ${round2(getMonthlyIncome() * 0.7)} (70% of income)`;
}

// =============================================================================
// NOTIFICATIONS (derived from data each render; dismissals persist per period)
// =============================================================================
function generateNotifications(stats = getStats()) {
  const list = [];
  const mk = stats.monthKey;
  const budget = stats.monthlyBudget;

  if (budget > 0 && stats.spentThisMonth > 0) {
    const pct = (stats.spentThisMonth / budget) * 100;
    if (pct >= 100) {
      list.push({ id: `budget-over-${mk}`, type: "danger", message: `🚨 **Monthly budget exceeded.** You've spent **${formatCurrency(stats.spentThisMonth)}** (${Math.round(pct)}% of ${formatCurrency(budget)}).`, actionText: "Review spending", action: { tab: "expenses" } });
    } else if (pct >= 80) {
      list.push({ id: `budget-80-${mk}`, type: "warning", message: `⚠️ **${Math.round(pct)}% of your monthly budget used.** ${formatCurrency(budget - stats.spentThisMonth)} left for ${stats.daysLeft} days.`, actionText: "View budget", action: { tab: "budgets" } });
    } else if (stats.projected > budget * 1.1 && stats.dayOfMonth >= 7) {
      list.push({ id: `budget-pace-${mk}`, type: "warning", message: `📈 **Spending pace alert.** You're on track to spend **${formatCurrency(stats.projected)}** this month vs a ${formatCurrency(budget)} budget.`, actionText: "Ask coach", action: { chat: `I'm on pace to spend ${formatCurrency(stats.projected)} against a ${formatCurrency(budget)} budget. How do I get back on track?` } });
    }
  }

  budgets.forEach((b) => {
    const spent = stats.byCategory[b.category] || 0;
    const limit = budgetLimitBase(b);
    if (limit > 0 && spent > limit) {
      list.push({ id: `cat-over-${b.category}-${mk}`, type: "danger", message: `${categoryInfo(b.category).icon} **${b.category} over budget:** ${formatCurrency(spent)} of ${formatCurrency(limit)} (${Math.round((spent / limit) * 100)}%).`, actionText: "View transactions", action: { tab: "expenses", filter: b.category } });
    }
  });

  goals.forEach((g) => {
    const p = goalPlanNumbers(g);
    if (p.pct >= 80 && p.pct < 100) {
      list.push({ id: `goal-80-${g.id}`, type: "success", message: `🎯 **Almost there!** "${g.name}" is ${Math.round(p.pct)}% funded — ${formatCurrency(p.gap)} to go.`, actionText: "Add deposit", action: { deposit: g.id } });
    }
    if (p.gap > 0 && p.monthsLeft !== null && p.monthsLeft > 0 && p.monthsLeft < 1) {
      list.push({ id: `goal-deadline-${g.id}`, type: "warning", message: `⏳ **"${g.name}" is due ${formatDisplayDate(g.deadline)}** and still needs ${formatCurrency(p.gap)}.`, actionText: "Get a plan", action: { plan: g.id } });
    }
  });

  if (stats.spentToday > 0 && stats.dayOfMonth > 3) {
    const avg = (stats.spentThisMonth - stats.spentToday) / Math.max(1, stats.dayOfMonth - 1);
    if (avg > 0 && stats.spentToday > avg * 2.5 && stats.spentToday - avg > convert(15, "USD")) {
      list.push({ id: `high-day-${todayISO()}`, type: "warning", message: `💸 **Big spending day:** ${formatCurrency(stats.spentToday)} today vs your ${formatCurrency(avg)} daily average.`, actionText: "Review today", action: { tab: "expenses" } });
    }
  }

  const today = new Date();
  expenses.forEach((ex) => {
    if (!ex.returnDeadline || !isValidISODate(ex.returnDeadline)) return;
    const days = daysBetween(today, parseISODate(ex.returnDeadline));
    if (days >= 0 && days <= 7) {
      list.push({ id: `ret-${ex.id}`, type: "warning", message: `🛡️ **Return window closing:** ${days === 0 ? "today is the last day" : `${days} day${days === 1 ? "" : "s"} left`} to return your ${formatCurrency(amountBase(ex))} purchase at **${ex.merchant}**.`, actionText: "Draft return email", action: { chat: `Draft a short customer-service email to ${ex.merchant} asking to return my ${formatCurrency(amountBase(ex))} purchase from ${ex.date}.` } });
    }
  });

  detectRecurring().forEach((r) => {
    const since = daysBetween(parseISODate(r.lastDate), today);
    if (since >= 25 && since <= 31) {
      list.push({ id: `renew-${r.merchant}-${r.lastDate}`, type: "info", message: `📅 **${r.merchant}** (${formatCurrency(r.amount)}) usually renews around now.`, actionText: "Review subscriptions", action: { tab: "dashboard" } });
    }
  });

  const dismissed = new Set(LS.getJSON("spendsense_dismissed_notifs", []));
  notifications = list.filter((n) => !dismissed.has(n.id));
}

function renderNotificationCenterList() {
  const list = $("notification-center-alerts-list");
  const countBadge = $("notification-count");
  if (!notifications.length) {
    list.innerHTML = `<div class="text-xs text-slate-500 py-12 text-center">You're all caught up. Alerts about budgets, goals and unusual spending show up here.</div>`;
    countBadge.classList.add("hidden");
    return;
  }
  countBadge.textContent = notifications.length > 9 ? "9+" : String(notifications.length);
  countBadge.classList.remove("hidden");
  const tone = { danger: "border-red-500/30", warning: "border-amber-500/30", success: "border-emerald-500/30", info: "border-cyan-500/30" };
  list.innerHTML = notifications
    .map(
      (n) => `<div class="p-3 rounded-2xl bg-slate-800 border ${tone[n.type] || "border-slate-700"} space-y-2">
        <div class="text-xs text-slate-200 leading-relaxed md-inline">${renderInlineMarkdown(n.message)}</div>
        <div class="flex justify-end gap-3 pt-1.5 border-t border-slate-700">
          <button data-action="dismiss-notif" data-id="${esc(n.id)}" class="text-[10px] text-slate-400 hover:text-slate-200 font-bold">Dismiss</button>
          <button data-action="notif-action" data-id="${esc(n.id)}" class="text-[10px] text-violet-400 hover:text-violet-300 font-black flex items-center gap-0.5">${esc(n.actionText)} <i data-lucide="chevron-right" class="w-3 h-3"></i></button>
        </div>
      </div>`
    )
    .join("");
  refreshIcons();
}

function runNotificationAction(id) {
  const n = notifications.find((x) => x.id === id);
  if (!n) return;
  closeNotificationCenter();
  const a = n.action || {};
  if (a.filter) activeFilter = a.filter;
  if (a.tab) switchTab(a.tab);
  if (a.chat) triggerAIChatMessage(a.chat);
  if (a.deposit) openDepositModal(a.deposit);
  if (a.plan) triggerAISavingsGoalStrategy(a.plan);
}

function dismissNotification(id) {
  const dismissed = LS.getJSON("spendsense_dismissed_notifs", []);
  dismissed.push(id);
  LS.set("spendsense_dismissed_notifs", dismissed.slice(-300));
  notifications = notifications.filter((n) => n.id !== id);
  renderNotificationCenterList();
}

function clearAllNotifications() {
  const dismissed = LS.getJSON("spendsense_dismissed_notifs", []);
  notifications.forEach((n) => dismissed.push(n.id));
  LS.set("spendsense_dismissed_notifs", dismissed.slice(-300));
  notifications = [];
  renderNotificationCenterList();
  showToast("All alerts cleared.", "info");
}

function openNotificationCenter() {
  renderNotificationCenterList();
  openModal("modal-notification-center");
}
function closeNotificationCenter() {
  closeModal("modal-notification-center");
}

// =============================================================================
// EXPENSES: CRUD
// =============================================================================
function fillCategorySelect(selectId, { includeIncome = true } = {}) {
  const sel = $(selectId);
  if (!sel || sel.options.length) return;
  CATEGORIES.filter((c) => includeIncome || c.name !== INCOME).forEach((c) => {
    const opt = document.createElement("option");
    opt.value = c.name;
    opt.textContent = `${c.icon} ${c.name === INCOME ? "Income / Salary" : c.name}`;
    sel.appendChild(opt);
  });
}

let categoryTouched = false;
function setupExpenseFormHelpers() {
  fillCategorySelect("form-expense-category");
  fillCategorySelect("form-budget-category", { includeIncome: false });
  fillCategorySelect("scanned-category");
  const pay = $("form-expense-payment");
  if (pay && !pay.options.length) PAYMENT_METHODS.forEach((m) => pay.appendChild(new Option(m, m)));

  $("form-expense-category").addEventListener("change", () => {
    categoryTouched = true;
    $("form-expense-category-hint").textContent = "";
  });
  $("form-expense-merchant").addEventListener("input", debounce(suggestCategoryFromMerchant, 200));
}

function suggestCategoryFromMerchant() {
  const merchant = $("form-expense-merchant").value.trim();
  const hint = $("form-expense-category-hint");
  if (!merchant || !window.SSNLU) return (hint.textContent = "");
  const guess = SSNLU.classifyMerchant(`${merchant} ${$("form-expense-note").value}`, buildMerchantMemory());
  if (!guess) return (hint.textContent = "");
  if (!categoryTouched) {
    $("form-expense-category").value = guess.category;
    hint.textContent = guess.source === "history" ? "✓ Based on your past entries" : "✓ Auto-detected";
    if (guess.category === "Subscriptions") $("form-expense-subscription").checked = true;
  }
}

function openExpenseModal(prefill = {}) {
  $("expense-modal-title").textContent = prefill.id ? "Edit transaction" : "Log transaction";
  $("expense-submit-text").textContent = prefill.id ? "Save changes" : "Save transaction";
  $("form-expense-id").value = prefill.id || "";
  $("form-expense-amount").value = prefill.amount ?? "";
  $("form-expense-currency").value = prefill.currency || currentGlobalCurrency;
  $("form-expense-merchant").value = prefill.merchant || "";
  $("form-expense-category").value = prefill.category || "Miscellaneous";
  $("form-expense-date").value = prefill.date || todayISO();
  $("form-expense-date").max = toISODate(addDays(new Date(), 366));
  $("form-expense-note").value = prefill.note || "";
  $("form-expense-payment").value = prefill.paymentMethod || LS.get("spendsense_last_payment") || "Credit Card";
  $("form-expense-subscription").checked = Boolean(prefill.isSubscription);
  $("form-expense-category-hint").textContent = "";
  $("expense-delete-btn").classList.toggle("hidden", !prefill.id);
  categoryTouched = Boolean(prefill.id || prefill.category);
  openModal("modal-expense");
  setTimeout(() => (prefill.amount ? $("form-expense-merchant") : $("form-expense-amount")).focus(), 60);
}

function closeExpenseModal() {
  closeModal("modal-expense");
}

function editExpenseRecord(id) {
  const record = expenses.find((ex) => ex.id === id);
  if (record) openExpenseModal(record);
}

// Creates or updates an expense. Returns the id.
function persistExpense(payload, id = null) {
  const data = normalizeExpense(payload);
  delete data.id;
  if (isCloud()) {
    const col = userDoc().collection("expenses");
    if (id) {
      cloudWrite(col.doc(id).set(data, { merge: true }), "the transaction").catch(() => {});
      return id;
    }
    const ref = col.doc();
    data.createdAt = Date.now();
    cloudWrite(ref.set(data), "the transaction").catch(() => {});
    return ref.id;
  }
  if (id) {
    expenses = sortExpenses(expenses.map((ex) => (ex.id === id ? { ...ex, ...data, id } : ex)));
  } else {
    id = newLocalId();
    data.createdAt = Date.now();
    expenses = sortExpenses([{ ...data, id }, ...expenses]);
  }
  saveLocalSession();
  scheduleRender();
  return id;
}

function removeExpense(id) {
  if (isCloud()) return cloudWrite(userDoc().collection("expenses").doc(id).delete(), "the deletion");
  expenses = expenses.filter((ex) => ex.id !== id);
  saveLocalSession();
  scheduleRender();
  return Promise.resolve();
}

function handleExpenseFormSubmit(e) {
  e.preventDefault();
  const id = $("form-expense-id").value || null;
  const amount = parseFloat($("form-expense-amount").value);
  const merchant = $("form-expense-merchant").value.trim();
  const date = $("form-expense-date").value;
  if (!(amount > 0)) {
    showToast("Enter an amount greater than zero.", "error");
    return $("form-expense-amount").focus();
  }
  if (!merchant) {
    showToast("Add a merchant or description.", "error");
    return $("form-expense-merchant").focus();
  }
  if (!isValidISODate(date)) {
    showToast("Pick a valid date.", "error");
    return $("form-expense-date").focus();
  }
  const existing = id ? expenses.find((x) => x.id === id) : null;
  const payload = {
    ...(existing || {}),
    amount: round2(amount),
    currency: $("form-expense-currency").value,
    merchant,
    category: $("form-expense-category").value,
    date,
    note: $("form-expense-note").value.trim(),
    paymentMethod: $("form-expense-payment").value,
    isSubscription: $("form-expense-subscription").checked,
  };
  LS.set("spendsense_last_payment", payload.paymentMethod);
  const newId = persistExpense(payload, id);
  if (!id) lastAddedExpenseId = newId;
  closeExpenseModal();
  showToast(id ? "Transaction updated." : `${payload.category === INCOME ? "Income" : "Expense"} of ${formatMoney(payload.amount, payload.currency)} saved.`, "success");
  checkBudgetAfterSave(payload);
}

// Immediate feedback when a new expense pushes a budget over a threshold.
function checkBudgetAfterSave(ex) {
  if (isIncome(ex) || !ex.date.startsWith(monthKeyOf(new Date()))) return;
  setTimeout(() => {
    const stats = getStats();
    const b = budgets.find((x) => x.category === ex.category);
    if (b) {
      const limit = budgetLimitBase(b);
      const spent = stats.byCategory[ex.category] || 0;
      const before = spent - amountBase(ex);
      if (limit > 0 && spent > limit && before <= limit) return showToast(`${ex.category} is now over budget (${formatCurrency(spent)} of ${formatCurrency(limit)}).`, "error");
      if (limit > 0 && spent >= limit * 0.8 && before < limit * 0.8) return showToast(`Heads up: ${ex.category} has reached ${Math.round((spent / limit) * 100)}% of its budget.`, "info");
    }
    const mb = stats.monthlyBudget;
    if (mb > 0) {
      const before = stats.spentThisMonth - amountBase(ex);
      if (stats.spentThisMonth > mb && before <= mb) showToast(`You've gone over your monthly budget of ${formatCurrency(mb)}.`, "error");
    }
  }, 300);
}

async function deleteExpenseRecord(id) {
  const record = expenses.find((ex) => ex.id === id);
  if (!record) return;
  const ok = await showConfirmationModal("Delete transaction?", `${record.merchant} · ${formatMoney(record.amount, record.currency)} on ${record.date}. This can't be undone.`, {
    icon: "trash-2", color: "red", confirmText: "Delete",
  });
  if (!ok) return;
  closeExpenseModal();
  removeExpense(id)
    .then(() => showToast("Transaction deleted.", "info"))
    .catch(() => {});
}

function deleteExpenseFromModal() {
  const id = $("form-expense-id").value;
  if (id) deleteExpenseRecord(id);
}

async function triggerAISmartClassification() {
  const merchant = $("form-expense-merchant").value.trim();
  if (!merchant) {
    showToast("Enter a merchant or description first.", "error");
    return $("form-expense-merchant").focus();
  }
  const local = window.SSNLU ? SSNLU.classifyMerchant(`${merchant} ${$("form-expense-note").value}`, buildMerchantMemory()) : null;
  if (local) {
    $("form-expense-category").value = local.category;
    categoryTouched = true;
    $("form-expense-category-hint").textContent = local.source === "history" ? "✓ Based on your past entries" : "✓ Auto-detected";
    if (local.category === "Subscriptions") $("form-expense-subscription").checked = true;
    return showToast(`Categorised as ${local.category}.`, "success");
  }

  const btn = $("ai-classify-btn");
  btn.disabled = true;
  $("form-expense-category-hint").textContent = "Asking AI…";
  try {
    const reply = await callAI({
      messages: [
        { role: "system", content: "You categorise personal expenses. Reply with JSON only." },
        {
          role: "user",
          content: `Merchant/description: "${merchant}". Note: "${$("form-expense-note").value}".
Choose the single best category from: ${CATEGORY_NAMES.join(", ")}.
Also decide whether it is most likely a recurring subscription.
Reply exactly as {"category":"...","isSubscription":false,"note":"short helpful memo, max 8 words"}`,
        },
      ],
      maxTokens: 120,
      temperature: 0.2,
    });
    const parsed = parseJSONFromAI(reply);
    const category = CATEGORY_NAMES.includes(parsed.category) ? parsed.category : "Miscellaneous";
    $("form-expense-category").value = category;
    categoryTouched = true;
    if (parsed.isSubscription === true) $("form-expense-subscription").checked = true;
    if (!$("form-expense-note").value.trim() && parsed.note) $("form-expense-note").value = String(parsed.note).slice(0, 80);
    $("form-expense-category-hint").textContent = "✓ Suggested by AI";
    showToast(`AI suggests ${category}.`, "success");
  } catch (err) {
    $("form-expense-category-hint").textContent = "";
    handleAIErrorToast(err, "AI categorisation");
  } finally {
    btn.disabled = false;
  }
}

// =============================================================================
// BUDGETS & GOALS: CRUD
// =============================================================================
function openBudgetModal(category) {
  const existing = category ? budgets.find((b) => b.category === category) : null;
  $("form-budget-category").value = category || $("form-budget-category").value || "Food & Dining";
  $("form-budget-limit").value = existing ? round2(budgetLimitBase(existing)) : "";
  updateBudgetModalHint();
  openModal("modal-budget");
  setTimeout(() => $("form-budget-limit").focus(), 60);
}
function closeBudgetModal() {
  closeModal("modal-budget");
}

function updateBudgetModalHint() {
  const cat = $("form-budget-category").value;
  const hint = $("form-budget-hint");
  const existing = budgets.find((b) => b.category === cat);
  const months = [1, 2, 3].map((i) => {
    const d = new Date();
    return monthKeyOf(new Date(d.getFullYear(), d.getMonth() - i, 1));
  });
  const avg = sum(months, (mk) => sum(expenses.filter((e) => e.category === cat && e.date.startsWith(mk)), amountBase)) / 3;
  const parts = [];
  if (existing) parts.push(`Current limit: ${formatCurrency(budgetLimitBase(existing))}. Saving will update it.`);
  if (avg > 0) parts.push(`You've averaged ${formatCurrency(avg)}/month on ${cat} over the last 3 months.`);
  hint.textContent = parts.join(" ");
  $("form-budget-limit").placeholder = avg > 0 ? `e.g. ${Math.round(avg * 0.9)}` : "e.g. 450";
}

function upsertBudget(category, limit) {
  const existing = budgets.find((b) => b.category === category);
  const payload = { category, limit: round2(limit), currency: currentGlobalCurrency };
  if (isCloud()) {
    const col = userDoc().collection("budgets");
    const ref = existing ? col.doc(existing.id) : col.doc();
    cloudWrite(ref.set(payload), "the budget").catch(() => {});
  } else {
    if (existing) budgets = budgets.map((b) => (b.id === existing.id ? { ...b, ...payload } : b));
    else budgets.push({ id: newLocalId(), ...payload });
    saveLocalSession();
    scheduleRender();
  }
  return Boolean(existing);
}

function handleBudgetFormSubmit(e) {
  e.preventDefault();
  const category = $("form-budget-category").value;
  const limit = parseFloat($("form-budget-limit").value);
  if (!(limit > 0)) return showToast("Enter a monthly limit greater than zero.", "error");
  const updated = upsertBudget(category, limit);
  showToast(`${category} budget ${updated ? "updated" : "set"} to ${formatCurrency(limit)}/month.`, "success");
  closeBudgetModal();
}

async function deleteBudgetRecord(id) {
  const b = budgets.find((x) => x.id === id);
  if (!b) return;
  const ok = await showConfirmationModal("Remove budget?", `Stop tracking the ${b.category} limit of ${formatCurrency(budgetLimitBase(b))}/month?`, { icon: "trash-2", color: "red", confirmText: "Remove" });
  if (!ok) return;
  if (isCloud()) cloudWrite(userDoc().collection("budgets").doc(id).delete(), "the budget").catch(() => {});
  else {
    budgets = budgets.filter((x) => x.id !== id);
    saveLocalSession();
    scheduleRender();
  }
  showToast("Budget removed.", "info");
}

function openGoalModal() {
  $("form-goal-name").value = "";
  $("form-goal-target").value = "";
  $("form-goal-current").value = "";
  const d = new Date();
  $("form-goal-deadline").value = toISODate(new Date(d.getFullYear(), d.getMonth() + 6, d.getDate()));
  $("form-goal-deadline").min = toISODate(addDays(d, 1));
  openModal("modal-goal");
  setTimeout(() => $("form-goal-name").focus(), 60);
}
function closeGoalModal() {
  closeModal("modal-goal");
}

function handleGoalFormSubmit(e) {
  e.preventDefault();
  const name = $("form-goal-name").value.trim();
  const targetAmount = parseFloat($("form-goal-target").value);
  const currentAmount = parseFloat($("form-goal-current").value) || 0;
  const deadline = $("form-goal-deadline").value;
  if (!name) return showToast("Give your goal a name.", "error");
  if (!(targetAmount > 0)) return showToast("Enter a target amount greater than zero.", "error");
  if (currentAmount < 0) return showToast("Starting balance can't be negative.", "error");
  const payload = { name, targetAmount: round2(targetAmount), currentAmount: round2(currentAmount), deadline, currency: currentGlobalCurrency, createdAt: Date.now() };
  if (isCloud()) cloudWrite(userDoc().collection("goals").doc().set(payload), "the goal").catch(() => {});
  else {
    goals.push({ id: newLocalId(), ...payload });
    saveLocalSession();
    scheduleRender();
  }
  closeGoalModal();
  const p = goalPlanNumbers(payload);
  showToast(p.perMonth ? `Goal created — save about ${formatCurrency(p.perMonth)}/month to make it.` : `Goal "${name}" created.`, "success");
}

async function deleteGoalRecord(id) {
  const g = goals.find((x) => x.id === id);
  if (!g) return;
  const ok = await showConfirmationModal("Remove goal?", `Delete "${g.name}" and its ${formatCurrency(goalCurrentBase(g))} progress record? (This doesn't move any real money.)`, { icon: "trash-2", color: "red", confirmText: "Remove" });
  if (!ok) return;
  if (isCloud()) cloudWrite(userDoc().collection("goals").doc(id).delete(), "the goal").catch(() => {});
  else {
    goals = goals.filter((x) => x.id !== id);
    saveLocalSession();
    scheduleRender();
  }
  showToast("Goal removed.", "info");
}

function openDepositModal(id) {
  const g = goals.find((x) => x.id === id);
  if (!g) return;
  $("form-deposit-goal-id").value = g.id;
  $("deposit-milestone-title").textContent = g.name;
  $("form-deposit-amount").value = "";
  const p = goalPlanNumbers(g);
  $("deposit-hint").textContent = p.gap > 0 ? `${formatCurrency(p.gap)} to go${p.perMonth ? ` · suggested ${formatCurrency(p.perMonth)}/month` : ""}` : "This goal is fully funded 🎉";
  openModal("modal-deposit");
  setTimeout(() => $("form-deposit-amount").focus(), 60);
}
function closeDepositModal() {
  closeModal("modal-deposit");
}

function depositToGoal(id, amountInBase) {
  const g = goals.find((x) => x.id === id);
  if (!g) return false;
  const inGoalCurrency = round2(convert(amountInBase, currentGlobalCurrency, g.currency));
  const before = goalPlanNumbers(g);
  if (isCloud()) {
    cloudWrite(userDoc().collection("goals").doc(id).update({ currentAmount: firebase.firestore.FieldValue.increment(inGoalCurrency) }), "the deposit").catch(() => {});
  } else {
    goals = goals.map((x) => (x.id === id ? { ...x, currentAmount: round2(x.currentAmount + inGoalCurrency) } : x));
    saveLocalSession();
    scheduleRender();
  }
  const reached = before.gap > 0 && amountInBase >= before.gap;
  showToast(reached ? `🎉 "${g.name}" is fully funded!` : `Added ${formatCurrency(amountInBase)} to "${g.name}".`, "success");
  return true;
}

function handleDepositFormSubmit(e) {
  e.preventDefault();
  const amount = parseFloat($("form-deposit-amount").value);
  if (!(amount > 0)) return showToast("Enter an amount greater than zero.", "error");
  depositToGoal($("form-deposit-goal-id").value, round2(amount));
  closeDepositModal();
}

// =============================================================================
// AI SERVICES
// =============================================================================
class AIError extends Error {
  constructor(kind, message, status) {
    super(message);
    this.kind = kind;
    this.status = status;
  }
}

const isLocalDev = () => ["localhost", "127.0.0.1"].includes(location.hostname) && Boolean(LS.get("dev_api_key"));

function localDateHeader() {
  return todayISO();
}

async function callAI({ messages, maxTokens = 900, temperature = 0.5, timeoutMs = 45000 }) {
  if (!navigator.onLine) throw new AIError("offline", "You're offline. Connect to the internet to use AI features.");
  let url = AI_PROXY_URL;
  let headers = { "Content-Type": "application/json" };
  let body = { messages, max_tokens: maxTokens, temperature };

  if (isLocalDev()) {
    url = "https://openrouter.ai/api/v1/chat/completions";
    headers = { "Content-Type": "application/json", Authorization: `Bearer ${LS.get("dev_api_key")}`, "HTTP-Referer": location.href, "X-Title": "SpendSense AI (Local)" };
    body = { ...body, model: DEV_MODEL_NAME };
  } else {
    if (!auth || !auth.currentUser) throw new AIError("auth", "Please sign in to use AI features. It's free.");
    headers["X-Firebase-Token"] = await auth.currentUser.getIdToken();
    headers["X-Local-Date"] = localDateHeader();
  }

  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body), signal: controller.signal });
      const remaining = res.headers.get("X-AI-Remaining");
      if (remaining !== null) {
        aiUsage.remaining = parseInt(remaining, 10);
        aiUsage.limit = parseInt(res.headers.get("X-AI-Limit") || aiUsage.limit, 10);
        renderAIUsage();
      }
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        const content = data.choices?.[0]?.message?.content;
        if (typeof content === "string" && content.trim()) return content.trim();
        throw new AIError("server", "The AI returned an empty response. Please try again.", res.status);
      }
      const message = typeof data.error === "string" ? data.error : data.error?.message || `AI service error (${res.status})`;
      if (res.status === 401) throw new AIError("auth", message, 401);
      if (res.status === 429) throw new AIError("limit", message, 429);
      if (res.status === 413) throw new AIError("too-large", message, 413);
      if (res.status >= 400 && res.status < 500) throw new AIError("request", message, res.status);
      lastError = new AIError("server", res.status === 504 ? "The AI took too long to respond. Please try again." : message, res.status);
    } catch (err) {
      if (err instanceof AIError && err.kind !== "server") throw err;
      lastError = err instanceof AIError ? err : new AIError(err.name === "AbortError" ? "timeout" : "network", err.name === "AbortError" ? "The AI took too long to respond. Please try again." : "Couldn't reach the AI service. Check your connection.");
    } finally {
      clearTimeout(timer);
    }
    if (attempt === 0) await new Promise((r) => setTimeout(r, 900));
  }
  throw lastError;
}

function parseJSONFromAI(text) {
  const cleaned = String(text).replace(/```(?:json)?/gi, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start !== -1 && end > start) return JSON.parse(cleaned.slice(start, end + 1));
    throw new AIError("parse", "The AI response couldn't be read. Please try again.");
  }
}

async function refreshAIUsage() {
  if (!auth || !auth.currentUser || isLocalDev()) return;
  try {
    const token = await auth.currentUser.getIdToken();
    const res = await fetch(AI_PROXY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Firebase-Token": token, "X-Local-Date": localDateHeader() },
      body: JSON.stringify({ action: "usage" }),
    });
    if (!res.ok) return;
    const data = await res.json();
    if (typeof data.remaining === "number") {
      aiUsage.remaining = data.remaining;
      aiUsage.limit = data.limit || aiUsage.limit;
      renderAIUsage();
    }
  } catch {}
}

function renderAIUsage() {
  const chatLabel = $("ai-usage-chat");
  const status = $("ai-status-text");
  const badge = $("ai-status-badge");
  let text;
  if (isLocalDev()) text = "Developer mode (direct OpenRouter key)";
  else if (!currentUser) text = "Sign in to unlock AI (free, 10 requests/day)";
  else if (aiUsage.remaining === null) text = `AI ready · ${aiUsage.limit} requests/day`;
  else text = `${aiUsage.remaining} of ${aiUsage.limit} AI requests left today`;
  if (chatLabel) chatLabel.textContent = text;
  if (status) status.textContent = text;
  if (badge) {
    const ready = Boolean(currentUser) || isLocalDev();
    const out = ready && aiUsage.remaining === 0;
    badge.className = `py-1.5 px-3 rounded-lg text-[10px] font-bold border flex items-center gap-1 whitespace-nowrap ${out ? "bg-red-600/20 text-red-300 border-red-500/30" : ready ? "bg-emerald-600/20 text-emerald-400 border-emerald-500/20" : "bg-slate-700/40 text-slate-300 border-slate-600"}`;
    badge.innerHTML = `<span class="w-1.5 h-1.5 rounded-full ${out ? "bg-red-400" : ready ? "bg-emerald-400" : "bg-slate-400"}"></span>${out ? "Limit reached" : ready ? "Active" : "Locked"}`;
  }
}

function aiErrorHTML(err, feature) {
  if (err.kind === "auth") {
    return `<div class="text-center py-4"><div class="text-2xl mb-2">🔒</div><p class="text-violet-300 font-bold text-sm mb-1">Sign in to use ${esc(feature)}</p><p class="text-slate-400 text-xs">A free account unlocks AI features and syncs your data across devices.</p><button data-action="show-auth" class="mt-3 px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-bold">Sign in free</button></div>`;
  }
  if (err.kind === "limit") {
    return `<div class="text-center py-4"><div class="text-2xl mb-2">🛑</div><p class="text-red-400 font-bold text-sm mb-1">Daily AI limit reached</p><p class="text-slate-400 text-xs">${esc(err.message)}</p></div>`;
  }
  return `<div class="text-center py-4"><div class="text-2xl mb-2">⚠️</div><p class="text-red-400 font-bold text-sm mb-1">${esc(feature)} is unavailable</p><p class="text-slate-400 text-xs">${esc(err.message || "Please try again.")}</p></div>`;
}

function handleAIErrorToast(err, feature) {
  if (err.kind === "auth") {
    showToast(`Sign in to use ${feature} — it's free.`, "info");
    setTimeout(showAuthModal, 700);
  } else showToast(err.message || `${feature} failed.`, "error");
}

// --- Markdown rendering (marked + DOMPurify; safe fallback if the CDN is unavailable) ---
function renderMarkdown(text) {
  const src = String(text || "");
  if (window.marked && window.DOMPurify) {
    try {
      const html = marked.parse(src, { breaks: true, gfm: true });
      return DOMPurify.sanitize(html, { ADD_ATTR: ["target"], FORBID_TAGS: ["style", "img", "iframe", "form", "input"] });
    } catch {}
  }
  return esc(src)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/^#{1,4} (.+)$/gm, "<h4>$1</h4>")
    .replace(/^\s*[-*•] (.+)$/gm, "• $1")
    .replace(/\n/g, "<br>");
}
const renderInlineMarkdown = (text) => esc(text).replace(/\*\*(.+?)\*\*/g, '<strong class="text-white">$1</strong>');

// Kept for compatibility with any older callers
const formatMessageText = renderMarkdown;

// --- Financial context for the AI (pre-computed so the model doesn't have to do the arithmetic) ---
function buildFinanceContext({ maxTransactions = 40 } = {}) {
  const s = getStats();
  const f = formatCurrency;
  const now = new Date();
  const lines = [];
  lines.push(`Today: ${todayISO()} (${now.toLocaleDateString("en-US", { weekday: "long" })}). Day ${s.dayOfMonth} of ${s.daysInMonth}; ${s.daysLeft} day(s) left this month.`);
  lines.push(`Base currency: ${currentGlobalCurrency}. ALL amounts below are already converted to ${currentGlobalCurrency}.`);
  lines.push(`Transactions on record: ${expenses.length}${expenses.length ? ` (from ${expenses[expenses.length - 1].date} to ${expenses[0].date})` : ""}.`);
  lines.push(`Monthly income: ${getMonthlyIncome() > 0 ? f(getMonthlyIncome()) + " (user setting)" : "not set"}; income logged this month: ${f(s.incomeThisMonth)}.`);
  lines.push(`Overall monthly budget: ${s.monthlyBudget > 0 ? f(s.monthlyBudget) : "not set"}. Weekly target: ${effectiveWeeklyTarget() > 0 ? f(effectiveWeeklyTarget()) : "not set"}.`);
  lines.push(`Spent this month: ${f(s.spentThisMonth)}; projected month-end at current pace: ${f(s.projected)}; same point last month: ${f(s.lastMonthSamePoint)}; all of last month: ${f(s.lastMonthTotal)}.`);
  lines.push(`Spent in the last 7 days: ${f(s.spentLast7)}; today: ${f(s.spentToday)}.`);
  if (s.savingsRate !== null) lines.push(`Savings this month so far: ${f(s.savings)} (${s.savingsRate.toFixed(0)}% of income).`);

  const cats = new Set([...Object.keys(s.byCategory), ...Object.keys(s.lastByCategory)]);
  if (cats.size) {
    lines.push("Spending by category (this month | last month):");
    [...cats]
      .sort((a, b) => (s.byCategory[b] || 0) - (s.byCategory[a] || 0))
      .forEach((c) => lines.push(`- ${c}: ${f(s.byCategory[c] || 0)} | ${f(s.lastByCategory[c] || 0)}`));
  }
  if (budgets.length) {
    lines.push("Category budgets (spent this month / limit):");
    budgets.forEach((b) => lines.push(`- ${b.category}: ${f(s.byCategory[b.category] || 0)} / ${f(budgetLimitBase(b))}`));
  }
  if (goals.length) {
    lines.push("Savings goals:");
    goals.forEach((g) => {
      const p = goalPlanNumbers(g);
      lines.push(`- ${g.name}: ${f(p.current)} of ${f(p.target)}${g.deadline ? `, deadline ${g.deadline}` : ""}${p.perMonth ? `, needs ~${f(p.perMonth)}/month` : ""}`);
    });
  }
  const recurring = detectRecurring();
  if (recurring.length) lines.push(`Recurring payments: ${recurring.map((r) => `${r.merchant} ${f(r.amount)}`).join("; ")} (≈${f(sum(recurring, (r) => r.amount))}/month).`);

  const since90 = toISODate(addDays(now, -90));
  const merchants = {};
  expenses.filter((e) => !isIncome(e) && e.date >= since90).forEach((e) => (merchants[e.merchant] = (merchants[e.merchant] || 0) + amountBase(e)));
  const top = Object.entries(merchants).sort((a, b) => b[1] - a[1]).slice(0, 8);
  if (top.length) lines.push(`Top merchants (90 days): ${top.map(([m, v]) => `${m} ${f(v)}`).join("; ")}.`);

  if (expenses.length) {
    lines.push(`Most recent ${Math.min(maxTransactions, expenses.length)} transactions (date | merchant | category | amount${expenses.some((e) => e.currency !== currentGlobalCurrency) ? " [original]" : ""} | note):`);
    expenses.slice(0, maxTransactions).forEach((e) => {
      const orig = e.currency !== currentGlobalCurrency ? ` [${formatMoney(e.amount, e.currency)}]` : "";
      lines.push(`- ${e.date} | ${e.merchant} | ${e.category} | ${isIncome(e) ? "+" : "-"}${f(amountBase(e))}${orig} | ${e.note || ""}`);
    });
  }
  return lines.join("\n");
}

const COACH_SYSTEM_PROMPT = `You are SpendSense AI, a sharp, friendly personal-finance coach inside an expense-tracking app.
Style: warm, direct and practical — like a smart friend who is good with money. Light wit is welcome; never preachy.
Rules:
- Ground every claim in the user's data below. Quote real numbers, merchants and dates. Never invent transactions.
- The figures are pre-computed and already in the user's base currency — reuse them instead of recalculating; if you must calculate, be exact.
- If the data can't answer the question, say what's missing and how to add it in the app.
- Prefer short answers: a 1-2 sentence summary first, then at most ~6 bullets or a small table. Use **bold** for key numbers.
- Give specific, actionable steps (amounts, categories, dates), not generic advice.
- You can draft emails or messages when asked.
- You are not a licensed financial adviser; for investments, taxes or debt restructuring give general education and suggest a professional for decisions.`;

// --- Chat ---
function chatHistoryForAI(limit = 12) {
  return chatMessages
    .filter((m) => m && m.text && (m.role === "user" || m.role === "model"))
    .slice(-limit)
    .map((m) => ({ role: m.role === "user" ? "user" : "assistant", content: String(m.text).slice(0, 4000) }));
}

function renderChatMessages() {
  const container = $("chat-messages-container");
  if (!container) return;
  const all = [...chatMessages.map((m) => ({ ...m })), ...chatNotices].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
  if (!all.length) all.push({ role: "model", text: DEFAULT_GREETING, timestamp: Date.now(), greeting: true });
  container.innerHTML = all
    .map((msg) => {
      const isUser = msg.role === "user";
      const time = new Date(msg.timestamp || Date.now()).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      return `<div class="flex ${isUser ? "justify-end" : "justify-start"}">
        <div class="chat-bubble max-w-[88%] md:max-w-xl rounded-2xl p-3.5 text-xs leading-relaxed shadow-sm ${isUser ? "bg-violet-600 text-white rounded-tr-none font-medium" : "bg-slate-800 text-slate-100 border border-slate-700 rounded-tl-none"}">
          ${isUser ? `<div class="whitespace-pre-wrap break-words">${esc(msg.text)}</div>` : `<div class="md">${renderMarkdown(msg.text)}</div>`}
          <div class="flex items-center justify-end gap-2 mt-2">
            ${!isUser && !msg.greeting ? `<button data-action="copy-text" class="text-[9px] text-slate-500 hover:text-slate-300 font-bold">Copy</button>` : ""}
            <span class="text-[9px] ${isUser ? "text-violet-200" : "text-slate-500"} font-mono">${time}</span>
          </div>
        </div>
      </div>`;
    })
    .join("");
  container.querySelectorAll(".md a").forEach((a) => {
    a.target = "_blank";
    a.rel = "noopener noreferrer";
  });
  container.scrollTop = container.scrollHeight;
}

function pushChatMessage(msg) {
  if (isCloud()) {
    chatMessages.push(msg); // optimistic; replaced by the snapshot
    cloudWrite(userDoc().collection("chatMessages").add(msg), "the chat message").catch(() => {});
  } else {
    chatMessages.push(msg);
    saveLocalSession();
  }
  renderChatMessages();
}

async function resetChatHistory() {
  const ok = await showConfirmationModal("Clear conversation?", "This deletes your chat history with the coach.", { icon: "message-square", color: "violet", confirmText: "Clear", danger: true });
  if (!ok) return;
  chatNotices = [];
  if (isCloud()) {
    try {
      const snap = await userDoc().collection("chatMessages").get();
      for (let i = 0; i < snap.docs.length; i += 450) {
        const batch = db.batch();
        snap.docs.slice(i, i + 450).forEach((d) => batch.delete(d.ref));
        await batch.commit();
      }
    } catch (err) {
      console.error("Error clearing chat:", err);
      return showToast("Couldn't clear the conversation.", "error");
    }
  } else {
    chatMessages = [];
    saveLocalSession();
  }
  renderChatMessages();
}

function triggerAIChatMessage(text) {
  switchTab("coach");
  const input = $("chat-input-field");
  input.value = text || "";
  if (text) sendAIChatMessage();
  else input.focus();
}

function setChatBusy(busy) {
  chatBusy = busy;
  $("chat-typing-indicator").classList.toggle("hidden", !busy);
  $("chat-send-btn").disabled = busy;
  $("chat-input-field").disabled = busy;
  if (busy) {
    const c = $("chat-messages-container");
    c.scrollTop = c.scrollHeight;
  }
}

async function sendAIChatMessage() {
  if (chatBusy) return;
  const input = $("chat-input-field");
  const text = input.value.trim();
  if (!text) return;
  input.value = "";

  const history = chatHistoryForAI();
  pushChatMessage({ role: "user", text, timestamp: Date.now() });
  setChatBusy(true);
  try {
    const reply = await callAI({
      messages: [
        { role: "system", content: `${COACH_SYSTEM_PROMPT}\n\n=== USER'S FINANCIAL DATA ===\n${buildFinanceContext()}` },
        ...history,
        { role: "user", content: text },
      ],
      maxTokens: 1000,
      temperature: 0.5,
    });
    pushChatMessage({ role: "model", text: reply, timestamp: Date.now() });
  } catch (err) {
    let notice;
    if (err.kind === "auth") {
      notice = "🔒 **The AI coach needs a free account.**\n\nSigning in keeps AI free and secure, and syncs your data across devices. Tap **Sign in** in the sidebar (or your avatar on mobile) — it takes 30 seconds.\n\nMeanwhile, the mic can still log expenses and answer quick questions like *“how much did I spend on food this month?”* offline.";
      setTimeout(showAuthModal, 1200);
    } else if (err.kind === "limit") {
      notice = `🛑 **Daily AI limit reached.**\n\n${err.message}\n\nYou can still log expenses and ask the mic quick questions like *“what's left in my budget?”* — those run on your device.`;
    } else {
      notice = `⚠️ ${err.message || "Something went wrong reaching the AI."} Your message is saved — tap **Send** again to retry.`;
      input.value = text;
    }
    chatNotices.push({ role: "model", text: notice, timestamp: Date.now(), notice: true });
    renderChatMessages();
  } finally {
    setChatBusy(false);
    if (window.matchMedia("(min-width: 768px)").matches) input.focus();
  }
}

// --- Deep audit ---
async function generateDeepFinancialAudit() {
  const container = $("ai-audit-output-container");
  const block = $("ai-audit-text-block");
  const btn = $("audit-btn");
  container.classList.remove("hidden");
  if (!expenses.length) {
    block.innerHTML = `<p class="text-slate-300">Log at least a few transactions first — the audit analyses your real spending.</p>`;
    return;
  }
  block.innerHTML = `<span class="flex items-center gap-2 text-slate-300"><i data-lucide="refresh-cw" class="w-4 h-4 animate-spin text-violet-400"></i> Analysing ${expenses.length} transactions…</span>`;
  refreshIcons();
  btn.disabled = true;
  try {
    const reply = await callAI({
      messages: [
        { role: "system", content: `${COACH_SYSTEM_PROMPT}\n\n=== USER'S FINANCIAL DATA ===\n${buildFinanceContext({ maxTransactions: 60 })}` },
        {
          role: "user",
          content: `Run a financial health audit of my spending. Use exactly these sections:
## Health score
A score out of 100 with a one-line justification.
## What stands out
3-5 bullets on the biggest patterns, leaks or risks (cite merchants, categories and amounts).
## 3 quick wins
Specific cuts or changes with the monthly amount each would save.
## Suggested monthly budget
A small table: Category | Suggested limit | Current pace.
## Savings boost
How much I could save per month (and per year) if I follow this.`,
        },
      ],
      maxTokens: 1400,
      temperature: 0.4,
    });
    block.innerHTML = `<div class="md">${renderMarkdown(reply)}</div>`;
  } catch (err) {
    block.innerHTML = aiErrorHTML(err, "AI audits");
  } finally {
    btn.disabled = false;
    refreshIcons();
  }
}

// --- Goal strategy ---
async function triggerAISavingsGoalStrategy(id) {
  const g = goals.find((x) => x.id === id);
  if (!g) return;
  const p = goalPlanNumbers(g);
  $("strategy-goal-name").textContent = g.name;

  const local = $("strategy-local-block");
  let pace;
  if (p.gap <= 0) pace = "🎉 You've already reached this goal.";
  else if (p.monthsLeft === null) pace = "Set a deadline to get a monthly savings target.";
  else if (p.monthsLeft <= 0) pace = `The deadline has passed. You still need <strong>${esc(formatCurrency(p.gap))}</strong>.`;
  else pace = `Save <strong>${esc(formatCurrency(p.perMonth))}/month</strong> (≈ ${esc(formatCurrency(p.perMonth / 4.345))}/week) for ${p.monthsLeft.toFixed(1)} months.`;
  local.innerHTML = `<div class="grid grid-cols-3 gap-2 text-center mb-3">
      <div class="p-2 rounded-xl bg-slate-900 border border-slate-800"><div class="text-[9px] uppercase text-slate-500 font-bold">Saved</div><div class="text-xs font-black text-emerald-400">${esc(formatCurrency(p.current))}</div></div>
      <div class="p-2 rounded-xl bg-slate-900 border border-slate-800"><div class="text-[9px] uppercase text-slate-500 font-bold">To go</div><div class="text-xs font-black text-white">${esc(formatCurrency(p.gap))}</div></div>
      <div class="p-2 rounded-xl bg-slate-900 border border-slate-800"><div class="text-[9px] uppercase text-slate-500 font-bold">Deadline</div><div class="text-xs font-black text-white">${esc(g.deadline ? formatDisplayDate(g.deadline) : "—")}</div></div>
    </div><p class="text-xs text-slate-300">${pace}</p>`;

  const loading = $("strategy-loading-block");
  const textBlock = $("strategy-text-block");
  loading.classList.remove("hidden");
  textBlock.classList.add("hidden");
  openModal("modal-goal-strategy");

  if (p.gap <= 0) {
    loading.classList.add("hidden");
    return;
  }
  try {
    const reply = await callAI({
      messages: [
        { role: "system", content: `${COACH_SYSTEM_PROMPT}\n\n=== USER'S FINANCIAL DATA ===\n${buildFinanceContext({ maxTransactions: 30 })}` },
        {
          role: "user",
          content: `Build a savings plan for my goal "${g.name}": I have ${formatCurrency(p.current)} of ${formatCurrency(p.target)}, ${formatCurrency(p.gap)} to go${g.deadline ? `, deadline ${g.deadline} (${p.monthsLeft?.toFixed(1)} months away), which needs ${formatCurrency(p.perMonth || 0)}/month` : ""}.
Give: (1) whether that pace is realistic given my income and spending, (2) exactly 2-3 specific trade-offs from my actual categories/merchants that free up the money, with amounts, (3) a simple weekly routine. Keep it under 200 words.`,
        },
      ],
      maxTokens: 700,
      temperature: 0.5,
    });
    textBlock.innerHTML = `<div class="md">${renderMarkdown(reply)}</div>`;
  } catch (err) {
    textBlock.innerHTML = aiErrorHTML(err, "AI savings plans");
  } finally {
    loading.classList.add("hidden");
    textBlock.classList.remove("hidden");
    refreshIcons();
  }
}

function closeGoalStrategyModal() {
  closeModal("modal-goal-strategy");
}

// =============================================================================
// RECEIPT SCANNER
// =============================================================================
const OCR_PRESETS = {
  starbucks: {
    merchant: "Starbucks", total: 18.75, currency: "USD", category: "Food & Dining", note: "Breakfast run",
    items: [{ name: "Caramel Macchiato (Grande)", price: 6.25 }, { name: "Avocado Toast", price: 7.5 }, { name: "Espresso Shot", price: 5.0 }],
  },
  wholefoods: {
    merchant: "Whole Foods Market", total: 112.4, currency: "USD", category: "Groceries", note: "Weekly groceries",
    items: [{ name: "NY Strip Steak", price: 34.5 }, { name: "Organic Strawberries", price: 8.9 }, { name: "Almond Milk ×2", price: 12.0 }, { name: "Wild Salmon Fillet", price: 57.0 }],
  },
  uber: {
    merchant: "Uber", total: 32.5, currency: "USD", category: "Transport", note: "Ride to the airport",
    items: [{ name: "UberX trip (18.4 km)", price: 27.1 }, { name: "Airport surcharge", price: 3.4 }, { name: "Tip", price: 2.0 }],
  },
};

function renderOcrPresetPrices() {
  Object.entries(OCR_PRESETS).forEach(([key, p]) => {
    const el = $(`preset-${key}-price`);
    if (el) el.textContent = formatMoney(p.total, p.currency);
  });
}

function setOcrLoading(on, message) {
  $("ocr-loading-bar").classList.toggle("hidden", !on);
  if (message) $("ocr-status-message").textContent = message;
}

// Downscale photos so the request stays well under the function's size limit (phone photos are often 3-8 MB).
function compressImage(file, maxSide = 1600, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("This image format isn't supported. Please use a JPG or PNG photo."));
    };
    img.src = url;
  });
}

async function handleReceiptUpload(e) {
  const input = e.target;
  const file = input.files && input.files[0];
  input.value = ""; // allow re-selecting the same file
  if (!file) return;
  if (!file.type.startsWith("image/")) return showToast("Please choose an image of your receipt.", "error");
  if (file.size > 25 * 1024 * 1024) return showToast("That image is over 25 MB. Please use a smaller photo.", "error");

  setOcrLoading(true, "Preparing image…");
  let dataUrl;
  try {
    dataUrl = await compressImage(file);
  } catch (err) {
    setOcrLoading(false);
    return showToast(err.message, "error");
  }
  showOcrPreview(dataUrl);
  setOcrLoading(true, "Reading the receipt with AI…");

  try {
    const reply = await callAI({
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Extract this receipt into JSON. Today is ${todayISO()}.
Fields:
- merchant: store name as printed
- date: purchase date as YYYY-MM-DD (null if not visible)
- total: final amount paid as a number (after tax/discounts, including tip if shown)
- currency: ISO 4217 code inferred from symbols/country (e.g. USD, INR, EUR, AED); null if unclear
- category: one of ${CATEGORY_NAMES.filter((c) => c !== INCOME).join(", ")}
- items: up to 15 line items as {"name": string, "price": number}
- note: a short helpful memo (max 8 words)
- returnWindowDays: return/exchange window in days if printed, else null
If the image is not a receipt, return {"error":"not a receipt"}.
Reply with JSON only.`,
            },
            { type: "image_url", image_url: { url: dataUrl } },
          ],
        },
      ],
      maxTokens: 900,
      temperature: 0.1,
      timeoutMs: 60000,
    });
    const parsed = parseJSONFromAI(reply);
    if (parsed.error) throw new AIError("parse", "That doesn't look like a receipt. Try a clearer photo.");
    const total = Math.abs(parseFloat(parsed.total));
    if (!(total > 0)) throw new AIError("parse", "Couldn't find the total on this receipt. You can enter it manually.");
    activeOcrResult = {
      merchant: String(parsed.merchant || "").slice(0, 80) || "Receipt",
      total,
      currency: CURRENCIES[parsed.currency] ? parsed.currency : currentGlobalCurrency,
      date: isValidISODate(parsed.date) && parsed.date <= todayISO() ? parsed.date : todayISO(),
      category: CATEGORY_NAMES.includes(parsed.category) ? parsed.category : (SSNLU.classifyMerchant(parsed.merchant || "") || {}).category || "Miscellaneous",
      note: String(parsed.note || "").slice(0, 80),
      items: Array.isArray(parsed.items) ? parsed.items.filter((it) => it && it.name).slice(0, 15) : [],
      returnWindowDays: Number.isFinite(parseInt(parsed.returnWindowDays, 10)) ? parseInt(parsed.returnWindowDays, 10) : null,
    };
    displayScannedReceipt(activeOcrResult);
    showToast("Receipt read — check the details and save.", "success");
  } catch (err) {
    if (err.kind === "auth") {
      handleAIErrorToast(err, "the receipt scanner");
    } else if (err.kind === "parse") {
      showToast(err.message, "error");
      activeOcrResult = { merchant: "", total: "", currency: currentGlobalCurrency, date: todayISO(), category: "Miscellaneous", note: "", items: [], returnWindowDays: null };
      displayScannedReceipt(activeOcrResult);
    } else showToast(err.message || "Couldn't read the receipt.", "error");
  } finally {
    setOcrLoading(false);
  }
}

function showOcrPreview(src) {
  const img = $("ocr-preview-img");
  const placeholder = $("ocr-preview-placeholder");
  if (src) {
    img.src = src;
    img.classList.remove("hidden");
    placeholder.classList.add("hidden");
  } else {
    img.removeAttribute("src");
    img.classList.add("hidden");
    placeholder.classList.remove("hidden");
  }
}

function triggerDemoReceiptScan(type) {
  const preset = OCR_PRESETS[type];
  if (!preset) return;
  showOcrPreview(null);
  $("ocr-empty-state").classList.add("hidden");
  setOcrLoading(true, "Loading sample receipt…");
  setTimeout(() => {
    activeOcrResult = { ...preset, items: preset.items.map((i) => ({ ...i })), date: todayISO(), returnWindowDays: null };
    displayScannedReceipt(activeOcrResult);
    setOcrLoading(false);
    showToast("Sample receipt loaded. Review and save it to try the flow.", "info");
  }, 600);
}

function displayScannedReceipt(r) {
  $("ocr-empty-state").classList.add("hidden");
  $("ocr-scanned-content").classList.remove("hidden");
  $("ocr-action-container").classList.remove("hidden");
  $("scanned-merchant").value = r.merchant || "";
  $("scanned-total").value = r.total === "" ? "" : round2(Number(r.total) || 0);
  $("scanned-currency").value = r.currency || currentGlobalCurrency;
  $("scanned-date").value = r.date || todayISO();
  $("scanned-category").value = r.category || "Miscellaneous";
  $("scanned-note").value = r.note || "";
  const grid = $("scanned-items-container");
  grid.innerHTML = r.items && r.items.length
    ? r.items.map((it) => `<div class="flex justify-between items-center gap-3 text-[11px] text-slate-300 py-0.5"><span class="truncate">• ${esc(it.name)}</span><span class="font-mono whitespace-nowrap">${esc(Number.isFinite(Number(it.price)) ? formatMoney(Number(it.price), r.currency || currentGlobalCurrency) : "")}</span></div>`).join("")
    : `<span class="text-[10px] text-slate-500 font-bold">No line items detected.</span>`;
  $("ocr-return-note").textContent = r.returnWindowDays ? `Return window: ${r.returnWindowDays} days — we'll remind you before it closes.` : "";
}

function discardOcrScan() {
  activeOcrResult = null;
  showOcrPreview(null);
  $("ocr-scanned-content").classList.add("hidden");
  $("ocr-action-container").classList.add("hidden");
  $("ocr-empty-state").classList.remove("hidden");
}

function commitOcrScan() {
  if (!activeOcrResult) return;
  const amount = parseFloat($("scanned-total").value);
  const merchant = $("scanned-merchant").value.trim();
  const date = $("scanned-date").value;
  if (!(amount > 0)) return showToast("Enter the receipt total.", "error");
  if (!merchant) return showToast("Enter the merchant name.", "error");
  if (!isValidISODate(date)) return showToast("Pick a valid date.", "error");

  let returnDeadline = null;
  if (activeOcrResult.returnWindowDays) returnDeadline = toISODate(addDays(parseISODate(date), activeOcrResult.returnWindowDays));
  const payload = {
    amount: round2(amount),
    currency: $("scanned-currency").value,
    merchant,
    category: $("scanned-category").value,
    date,
    note: $("scanned-note").value.trim(),
    paymentMethod: LS.get("spendsense_last_payment") || "Credit Card",
    isSubscription: false,
    returnDeadline,
    source: "receipt",
  };
  lastAddedExpenseId = persistExpense(payload);
  showToast(`Saved ${formatMoney(payload.amount, payload.currency)} at ${merchant}.`, "success");
  checkBudgetAfterSave(payload);
  discardOcrScan();
  switchTab("dashboard");
}

// =============================================================================
// EXPORT & DATA DELETION
// =============================================================================
function exportToCSV() {
  if (!expenses.length) return showToast("Nothing to export yet.", "info");
  const cell = (v) => {
    let s = String(v ?? "");
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // neutralise spreadsheet formulas
    return `"${s.replace(/"/g, '""')}"`;
  };
  const header = ["Date", "Merchant", "Category", "Type", "Amount", "Currency", `Amount (${currentGlobalCurrency})`, "Payment method", "Recurring", "Note"];
  const rows = expenses.map((ex) =>
    [ex.date, ex.merchant, ex.category, isIncome(ex) ? "Income" : "Expense", ex.amount.toFixed(2), ex.currency, amountBase(ex).toFixed(2), ex.paymentMethod, ex.isSubscription ? "Yes" : "No", ex.note]
      .map(cell)
      .join(",")
  );
  const blob = new Blob(["﻿" + [header.map(cell).join(","), ...rows].join("\r\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `SpendSense_${todayISO()}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  showToast(`Exported ${expenses.length} transactions.`, "success");
}

async function deleteCloudCollections(names) {
  const ref = userDoc();
  for (const name of names) {
    try {
      const snap = await ref.collection(name).get();
      for (let i = 0; i < snap.docs.length; i += 450) {
        const batch = db.batch();
        snap.docs.slice(i, i + 450).forEach((d) => batch.delete(d.ref));
        await batch.commit();
      }
    } catch (err) {
      if (name === "api_usage") continue; // may be server-managed
      throw err;
    }
  }
}

async function confirmDeleteAllData() {
  const ok = await showConfirmationModal(
    "Erase all data?",
    `This permanently deletes every transaction, budget, goal, setting and chat message ${currentUser ? "in your account" : "on this device"}. Consider exporting a CSV first.`,
    { icon: "trash-2", color: "red", confirmText: "Erase everything", input: { label: 'Type "DELETE" to confirm', placeholder: "DELETE", mustEqual: "DELETE" } }
  );
  if (!ok) return;
  try {
    if (isCloud()) {
      showToast("Erasing your data…", "info");
      await deleteCloudCollections(["expenses", "budgets", "goals", "chatMessages"]);
      await userDoc().set({ monthlyIncome: 0, monthlyBudgetLimit: 0, weeklyTarget: 0, useWeeklyTargetOverride: false }, { merge: true });
    } else {
      expenses = [];
      budgets = [];
      goals = [];
      chatMessages = [];
      monthlyIncome = monthlyBudgetLimit = weeklyTarget = 0;
      useWeeklyTargetOverride = false;
      clearLocalOfflineData();
      syncSettingsInputs();
    }
    chatNotices = [];
    LS.remove("spendsense_dismissed_notifs");
    LS.remove("spendsense_dismissed_anomalies");
    showToast("All data erased.", "info");
    switchTab("dashboard");
    setupAppInterface();
    renderChatMessages();
  } catch (err) {
    console.error("Erase failed:", err);
    showToast("Couldn't erase everything. Please try again.", "error");
  }
}

async function reauthenticateCurrentUser() {
  const lastSignIn = Date.parse(currentUser.metadata?.lastSignInTime || 0);
  if (Date.now() - lastSignIn < 4 * 60 * 1000) return true;
  const providerId = (currentUser.providerData[0] || {}).providerId;
  if (providerId === "google.com") {
    await currentUser.reauthenticateWithPopup(new firebase.auth.GoogleAuthProvider());
    return true;
  }
  const password = await showConfirmationModal("Confirm it's you", "For security, enter your password to continue.", {
    icon: "key", color: "violet", confirmText: "Continue", danger: false, input: { label: "Password", type: "password", placeholder: "Your password" },
  });
  if (!password) return false;
  await currentUser.reauthenticateWithCredential(firebase.auth.EmailAuthProvider.credential(currentUser.email, password));
  return true;
}

async function deleteUserAccount() {
  if (!currentUser) return showToast("You must be signed in to delete your account.", "error");
  const ok = await showConfirmationModal(
    "Delete account permanently?",
    `Your account (${currentUser.email}) and all its data — transactions, budgets, goals and chat history — will be permanently deleted. This cannot be undone.`,
    { icon: "user-x", color: "red", confirmText: "Delete account", input: { label: 'Type "DELETE" to confirm', placeholder: "DELETE", mustEqual: "DELETE" } }
  );
  if (!ok) return;
  try {
    if (!(await reauthenticateCurrentUser())) return;
  } catch (err) {
    const [title] = AUTH_ERRORS[err.code] || ["Couldn't verify your identity"];
    return showToast(`${title}. Account not deleted.`, "error");
  }
  try {
    showToast("Deleting your account…", "info");
    const user = currentUser;
    unsubscribeAll();
    await deleteCloudCollections(["expenses", "budgets", "goals", "chatMessages", "api_usage"]);
    await userDoc().delete();
    await user.delete();
    try {
      localStorage.clear();
    } catch {}
    LS.set("spendsense_onboarded", "true");
    showToast("Your account has been deleted. Goodbye!", "success");
    setTimeout(() => window.location.replace(window.location.pathname), 1500);
  } catch (error) {
    console.error("Account deletion error:", error);
    if (currentUser) subscribeToCloud();
    showToast(error.code === "auth/requires-recent-login" ? "Please sign out and back in, then try again." : "Account deletion failed. Please try again.", "error");
  }
}

// =============================================================================
// VOICE ASSISTANT
// =============================================================================
const voiceState = { recognition: null, listening: false, gotFinal: false, intent: null, autoStopTimer: null };
const SpeechRecognitionImpl = window.SpeechRecognition || window.webkitSpeechRecognition;
const TAB_LABELS = { dashboard: "the dashboard", expenses: "your ledger", ocr: "the receipt scanner", coach: "the AI coach", budgets: "budgets and goals", settings: "settings" };

function voiceLang() {
  const lang = navigator.language || "en-US";
  if (/^en/i.test(lang)) return lang;
  try {
    const region = new Intl.Locale(lang).maximize().region;
    return region ? `en-${region}` : "en-US";
  } catch {
    return "en-US";
  }
}

const ttsEnabled = () => LS.get("spendsense_voice_tts", "true") === "true";
function toggleVoiceTTS(e) {
  LS.set("spendsense_voice_tts", e.target.checked ? "true" : "false");
  if (!e.target.checked && window.speechSynthesis) speechSynthesis.cancel();
}
function speak(text) {
  if (!ttsEnabled() || !window.speechSynthesis || !text) return;
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(String(text).replace(/[*_#`]/g, ""));
    u.lang = voiceLang();
    u.rate = 1.05;
    speechSynthesis.speak(u);
  } catch {}
}

function setVoiceStatus(text, tone = "default") {
  const el = $("voice-assistant-status");
  el.textContent = text;
  el.className = `text-xs mt-1 min-h-[1rem] ${tone === "error" ? "text-amber-400 font-semibold" : tone === "listening" ? "text-violet-300 font-bold" : tone === "success" ? "text-emerald-400 font-semibold" : "text-slate-400"}`;
}

function setMicVisual(listening) {
  const btn = $("voice-mic-btn");
  btn.classList.toggle("voice-listening", listening);
  btn.setAttribute("aria-pressed", listening ? "true" : "false");
  btn.setAttribute("aria-label", listening ? "Stop listening" : "Start listening");
  $("voice-wave-visualizer").classList.toggle("invisible", !listening);
}

function setTranscript(text, interim = false) {
  const el = $("voice-speech-transcription");
  el.textContent = text ? `“${text}”` : "Try: “spent 250 on lunch”, “how much did I spend on food this month?”";
  el.className = `p-3 bg-slate-950 rounded-2xl border border-slate-800 text-xs min-h-[45px] ${text ? (interim ? "text-slate-400 italic" : "text-violet-200 font-semibold") : "text-slate-500"}`;
}

function triggerVoiceRecognition() {
  resetVoicePanel();
  openModal("modal-voice-assist");
  if (!SpeechRecognitionImpl) {
    setVoiceStatus("Voice input isn't supported in this browser — type a command below instead.", "error");
    $("voice-mic-btn").disabled = true;
    setTimeout(() => $("voice-text-input").focus(), 60);
    return;
  }
  $("voice-mic-btn").disabled = false;
  startListening();
}

function resetVoicePanel() {
  voiceState.intent = null;
  $("voice-result").innerHTML = "";
  $("voice-result").classList.add("hidden");
  $("voice-text-input").value = "";
  $("voice-tts-toggle").checked = ttsEnabled();
  setTranscript("");
  setVoiceStatus(SpeechRecognitionImpl ? "Tap the mic and speak" : "Type a command below");
  setMicVisual(false);
}

function toggleVoiceListening() {
  if (voiceState.listening) stopListening();
  else startListening();
}

function startListening() {
  if (!SpeechRecognitionImpl) return;
  if (window.speechSynthesis) speechSynthesis.cancel();
  stopListening(true);
  const rec = new SpeechRecognitionImpl();
  rec.lang = voiceLang();
  rec.interimResults = true;
  rec.continuous = false;
  rec.maxAlternatives = 3;
  voiceState.recognition = rec;
  voiceState.gotFinal = false;

  rec.onstart = () => {
    voiceState.listening = true;
    setMicVisual(true);
    setVoiceStatus("Listening…", "listening");
    setTranscript("");
    clearTimeout(voiceState.autoStopTimer);
    voiceState.autoStopTimer = setTimeout(() => stopListening(), 12000);
  };
  rec.onresult = (event) => {
    let interim = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      if (result.isFinal) {
        voiceState.gotFinal = true;
        const alternatives = Array.from(result).map((a) => a.transcript.trim()).filter(Boolean);
        stopListening();
        handleVoiceText(pickBestAlternative(alternatives));
        return;
      }
      interim += result[0].transcript;
    }
    if (interim) setTranscript(interim.trim(), true);
  };
  rec.onerror = (e) => {
    const messages = {
      "not-allowed": "Microphone access is blocked. Allow it in your browser's site settings, or type below.",
      "service-not-allowed": "Microphone access is blocked. Allow it in your browser's site settings, or type below.",
      "no-speech": "I didn't hear anything. Tap the mic and try again.",
      "audio-capture": "No microphone was found. Check your device, or type below.",
      network: "Voice recognition needs an internet connection. You can type below.",
      "language-not-supported": "Voice recognition isn't available for your language setting. Type below instead.",
    };
    if (e.error !== "aborted") setVoiceStatus(messages[e.error] || "Voice recognition stopped. Tap the mic to try again.", "error");
  };
  rec.onend = () => {
    voiceState.listening = false;
    clearTimeout(voiceState.autoStopTimer);
    setMicVisual(false);
    if (!voiceState.gotFinal && $("voice-assistant-status").textContent === "Listening…") setVoiceStatus("Tap the mic and speak");
  };
  try {
    rec.start();
  } catch (err) {
    console.warn("Speech start failed:", err);
    setVoiceStatus("Couldn't start the microphone. Tap to try again, or type below.", "error");
  }
}

function stopListening(silent = false) {
  clearTimeout(voiceState.autoStopTimer);
  const rec = voiceState.recognition;
  if (!rec) return;
  voiceState.recognition = null;
  if (silent) {
    rec.onend = rec.onerror = rec.onresult = null;
    try {
      rec.abort();
    } catch {}
    voiceState.listening = false;
    setMicVisual(false);
    return;
  }
  try {
    rec.stop();
  } catch {}
}

function closeVoiceAssist() {
  stopListening(true);
  if (window.speechSynthesis) speechSynthesis.cancel();
  closeModal("modal-voice-assist");
}

function voiceContext() {
  return {
    baseCurrency: currentGlobalCurrency,
    goals: goals.map((g) => ({ id: g.id, name: g.name })),
    merchants: [...new Set(expenses.map((e) => e.merchant))],
    memory: buildMerchantMemory(),
    today: new Date(),
  };
}

// When the recogniser offers several transcripts, prefer one we can act on (e.g. one with an amount).
function pickBestAlternative(alternatives) {
  if (!alternatives.length) return "";
  if (!window.SSNLU) return alternatives[0];
  const ctx = voiceContext();
  const first = SSNLU.parseVoiceIntent(alternatives[0], ctx);
  if (first.type !== "ask") return alternatives[0];
  for (const alt of alternatives.slice(1)) if (SSNLU.parseVoiceIntent(alt, ctx).type !== "ask") return alt;
  return alternatives[0];
}

function submitVoiceText(e) {
  e.preventDefault();
  const text = $("voice-text-input").value.trim();
  if (!text) return;
  $("voice-text-input").value = "";
  stopListening(true);
  handleVoiceText(text);
}

// Kept for the example chips and backwards compatibility.
function runSimulatedVoiceCommand(text) {
  handleVoiceText(text);
}
function parseVoiceCommand(text) {
  handleVoiceText(text);
}

function handleVoiceText(text) {
  if (!text) return setVoiceStatus("I didn't catch that. Tap the mic and try again.", "error");
  if (!$("modal-voice-assist").classList.contains("flex")) openModal("modal-voice-assist");
  setTranscript(text);
  if (!window.SSNLU) {
    closeVoiceAssist();
    return triggerAIChatMessage(text);
  }
  const intent = SSNLU.parseVoiceIntent(text, voiceContext());
  voiceState.intent = intent;
  executeVoiceIntent(intent, text);
}

function voiceResult(html) {
  const box = $("voice-result");
  box.innerHTML = html;
  box.classList.remove("hidden");
  refreshIcons();
}

function categoryOptionsHTML(selected) {
  return CATEGORIES.map((c) => `<option value="${esc(c.name)}" ${c.name === selected ? "selected" : ""}>${c.icon} ${esc(c.name === INCOME ? "Income / Salary" : c.name)}</option>`).join("");
}
function currencyOptionsHTML(selected) {
  return Object.keys(CURRENCIES).map((c) => `<option value="${c}" ${c === selected ? "selected" : ""}>${c}</option>`).join("");
}

function executeVoiceIntent(intent, text) {
  switch (intent.type) {
    case "expense": {
      const amountText = formatMoney(intent.amount, intent.currency);
      voiceResult(`
        <div class="text-left space-y-3">
          <div class="flex items-center justify-between"><span class="text-[10px] uppercase tracking-wider font-bold ${intent.isIncome ? "text-emerald-400" : "text-violet-300"}">${intent.isIncome ? "Log income" : "Log expense"}</span>
            <span class="text-[10px] text-slate-500">${esc([intent.paymentMethod, intent.isSubscription ? "Recurring" : ""].filter(Boolean).join(" · "))}</span></div>
          <div class="grid grid-cols-5 gap-2">
            <input id="voice-f-amount" type="number" step="0.01" min="0" value="${esc(intent.amount)}" aria-label="Amount" class="col-span-3 bg-slate-800 border border-slate-700 rounded-xl py-2 px-3 text-sm font-bold text-white focus:outline-none focus:border-violet-500" />
            <select id="voice-f-currency" aria-label="Currency" class="col-span-2 bg-slate-800 border border-slate-700 rounded-xl py-2 px-2 text-xs text-white focus:outline-none">${currencyOptionsHTML(intent.currency)}</select>
          </div>
          <input id="voice-f-merchant" type="text" value="${esc(intent.merchant)}" placeholder="What was it? (e.g. Starbucks)" aria-label="Merchant" class="w-full bg-slate-800 border border-slate-700 rounded-xl py-2 px-3 text-xs text-white focus:outline-none focus:border-violet-500" />
          <div class="grid grid-cols-2 gap-2">
            <select id="voice-f-category" aria-label="Category" class="bg-slate-800 border border-slate-700 rounded-xl py-2 px-2 text-xs text-white focus:outline-none">${categoryOptionsHTML(intent.category)}</select>
            <input id="voice-f-date" type="date" value="${esc(intent.date)}" aria-label="Date" class="bg-slate-800 border border-slate-700 rounded-xl py-2 px-2 text-xs text-white focus:outline-none" />
          </div>
          <div class="flex gap-2 pt-1">
            <button data-action="voice-edit" class="flex-1 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-bold text-slate-200">More options</button>
            <button id="voice-save-btn" data-action="voice-save" class="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-xs font-bold text-white">Save</button>
          </div>
        </div>`);
      setVoiceStatus(intent.merchant ? "Check the details, then save" : "What was it for? Add a description, then save", "success");
      $("voice-result").querySelectorAll("input").forEach((el) => el.addEventListener("keydown", (e) => e.key === "Enter" && (e.preventDefault(), confirmVoiceIntent())));
      setTimeout(() => (intent.merchant ? $("voice-save-btn") : $("voice-f-merchant"))?.focus(), 50);
      speak(`${amountText}${intent.merchant ? ` for ${intent.merchant}` : ""}. Tap save to confirm.`);
      return;
    }
    case "deposit": {
      if (!goals.length) {
        voiceResult(`<p class="text-xs text-slate-300">You don't have any savings goals yet.</p><button onclick="closeVoiceAssist(); openGoalModal()" class="mt-3 py-2 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold">Create a goal</button>`);
        return speak("You don't have any savings goals yet.");
      }
      const amountBaseValue = convert(intent.amount, intent.currency);
      if (!intent.goalId) {
        voiceResult(`<p class="text-xs text-slate-300 mb-2">Which goal should get <strong class="text-white">${esc(formatCurrency(amountBaseValue))}</strong>?</p><div class="flex flex-wrap gap-2 justify-center">${goals.map((g) => `<button data-action="voice-pick-goal" data-id="${esc(g.id)}" class="py-2 px-3 rounded-xl bg-slate-800 hover:bg-emerald-600/30 border border-slate-700 text-xs font-bold text-slate-200">${esc(g.name)}</button>`).join("")}</div>`);
        return speak("Which goal should I add it to?");
      }
      voiceResult(`<p class="text-xs text-slate-300">Add <strong class="text-white">${esc(formatCurrency(amountBaseValue))}</strong> to <strong class="text-emerald-400">${esc(intent.goalName)}</strong>?</p><div class="flex gap-2 mt-3"><button data-action="voice-close" class="flex-1 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-xs font-bold text-slate-300">Cancel</button><button id="voice-save-btn" data-action="voice-save" class="flex-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-xs font-bold text-white">Add deposit</button></div>`);
      setTimeout(() => $("voice-save-btn")?.focus(), 50);
      return speak(`Add ${formatCurrency(amountBaseValue)} to ${intent.goalName}?`);
    }
    case "set-budget":
    case "set-income": {
      const value = convert(intent.amount, intent.currency);
      const label = intent.type === "set-income" ? "monthly income" : intent.category ? `${intent.category} budget` : "monthly budget";
      voiceResult(`<p class="text-xs text-slate-300">Set your ${esc(label)} to <strong class="text-white">${esc(formatCurrency(value))}</strong>${intent.type === "set-budget" ? " per month" : ""}?</p><div class="flex gap-2 mt-3"><button data-action="voice-close" class="flex-1 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-xs font-bold text-slate-300">Cancel</button><button id="voice-save-btn" data-action="voice-save" class="flex-1 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-xs font-bold text-white">Confirm</button></div>`);
      setTimeout(() => $("voice-save-btn")?.focus(), 50);
      return speak(`Set your ${label} to ${formatCurrency(value)}?`);
    }
    case "query": {
      const answer = answerVoiceQuery(intent);
      voiceResult(`<div class="text-left text-xs text-slate-200 leading-relaxed md">${renderMarkdown(answer)}</div>`);
      setVoiceStatus("Ask another question or tap the mic", "success");
      return speak(answer);
    }
    case "navigate": {
      switchTab(intent.tab);
      setVoiceStatus(`Opening ${TAB_LABELS[intent.tab]}…`, "success");
      speak(`Opening ${TAB_LABELS[intent.tab]}`);
      return setTimeout(closeVoiceAssist, 700);
    }
    case "action":
      return runVoiceAction(intent.action);
    case "undo": {
      const last = (lastAddedExpenseId && expenses.find((e) => e.id === lastAddedExpenseId)) || [...expenses].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0];
      if (!last) {
        setVoiceStatus("There's nothing to undo.", "error");
        return speak("There's nothing to undo.");
      }
      voiceState.intent = { type: "undo", id: last.id };
      voiceResult(`<p class="text-xs text-slate-300">Delete <strong class="text-white">${esc(last.merchant)}</strong> · ${esc(formatMoney(last.amount, last.currency))} (${esc(formatDisplayDate(last.date))})?</p><div class="flex gap-2 mt-3"><button data-action="voice-close" class="flex-1 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-xs font-bold text-slate-300">Keep it</button><button id="voice-save-btn" data-action="voice-save" class="flex-1 py-2.5 rounded-xl bg-red-600 hover:bg-red-500 text-xs font-bold text-white">Delete</button></div>`);
      return speak(`Delete ${last.merchant}?`);
    }
    case "cancel":
      return closeVoiceAssist();
    case "ask":
      if (currentUser || isLocalDev()) {
        closeVoiceAssist();
        return triggerAIChatMessage(intent.text);
      }
      voiceResult(`<div class="text-xs text-slate-300 space-y-3"><p>That's a question for the AI coach, which needs a free account.</p><p class="text-slate-400">Without signing in I can still log expenses (“spent 250 on lunch”) and answer questions like “how much did I spend this week?”.</p><button onclick="closeVoiceAssist(); showAuthModal()" class="py-2 px-4 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-bold">Sign in free</button></div>`);
      return speak("That's a question for the AI coach, which needs a free account.");
    default:
      setVoiceStatus("I didn't catch that. Try “spent 250 on lunch”.", "error");
  }
}

function runVoiceAction(action) {
  closeVoiceAssist();
  const map = {
    audit: () => {
      switchTab("dashboard");
      generateDeepFinancialAudit();
    },
    scan: () => {
      switchTab("ocr");
      showToast("Tap “Choose receipt” to take or upload a photo.", "info");
    },
    "add-expense": () => openExpenseModal(),
    "add-goal": () => {
      switchTab("budgets");
      openGoalModal();
    },
    "add-budget": () => {
      switchTab("budgets");
      openBudgetModal();
    },
    export: () => exportToCSV(),
  };
  (map[action] || (() => {}))();
}

function confirmVoiceIntent() {
  const intent = voiceState.intent;
  if (!intent) return;
  if (intent.type === "expense") {
    const amount = parseFloat($("voice-f-amount").value);
    if (!(amount > 0)) return setVoiceStatus("Enter an amount greater than zero.", "error");
    const merchant = $("voice-f-merchant").value.trim();
    if (!merchant) {
      setVoiceStatus("Add a short description first.", "error");
      return $("voice-f-merchant").focus();
    }
    const payload = {
      amount: round2(amount),
      currency: $("voice-f-currency").value,
      merchant,
      category: $("voice-f-category").value,
      date: isValidISODate($("voice-f-date").value) ? $("voice-f-date").value : todayISO(),
      note: intent.note || "",
      paymentMethod: intent.paymentMethod || LS.get("spendsense_last_payment") || "Credit Card",
      isSubscription: intent.isSubscription || $("voice-f-category").value === "Subscriptions",
      source: "voice",
    };
    lastAddedExpenseId = persistExpense(payload);
    checkBudgetAfterSave(payload);
    const done = `Saved ${formatMoney(payload.amount, payload.currency)} for ${merchant}.`;
    voiceResult(`<div class="text-xs space-y-3"><p class="text-emerald-400 font-bold">✓ ${esc(done)}</p><div class="flex gap-2 justify-center"><button data-action="voice-undo" class="py-2 px-4 rounded-xl bg-slate-800 border border-slate-700 font-bold text-slate-300 flex items-center gap-1"><i data-lucide="undo-2" class="w-3.5 h-3.5"></i> Undo</button><button onclick="startListening()" class="py-2 px-4 rounded-xl bg-violet-600 hover:bg-violet-500 font-bold text-white flex items-center gap-1"><i data-lucide="mic" class="w-3.5 h-3.5"></i> Log another</button></div></div>`);
    setVoiceStatus("Done", "success");
    voiceState.intent = null;
    return speak("Saved.");
  }
  if (intent.type === "deposit" && intent.goalId) {
    depositToGoal(intent.goalId, round2(convert(intent.amount, intent.currency)));
    voiceState.intent = null;
    speak("Deposit added.");
    return setTimeout(closeVoiceAssist, 500);
  }
  if (intent.type === "set-budget") {
    const value = convert(intent.amount, intent.currency);
    if (intent.category) {
      upsertBudget(intent.category, value);
      showToast(`${intent.category} budget set to ${formatCurrency(value)}/month.`, "success");
    } else saveQuickMonthlyBudget(value);
    voiceState.intent = null;
    speak("Budget updated.");
    return setTimeout(closeVoiceAssist, 500);
  }
  if (intent.type === "set-income") {
    $("setting-monthly-income").value = round2(convert(intent.amount, intent.currency));
    saveMonthlyIncome();
    voiceState.intent = null;
    speak("Income updated.");
    return setTimeout(closeVoiceAssist, 500);
  }
  if (intent.type === "undo" && intent.id) {
    removeExpense(intent.id).then(() => showToast("Deleted.", "info")).catch(() => {});
    voiceState.intent = null;
    speak("Deleted.");
    return setTimeout(closeVoiceAssist, 500);
  }
}

function undoLastExpense() {
  if (!lastAddedExpenseId) return;
  const id = lastAddedExpenseId;
  lastAddedExpenseId = null;
  removeExpense(id).then(() => {
    showToast("Entry removed.", "info");
    voiceResult(`<p class="text-xs text-slate-300">Removed. Tap the mic to try again.</p>`);
  }).catch(() => {});
}

function editVoiceIntentInForm() {
  const intent = voiceState.intent;
  if (!intent || intent.type !== "expense") return;
  const prefill = {
    amount: parseFloat($("voice-f-amount").value) || intent.amount,
    currency: $("voice-f-currency").value,
    merchant: $("voice-f-merchant").value.trim(),
    category: $("voice-f-category").value,
    date: $("voice-f-date").value,
    note: intent.note,
    paymentMethod: intent.paymentMethod,
    isSubscription: intent.isSubscription,
  };
  closeVoiceAssist();
  openExpenseModal(prefill);
}

// Answers common questions instantly on-device (no AI call, works offline).
function answerVoiceQuery(q) {
  const period = q.period || {};
  const label = period.label || "this month";
  const inPeriod = expenses.filter((e) => inRange(e, period.start || "0000", period.end || "9999"));
  const spending = inPeriod.filter((e) => !isIncome(e));
  const stats = getStats();
  const f = formatCurrency;

  switch (q.query) {
    case "spend": {
      let list = spending;
      let subject = "";
      if (q.merchant) {
        const key = SSNLU.merchantKey(q.merchant);
        list = list.filter((e) => SSNLU.merchantKey(e.merchant).includes(key));
        subject = ` at ${q.merchant}`;
      } else if (q.category) {
        list = list.filter((e) => e.category === q.category);
        subject = ` on ${q.category}`;
      }
      const total = sum(list, amountBase);
      if (!list.length) return `You haven't logged any spending${subject} ${label}.`;
      let text = `You spent **${f(total)}**${subject} ${label} across ${list.length} transaction${list.length === 1 ? "" : "s"}.`;
      if (q.category && period.key === "this-month") {
        const b = budgets.find((x) => x.category === q.category);
        if (b) text += ` That's ${Math.round((total / budgetLimitBase(b)) * 100)}% of your ${f(budgetLimitBase(b))} budget.`;
      }
      if (!q.category && !q.merchant && period.key === "this-month" && stats.lastMonthSamePoint > 0) {
        const diff = total - stats.lastMonthSamePoint;
        text += ` That's ${f(Math.abs(diff))} ${diff >= 0 ? "more" : "less"} than at this point last month.`;
      }
      return text;
    }
    case "remaining": {
      if (q.category) {
        const b = budgets.find((x) => x.category === q.category);
        if (!b) return `You don't have a ${q.category} budget yet. Say “set ${q.category.toLowerCase()} budget to …” to add one.`;
        const left = budgetLimitBase(b) - (stats.byCategory[q.category] || 0);
        return left >= 0 ? `You have **${f(left)}** left in your ${q.category} budget this month.` : `You're **${f(-left)}** over your ${q.category} budget this month.`;
      }
      if (!(stats.monthlyBudget > 0)) return "You haven't set a monthly budget yet. Say “set my budget to 2000” to add one.";
      const left = stats.monthlyBudget - stats.spentThisMonth;
      if (left < 0) return `You're **${f(-left)}** over your ${f(stats.monthlyBudget)} monthly budget.`;
      return `You have **${f(left)}** left this month — about **${f(left / stats.daysLeft)} a day** for the next ${stats.daysLeft} day${stats.daysLeft === 1 ? "" : "s"}.`;
    }
    case "biggest": {
      if (!spending.length) return `No spending logged ${label}.`;
      const top = [...spending].sort((a, b) => amountBase(b) - amountBase(a))[0];
      return `Your biggest expense ${label} was **${f(amountBase(top))}** at ${top.merchant} on ${formatDisplayDate(top.date)} (${top.category}).`;
    }
    case "top-category": {
      if (!spending.length) return `No spending logged ${label}.`;
      const by = {};
      spending.forEach((e) => (by[e.category] = (by[e.category] || 0) + amountBase(e)));
      const total = sum(Object.values(by));
      const top = Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, 3);
      return `Most of your money ${label} went to ${top.map(([c, v]) => `**${c}** (${f(v)}, ${Math.round((v / total) * 100)}%)`).join(", ")}.`;
    }
    case "subscriptions": {
      const rec = detectRecurring();
      if (!rec.length) return "I haven't found any recurring payments yet.";
      return `You have ${rec.length} recurring payment${rec.length === 1 ? "" : "s"} totalling about **${f(sum(rec, (r) => r.amount))} a month**: ${rec.slice(0, 5).map((r) => `${r.merchant} (${f(r.amount)})`).join(", ")}.`;
    }
    case "goals": {
      if (!goals.length) return "You don't have any savings goals yet.";
      return goals.map((g) => {
        const p = goalPlanNumbers(g);
        return `**${g.name}**: ${Math.round(p.pct)}% (${f(p.current)} of ${f(p.target)})${p.perMonth ? ` — save ${f(p.perMonth)}/month to finish on time` : ""}.`;
      }).join("\n");
    }
    case "savings": {
      if (stats.savingsRate === null) return "Set your monthly income in Settings (or log income) and I'll track your savings rate.";
      return `So far this month you've ${stats.savings >= 0 ? "saved" : "overspent by"} **${f(Math.abs(stats.savings))}** — a savings rate of **${stats.savingsRate.toFixed(0)}%**.`;
    }
    case "income": {
      const inc = sum(inPeriod.filter(isIncome), amountBase);
      if (inc > 0) return `You logged **${f(inc)}** of income ${label}.`;
      return getMonthlyIncome() > 0 ? `Your monthly income is set to **${f(getMonthlyIncome())}**.` : "You haven't logged or set any income yet.";
    }
    default:
      return "I'm not sure about that one yet.";
  }
}
