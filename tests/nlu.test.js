// Unit tests for the voice / natural-language parser.
// Run with:  node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
const N = require("../nlu.js");

// Tuesday 20 October 2026, local time
const today = new Date(2026, 9, 20);
const goals = [
  { id: "g1", name: "Japan Spring Trip 🌸" },
  { id: "g2", name: "Emergency Fund" },
];
const ctx = (extra = {}) => ({ baseCurrency: "USD", goals, merchants: ["Starbucks", "Uber"], today, ...extra });
const parse = (text, extra) => N.parseVoiceIntent(text, ctx(extra));

test("spoken numbers become digits", () => {
  assert.equal(N.wordsToNumbers("fifteen hundred"), "1500");
  assert.equal(N.wordsToNumbers("twenty five dollars"), "25 dollars");
  assert.equal(N.wordsToNumbers("one hundred and fifty rupees"), "150 rupees");
  assert.equal(N.wordsToNumbers("2 lakh"), "200000");
  assert.equal(N.wordsToNumbers("1,250"), "1250");
  assert.equal(N.wordsToNumbers("1,25,000"), "125000");
  assert.equal(N.wordsToNumbers("5k"), "5000");
  assert.equal(N.wordsToNumbers("1.5k"), "1500");
  assert.equal(N.wordsToNumbers("a thousand"), "1000");
  assert.equal(N.wordsToNumbers("twelve point five"), "12.5");
  assert.equal(N.wordsToNumbers("three thousand four hundred"), "3400");
  assert.equal(N.wordsToNumbers("twenty-two"), "22");
});

test("expense with comma amount and currency word (was: 1 USD)", () => {
  const r = parse("spent 1,250 rupees on groceries");
  assert.equal(r.type, "expense");
  assert.equal(r.amount, 1250);
  assert.equal(r.currency, "INR");
  assert.equal(r.merchant, "Groceries");
  assert.equal(r.category, "Groceries");
});

test("subscription stays an expense (was: navigated to chat)", () => {
  const r = parse("add 20 for chatgpt subscription");
  assert.equal(r.type, "expense");
  assert.equal(r.amount, 20);
  assert.equal(r.merchant, "ChatGPT");
  assert.equal(r.category, "Subscriptions");
  assert.equal(r.isSubscription, true);
});

test("merchant after 'at' with apostrophe and description after 'for'", () => {
  const r = parse("I spent $45 at Trader Joe's for groceries");
  assert.equal(r.amount, 45);
  assert.equal(r.currency, "USD");
  assert.equal(r.merchant, "Trader Joe's");
  assert.equal(r.note, "Groceries");
  assert.equal(r.category, "Groceries");
});

test("'run audit ledger' runs the audit (was: opened ledger)", () => {
  assert.deepEqual(parse("run audit ledger"), { type: "action", action: "audit" });
  assert.deepEqual(parse("run an audit"), { type: "action", action: "audit" });
});

test("navigation", () => {
  assert.deepEqual(parse("show my goals"), { type: "navigate", tab: "budgets" });
  assert.deepEqual(parse("go to ledger"), { type: "navigate", tab: "expenses" });
  assert.deepEqual(parse("open settings"), { type: "navigate", tab: "settings" });
  assert.deepEqual(parse("dashboard"), { type: "navigate", tab: "dashboard" });
  assert.deepEqual(parse("take me to the receipt scanner"), { type: "navigate", tab: "ocr" });
});

test("'log 300 for receipt printer' logs an expense (was: opened OCR)", () => {
  const r = parse("log 300 for receipt printer");
  assert.equal(r.type, "expense");
  assert.equal(r.amount, 300);
  assert.equal(r.merchant, "Receipt Printer");
});

test("relative dates (was: sent to AI chat)", () => {
  const r = parse("paid 12.50 for coffee yesterday");
  assert.equal(r.type, "expense");
  assert.equal(r.amount, 12.5);
  assert.equal(r.date, "2026-10-19");
  assert.equal(r.category, "Food & Dining");
  assert.equal(parse("spent 30 on lunch last friday").date, "2026-10-16");
  assert.equal(parse("spent 30 on lunch 3 days ago").date, "2026-10-17");
  assert.equal(parse("spent 30 on lunch on the 5th").date, "2026-10-05");
  assert.equal(parse("spent 30 on lunch on the 25th").date, "2026-09-25");
  assert.equal(parse("spent 30 on lunch october 3").date, "2026-10-03");
});

test("'bazaar' is not read as the ZAR currency", () => {
  const r = parse("spent 500 at the bazaar");
  assert.equal(r.currency, "USD");
  assert.equal(r.merchant, "Bazaar");
});

test("legacy simulator phrases still work", () => {
  const a = parse("Log 1500 INR for dinner");
  assert.equal(a.amount, 1500);
  assert.equal(a.currency, "INR");
  assert.equal(a.merchant, "Dinner");
  assert.equal(a.category, "Food & Dining");
  const b = parse("Log 50 USD for Starbucks");
  assert.equal(b.merchant, "Starbucks");
  assert.equal(b.category, "Food & Dining");
});

test("spoken amounts and payment methods", () => {
  const r = parse("uber two hundred fifty rupees with upi");
  assert.equal(r.type, "expense");
  assert.equal(r.amount, 250);
  assert.equal(r.currency, "INR");
  assert.equal(r.merchant, "Uber");
  assert.equal(r.category, "Transport");
  assert.equal(r.paymentMethod, "UPI");
  const c = parse("bought shoes for 80 euros with my credit card");
  assert.equal(c.amount, 80);
  assert.equal(c.currency, "EUR");
  assert.equal(c.paymentMethod, "Credit Card");
  assert.equal(c.category, "Shopping");
});

test("dollars follow the base currency when it is a dollar currency", () => {
  assert.equal(parse("spent 20 dollars on lunch", { baseCurrency: "CAD" }).currency, "CAD");
  assert.equal(parse("spent 20 dollars on lunch", { baseCurrency: "INR" }).currency, "USD");
  assert.equal(parse("spent 20 on lunch", { baseCurrency: "INR" }).currency, "INR");
});

test("income", () => {
  const r = parse("got paid 5000 salary");
  assert.equal(r.type, "expense");
  assert.equal(r.isIncome, true);
  assert.equal(r.category, "Salary/Income");
  assert.equal(r.amount, 5000);
});

test("goal deposits match goals fuzzily", () => {
  const r = parse("add 200 to my japan trip");
  assert.equal(r.type, "deposit");
  assert.equal(r.goalId, "g1");
  assert.equal(r.amount, 200);
  const e = parse("put 1000 in the emergency fund");
  assert.equal(e.goalId, "g2");
  const unknown = parse("save 50 into my car fund");
  assert.equal(unknown.type, "deposit");
  assert.equal(unknown.goalId, null);
});

test("budget and income settings", () => {
  assert.deepEqual(parse("set my monthly budget to 2000"), { type: "set-budget", amount: 2000, currency: "USD", category: null });
  const f = parse("set food budget to 300");
  assert.equal(f.type, "set-budget");
  assert.equal(f.category, "Food & Dining");
  assert.equal(parse("set my income to 80,000 rupees").type, "set-income");
});

test("questions are answered locally where possible", () => {
  const q = parse("how much did I spend on food this month?");
  assert.equal(q.type, "query");
  assert.equal(q.query, "spend");
  assert.equal(q.category, "Food & Dining");
  assert.equal(q.period.key, "this-month");

  const m = parse("how much have I spent at starbucks last month");
  assert.equal(m.merchant, "Starbucks");
  assert.equal(m.period.key, "last-month");

  assert.equal(parse("how much budget do I have left").query, "remaining");
  assert.equal(parse("what was my biggest expense this week").query, "biggest");
  assert.equal(parse("where does my money go").query, "top-category");
  assert.equal(parse("what subscriptions do I have").query, "subscriptions");
  assert.equal(parse("how are my goals doing").query, "goals");
  assert.equal(parse("how much did I spend today").period.key, "today");

  // "spend on <category>" wins over the subscriptions/goals listings
  const s = parse("how much did I spend on subscriptions this month");
  assert.equal(s.query, "spend");
  assert.equal(s.category, "Subscriptions");
  assert.equal(parse("how much did I spend on uber last week").merchant, "Uber"); // a known merchant wins
  assert.equal(parse("how much did I spend on taxis last week").category, "Transport");
});

test("open questions fall through to the AI coach", () => {
  const r = parse("should I invest in index funds or pay off my loan first?");
  assert.equal(r.type, "ask");
});

test("undo and cancel", () => {
  assert.equal(parse("undo").type, "undo");
  assert.equal(parse("delete the last expense").type, "undo");
  assert.equal(parse("never mind").type, "cancel");
});

test("wake word and politeness are stripped", () => {
  const r = parse("Hey SpendSense, please log 12 dollars for a sandwich at Subway");
  assert.equal(r.type, "expense");
  assert.equal(r.amount, 12);
  assert.equal(r.merchant, "Subway");
  assert.equal(r.category, "Food & Dining");
});

test("merchant classification", () => {
  const c = (t) => (N.classifyMerchant(t) || {}).category;
  assert.equal(c("Uber Eats"), "Food & Dining");
  assert.equal(c("Uber"), "Transport");
  assert.equal(c("Amazon Prime"), "Subscriptions");
  assert.equal(c("Amazon"), "Shopping");
  assert.equal(c("McDonald's"), "Food & Dining");
  assert.equal(c("Shell petrol"), "Transport");
  assert.equal(c("electricity bill"), "Utilities");
  assert.equal(c("flight tickets to Goa"), "Travel");
  assert.equal(c("Blinkit"), "Groceries");
  assert.equal(c("Netflix"), "Subscriptions");
  assert.equal(c("Apollo Pharmacy"), "Health & Fitness");
  assert.equal(c("random thing"), undefined);
  // the user's own history wins over keywords
  assert.equal(N.classifyMerchant("Uber", { uber: "Travel" }).category, "Travel");
});
