/*
 * SpendSense natural-language helpers.
 *
 * Pure functions (no DOM access) for:
 *   - turning spoken numbers into digits ("fifteen hundred" -> 1500, "2 lakh" -> 200000, "1,250" -> 1250)
 *   - extracting amounts, currencies, dates and payment methods from free text
 *   - categorising merchants locally (no AI call needed for well-known merchants)
 *   - detecting the intent of a voice command (log expense, deposit to goal, ask a question, navigate...)
 *
 * Exposed as window.SSNLU in the browser and module.exports in Node (for tests).
 */
(function (root) {
  "use strict";

  // ---------------------------------------------------------------------------
  // Text helpers
  // ---------------------------------------------------------------------------
  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  function normalizeText(s) {
    return String(s || "")
      .toLowerCase()
      .replace(/[‘’`´]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/\s+/g, " ")
      .trim();
  }

  const SMALL_WORDS = new Set(["and", "of", "the", "a", "an", "at", "for", "on", "in", "to", "by", "with"]);
  function titleCase(s) {
    return String(s || "")
      .split(" ")
      .filter(Boolean)
      .map((w, i) => {
        if (i > 0 && SMALL_WORDS.has(w)) return w;
        if (/^[a-z]{1,3}\.?$/.test(w) && /^(atm|upi|emi|bp|kfc|ikea|hbo|cvs|amc|pvr|irctc|dmart|tv)$/.test(w)) return w.toUpperCase();
        return w.charAt(0).toUpperCase() + w.slice(1);
      })
      .join(" ");
  }

  const pad2 = (n) => String(n).padStart(2, "0");
  const toISODate = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const addDays = (d, n) => {
    const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    x.setDate(x.getDate() + n);
    return x;
  };

  // ---------------------------------------------------------------------------
  // Merchant categorisation
  // ---------------------------------------------------------------------------
  // A leading "~" marks a generic keyword: it still matches, but loses to a specific one.
  const CATEGORY_KEYWORDS = {
    "Food & Dining": [
      "starbucks", "coffee", "cafe", "café", "restaurant", "dinner", "lunch", "breakfast", "brunch", "pizza",
      "burger", "mcdonald", "mcdonalds", "kfc", "subway", "domino", "dominos", "chipotle", "taco bell", "wendy",
      "dunkin", "tim hortons", "costa", "chai", "~tea", "~bar", "pub", "beer", "~drinks", "snacks", "~food", "meal",
      "swiggy", "zomato", "doordash", "uber eats", "ubereats", "grubhub", "deliveroo", "talabat", "foodpanda",
      "just eat", "bakery", "dessert", "ice cream", "biryani", "sushi", "takeout", "takeaway", "panera",
      "shake shack", "five guys", "haldiram", "barbeque nation", "chaayos", "blue tokai", "third wave", "nando",
      "nandos", "popeyes", "chick-fil-a", "in-n-out", "burger king", "pret", "greggs", "dining", "diner", "dosa",
      "noodles", "ramen", "shawarma", "kebab", "falafel", "boba", "bubble tea", "juice", "smoothie", "donut",
      "doughnut", "krispy kreme", "baskin robbins", "dairy queen", "pizza hut", "papa john", "little caesars",
      "olive garden", "applebee", "ihop", "denny", "cheesecake factory", "sweetgreen", "panda express",
      "wingstop", "jollibee", "hardee", "carl's jr", "costa coffee", "caribou", "peet", "philz", "eat out",
    ],
    Groceries: [
      "grocery", "groceries", "supermarket", "hypermarket", "whole foods", "trader joe", "aldi", "lidl", "kroger",
      "safeway", "costco", "tesco", "sainsbury", "asda", "waitrose", "morrisons", "carrefour", "lulu", "spinneys",
      "big bazaar", "dmart", "d-mart", "d mart", "reliance fresh", "more supermarket", "blinkit", "zepto",
      "instamart", "bigbasket", "big basket", "jiomart", "nature's basket", "star bazaar", "vegetables", "veggies",
      "fruits", "~milk", "~eggs", "~bread", "kirana", "publix", "h-e-b", "heb", "wegmans", "sprouts", "instacart",
      "fairprice", "coles", "woolworths", "countdown", "othaim", "danube", "tamimi", "nesto", "giant eagle",
      "food lion", "stop & shop", "meijer", "winco", "smart & final", "grofers", "spar", "co-op", "iceland",
    ],
    Transport: [
      "uber", "lyft", "ola", "rapido", "taxi", "cab", "careem", "bolt", "grab", "gojek", "metro", "train", "~bus",
      "fuel", "petrol", "gas station", "~gas", "diesel", "parking", "toll", "fastag", "shell", "chevron", "exxon",
      "mobil", "indian oil", "bharat petroleum", "hp petrol", "adnoc", "enoc", "rickshaw", "auto rickshaw", "mrt",
      "tube", "oyster", "transit", "commute", "car wash", "ev charging", "supercharger", "mechanic", "car service",
      "oil change", "tyre", "tire", "namma yatri", "blablacar", "lime scooter", "bird scooter", "ferry",
    ],
    Travel: [
      "flight", "flights", "airline", "airlines", "airways", "airbnb", "hotel", "booking.com", "expedia",
      "makemytrip", "make my trip", "goibibo", "cleartrip", "emirates", "indigo", "air india", "vistara",
      "spicejet", "akasa", "delta", "united airlines", "american airlines", "southwest", "ryanair", "easyjet",
      "qatar airways", "etihad", "flydubai", "air arabia", "marriott", "hilton", "hyatt", "oyo", "~trip",
      "vacation", "holiday", "resort", "visa fee", "luggage", "irctc", "agoda", "trivago", "hostel", "motel",
      "jetblue", "lufthansa", "british airways", "singapore airlines", "cathay", "klm", "air france",
    ],
    Shopping: [
      "amazon", "flipkart", "myntra", "ajio", "meesho", "nykaa", "ebay", "etsy", "target", "walmart", "best buy",
      "ikea", "zara", "h&m", "uniqlo", "nike", "adidas", "apple store", "croma", "reliance digital", "noon",
      "namshi", "shein", "temu", "aliexpress", "clothes", "clothing", "shoes", "~shirt", "~dress", "electronics",
      "gadget", "headphones", "~phone", "laptop", "~gift", "mall", "decathlon", "sephora", "macy", "nordstrom",
      "home depot", "lowe", "tj maxx", "marshalls", "primark", "argos", "john lewis", "shopping", "furniture",
      "jewellery", "jewelry", "watch", "~bag", "cosmetics", "makeup", "tanishq", "lifestyle", "westside",
      "pantaloons", "max fashion", "levi", "puma", "lenskart", "boat", "samsung store", "currys", "kohl",
      "old navy", "gap", "forever 21", "dollar tree", "dollar general", "daiso", "miniso", "toys", "hardware",
    ],
    Utilities: [
      "electricity", "electric bill", "power bill", "water bill", "gas bill", "internet", "wifi", "wi-fi",
      "broadband", "phone bill", "mobile bill", "recharge", "airtel", "jio", "vodafone", "bsnl", "verizon",
      "at&t", "t-mobile", "comcast", "xfinity", "spectrum", "etisalat", "utility", "utilities", "bescom",
      "tata power", "adani electricity", "dewa", "sewa", "pg&e", "con edison", "~bill", "dth", "tata play",
      "dish tv", "act fibernet", "hathway", "sewage", "trash", "garbage", "council tax", "postpaid", "prepaid",
      "lpg", "cylinder", "indane", "piped gas", "mahanagar gas", "octopus energy", "british gas",
    ],
    Rent: ["rent", "landlord", "lease", "mortgage", "house rent", "room rent", "pg rent", "hoa", "society maintenance"],
    Entertainment: [
      "movie", "movies", "cinema", "pvr", "inox", "amc", "imax", "concert", "~tickets", "~ticket", "ticketmaster",
      "bookmyshow", "book my show", "game", "games", "gaming", "steam", "playstation store", "xbox store",
      "nintendo", "theme park", "bowling", "museum", "~party", "club", "theatre", "theater", "~event", "~sports",
      "netflix party", "arcade", "zoo", "karaoke", "escape room", "golf", "festival", "comedy", "live show",
    ],
    Subscriptions: [
      "netflix", "spotify", "prime video", "amazon prime", "disney", "hotstar", "hulu", "hbo", "youtube premium",
      "youtube music", "apple music", "apple tv", "icloud", "google one", "chatgpt", "chat gpt", "openai",
      "claude", "anthropic", "midjourney", "notion", "dropbox", "adobe", "canva", "microsoft 365", "office 365",
      "github", "figma", "linkedin premium", "duolingo", "audible", "kindle unlimited", "patreon", "jiocinema",
      "jio cinema", "sonyliv", "sony liv", "zee5", "crunchyroll", "paramount", "peacock", "game pass",
      "playstation plus", "ps plus", "new york times", "nyt", "medium", "substack", "grammarly", "1password",
      "nordvpn", "expressvpn", "subscription", "membership", "~plan", "cursor", "perplexity", "gemini advanced",
    ],
    "Health & Fitness": [
      "gym", "fitness", "yoga", "cult.fit", "cultfit", "cult fit", "pharmacy", "medicine", "medicines",
      "medical", "doctor", "hospital", "clinic", "dentist", "dental", "apollo", "1mg", "pharmeasy", "netmeds",
      "cvs", "walgreens", "boots", "lab test", "~health", "physio", "physiotherapy", "protein", "supplements",
      "therapy", "therapist", "optician", "glasses", "peloton", "planet fitness", "gold's gym", "anytime fitness",
      "chemist", "drugstore", "vitamins", "health insurance", "massage", "spa", "salon", "haircut", "barber",
    ],
    Education: [
      "course", "udemy", "coursera", "edx", "tuition", "school", "college", "university", "books", "~book",
      "textbook", "stationery", "byju", "byjus", "unacademy", "skillshare", "masterclass", "exam fee", "~class",
      "classes", "workshop", "library", "training", "certification", "bootcamp", "school fees", "tutor",
      "kindle book", "o'reilly", "brilliant", "khan academy", "physics wallah",
    ],
    "Salary/Income": [
      "salary", "paycheck", "pay check", "payroll", "income", "bonus", "refund", "cashback", "cash back",
      "freelance", "dividend", "interest credited", "reimbursement", "stipend", "commission", "payout",
    ],
  };

  // Canonical display names for well-known merchants spoken in lowercase by speech recognition.
  const BRAND_NAMES = {
    chatgpt: "ChatGPT", "chat gpt": "ChatGPT", openai: "OpenAI", mcdonald: "McDonald's", mcdonalds: "McDonald's",
    "mcdonald's": "McDonald's", kfc: "KFC", "trader joe": "Trader Joe's", "trader joe's": "Trader Joe's",
    "uber eats": "Uber Eats", ubereats: "Uber Eats", doordash: "DoorDash", youtube: "YouTube",
    "youtube premium": "YouTube Premium", "youtube music": "YouTube Music", icloud: "iCloud", ikea: "IKEA",
    "h&m": "H&M", "best buy": "Best Buy", "whole foods": "Whole Foods", bigbasket: "BigBasket",
    "big basket": "BigBasket", makemytrip: "MakeMyTrip", "make my trip": "MakeMyTrip", bookmyshow: "BookMyShow",
    "book my show": "BookMyShow", airbnb: "Airbnb", "amazon prime": "Amazon Prime", "prime video": "Prime Video",
    hbo: "HBO", "hbo max": "HBO Max", pvr: "PVR", inox: "INOX", amc: "AMC", irctc: "IRCTC", dmart: "DMart",
    "d-mart": "DMart", "d mart": "DMart", jiomart: "JioMart", jiocinema: "JioCinema", "jio cinema": "JioCinema",
    sonyliv: "SonyLIV", "sony liv": "SonyLIV", zee5: "ZEE5", "1mg": "1mg", pharmeasy: "PharmEasy",
    cultfit: "Cult.fit", "cult fit": "Cult.fit", "cult.fit": "Cult.fit", github: "GitHub", linkedin: "LinkedIn",
    "linkedin premium": "LinkedIn Premium", nordvpn: "NordVPN", expressvpn: "ExpressVPN", cvs: "CVS",
    "at&t": "AT&T", "t-mobile": "T-Mobile", "pg&e": "PG&E", "tj maxx": "TJ Maxx", "booking.com": "Booking.com",
    "7-eleven": "7-Eleven", "7 eleven": "7-Eleven", bp: "BP", adnoc: "ADNOC", enoc: "ENOC", zepto: "Zepto",
    ps: "PS", "ps plus": "PS Plus", nyt: "NYT", flydubai: "flydubai", easyjet: "easyJet", ola: "Ola",
  };

  const KEYWORD_INDEX = [];
  for (const [category, words] of Object.entries(CATEGORY_KEYWORDS)) {
    for (let word of words) {
      const generic = word.startsWith("~");
      if (generic) word = word.slice(1);
      KEYWORD_INDEX.push({
        word,
        category,
        score: word.length * (generic ? 0.4 : 1),
        re: new RegExp(`(?:^|[^a-z0-9])${escapeRe(word)}(?:'?s|es)?(?=[^a-z0-9]|$)`),
      });
    }
  }

  const merchantKey = (s) =>
    normalizeText(s)
      .replace(/[^a-z0-9&' ]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  /**
   * Categorise a merchant/description.
   * @param {string} text  merchant name and/or note
   * @param {Object<string,string>} [memory]  merchantKey -> category learned from the user's own ledger
   * @returns {{category:string, source:'history'|'keyword', keyword?:string}|null}
   */
  function classifyMerchant(text, memory) {
    const t = normalizeText(text);
    if (!t) return null;
    if (memory) {
      const key = merchantKey(t);
      if (memory[key]) return { category: memory[key], source: "history" };
    }
    let best = null;
    for (const k of KEYWORD_INDEX) {
      if (k.re.test(t) && (!best || k.score > best.score)) best = k;
    }
    return best ? { category: best.category, source: "keyword", keyword: best.word } : null;
  }

  function canonicalMerchant(name) {
    const key = normalizeText(name);
    if (BRAND_NAMES[key]) return BRAND_NAMES[key];
    return titleCase(key).replace(/(\w)'S\b/g, "$1's");
  }

  // ---------------------------------------------------------------------------
  // Numbers
  // ---------------------------------------------------------------------------
  const UNITS = {
    zero: 0, oh: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
    eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
    nineteen: 19,
  };
  const TENS = { twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
  const SCALES = {
    hundred: 100, thousand: 1e3, grand: 1e3, lakh: 1e5, lakhs: 1e5, lac: 1e5, lacs: 1e5, million: 1e6,
    millions: 1e6, crore: 1e7, crores: 1e7, billion: 1e9,
  };
  const isNumberWord = (w) => w in UNITS || w in TENS || w in SCALES;

  /** Converts spoken numbers into digits inside a sentence. */
  function wordsToNumbers(input) {
    let s = normalizeText(input);
    s = s.replace(/(\d),(?=\d)/g, "$1"); // 1,250 -> 1250 and 1,25,000 -> 125000
    s = s.replace(/(\d+(?:\.\d+)?)\s?k\b/g, (m, n) => String(Math.round(parseFloat(n) * 1000 * 100) / 100));
    s = s.replace(/\b([a-z]+)-([a-z]+)\b/g, (m, a, b) => (isNumberWord(a) && isNumberWord(b) ? `${a} ${b}` : m));

    const tokens = s.split(" ");
    const out = [];
    let i = 0;
    while (i < tokens.length) {
      const tok = tokens[i];
      const startsWithDigit = /^\d+(\.\d+)?$/.test(tok);
      const startsWithWord = isNumberWord(tok) || (tok === "a" && tokens[i + 1] in SCALES);
      if (!startsWithDigit && !startsWithWord) {
        out.push(tok);
        i += 1;
        continue;
      }

      let total = 0;
      let current = 0;
      let lastKind = null; // 'unit' | 'tens' | 'scale' | 'digit'
      let j = i;
      let consumed = 0;
      while (j < tokens.length) {
        const w = tokens[j];
        if (j === i && /^\d+(\.\d+)?$/.test(w)) {
          current = parseFloat(w);
          lastKind = "digit";
        } else if (w === "a" && j === i && tokens[j + 1] in SCALES) {
          current = 1;
          lastKind = "unit";
        } else if (w in UNITS) {
          if (lastKind === "unit" || lastKind === "digit" || (lastKind === "tens" && false)) break;
          if (lastKind === "tens" && current % 10 !== 0) break;
          current += UNITS[w];
          lastKind = "unit";
        } else if (w in TENS) {
          if (lastKind === "unit" || lastKind === "tens" || lastKind === "digit") break;
          current += TENS[w];
          lastKind = "tens";
        } else if (w in SCALES) {
          if (lastKind === null) break;
          const scale = SCALES[w];
          if (scale === 100) {
            current = (current || 1) * 100;
          } else {
            total += (current || 1) * scale;
            current = 0;
          }
          lastKind = "scale";
        } else if (w === "and" && consumed > 0 && j + 1 < tokens.length && (tokens[j + 1] in UNITS || tokens[j + 1] in TENS)) {
          // "one hundred and fifty"
        } else if (w === "point" && consumed > 0 && j + 1 < tokens.length && tokens[j + 1] in UNITS) {
          let decimals = "";
          let k = j + 1;
          while (k < tokens.length && tokens[k] in UNITS && UNITS[tokens[k]] < 10) {
            decimals += String(UNITS[tokens[k]]);
            k += 1;
          }
          if (decimals) {
            current += parseFloat(`0.${decimals}`);
            j = k;
            consumed += 1;
            break;
          }
          break;
        } else {
          break;
        }
        j += 1;
        consumed += 1;
      }
      if (consumed === 0) {
        out.push(tok);
        i += 1;
        continue;
      }
      out.push(String(Math.round((total + current) * 100) / 100));
      i = j;
    }
    return out.join(" ");
  }

  // ---------------------------------------------------------------------------
  // Currencies
  // ---------------------------------------------------------------------------
  const DOLLAR_CURRENCIES = ["USD", "CAD", "AUD", "SGD", "NZD"];
  const CURRENCY_WORDS = [
    // [pattern, code | function(base) -> code]
    [/us ?dollars?|usd|us\$/, "USD"],
    [/canadian dollars?|cad|ca\$/, "CAD"],
    [/australian dollars?|aud|a\$/, "AUD"],
    [/singapore dollars?|sgd|s\$/, "SGD"],
    [/new zealand dollars?|nzd|nz\$/, "NZD"],
    [/dollars?|bucks?|\$/, (base) => (DOLLAR_CURRENCIES.includes(base) ? base : "USD")],
    [/rupees?|rupaye|rs\.?|inr|₹/, "INR"],
    [/euros?|eur|€/, "EUR"],
    [/pounds?|quid|gbp|sterling|£/, "GBP"],
    [/yen|jpy/, "JPY"],
    [/yuan|rmb|renminbi|cny|元/, "CNY"],
    [/¥/, (base) => (base === "CNY" ? "CNY" : "JPY")],
    [/dirhams?|aed|dhs?/, "AED"],
    [/omani rials?|omr|rials?/, "OMR"],
    [/saudi riyals?|riyals?|sar/, "SAR"],
    [/swiss francs?|francs?|chf/, "CHF"],
    [/rand|zar/, "ZAR"],
    [/roubles?|rubles?|rub|₽/, "RUB"],
    [/pesos?|php|₱/, "PHP"],
    [/reais|real|brl|r\$/, "BRL"],
    [/baht|thb|฿/, "THB"],
    [/ringgit|myr|rm/, "MYR"],
    [/danish kroner?|dkk/, "DKK"],
    [/swedish kronor|kronor|krona|sek/, "SEK"],
    [/norwegian kroner?|kroner|krone|nok|kr/, "NOK"],
  ];
  const CURRENCY_ALT = CURRENCY_WORDS.map(([re]) => re.source).join("|");
  const resolveCurrency = (word, base) => {
    for (const [re, code] of CURRENCY_WORDS) {
      if (new RegExp(`^(?:${re.source})$`).test(word)) return typeof code === "function" ? code(base) : code;
    }
    return null;
  };

  /**
   * Finds the spend amount in a (digit-normalised) sentence.
   * Prefers numbers attached to a currency ("$45", "1500 rupees"), skips ordinals, times and percentages.
   * @returns {{amount:number, currency:string|null, raw:string}|null}
   */
  function extractAmount(text, base) {
    const t = ` ${text} `;
    const num = "(\\d+(?:\\.\\d{1,3})?)";
    const before = new RegExp(`(?:^|[\\s(])(${CURRENCY_ALT})\\s?${num}(?![\\d.]|st\\b|nd\\b|rd\\b|th\\b|%)`, "i");
    const after = new RegExp(`(?:^|[\\s(])${num}\\s?(${CURRENCY_ALT})(?=[\\s.,!?)]|$)`, "i");

    const mBefore = t.match(before);
    if (mBefore) {
      const currency = resolveCurrency(mBefore[1], base);
      if (currency) return { amount: parseFloat(mBefore[2]), currency, raw: mBefore[0].trim() };
    }
    const mAfter = t.match(after);
    if (mAfter) {
      const currency = resolveCurrency(mAfter[2], base);
      if (currency) return { amount: parseFloat(mAfter[1]), currency, raw: mAfter[0].trim() };
    }
    const bare = /(?:^|[\s(])(\d+(?:\.\d{1,3})?)(?![\d.]|\s?%|st\b|nd\b|rd\b|th\b|\s?(?:am|pm|o'clock|days?|weeks?|months?|years?|hours?|minutes?|percent)\b)/i;
    const mBare = t.match(bare);
    if (mBare) return { amount: parseFloat(mBare[1]), currency: null, raw: mBare[1] };
    return null;
  }

  // ---------------------------------------------------------------------------
  // Dates
  // ---------------------------------------------------------------------------
  const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
  const MONTH_ALT = MONTHS.join("|") + "|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec";
  const monthIndex = (m) => MONTHS.findIndex((full) => full.startsWith(m.slice(0, 3)));

  /**
   * Extracts a past date ("yesterday", "last friday", "3 days ago", "on the 5th", "october 3").
   * @returns {{date:string, match:string}|null}
   */
  function extractDate(text, today) {
    const now = today || new Date();
    const t = normalizeText(text);
    let m;

    if ((m = t.match(/\b(?:on\s+)?(?:the\s+)?day before yesterday\b/))) return { date: toISODate(addDays(now, -2)), match: m[0] };
    if ((m = t.match(/\b(?:on\s+)?yesterday(?:\s+(?:morning|afternoon|evening|night))?\b|\blast night\b/))) return { date: toISODate(addDays(now, -1)), match: m[0] };
    if ((m = t.match(/\b(\d+|a|an|one|two|three|four|five|six|seven)\s+(day|days|week|weeks)\s+ago\b/))) {
      const n = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7 }[m[1]] || parseInt(m[1], 10);
      return { date: toISODate(addDays(now, -n * (m[2].startsWith("week") ? 7 : 1))), match: m[0] };
    }
    if ((m = t.match(new RegExp(`\\b(?:on\\s+|last\\s+|this past\\s+|past\\s+)?(${WEEKDAYS.join("|")})(?:\\s+(?:morning|afternoon|evening|night))?\\b`)))) {
      const target = WEEKDAYS.indexOf(m[1]);
      let diff = (now.getDay() - target + 7) % 7;
      if (diff === 0 && /\blast\b/.test(m[0])) diff = 7;
      return { date: toISODate(addDays(now, -diff)), match: m[0] };
    }
    const resolveDay = (day, month) => {
      let year = now.getFullYear();
      let monthIdx = month === null ? now.getMonth() : month;
      let d = new Date(year, monthIdx, day);
      if (d > now) {
        if (month === null) d = new Date(year, monthIdx - 1, day);
        else d = new Date(year - 1, monthIdx, day);
      }
      return d.getDate() === day ? toISODate(d) : null;
    };
    if ((m = t.match(new RegExp(`\\b(?:on\\s+)?(?:the\\s+)?(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${MONTH_ALT})\\b`)))) {
      const iso = resolveDay(parseInt(m[1], 10), monthIndex(m[2]));
      if (iso) return { date: iso, match: m[0] };
    }
    if ((m = t.match(new RegExp(`\\b(?:on\\s+)?(${MONTH_ALT})\\s+(?:the\\s+)?(\\d{1,2})(?:st|nd|rd|th)?\\b`)))) {
      const iso = resolveDay(parseInt(m[2], 10), monthIndex(m[1]));
      if (iso) return { date: iso, match: m[0] };
    }
    if ((m = t.match(/\bon\s+the\s+(\d{1,2})(?:st|nd|rd|th)?\b|\bthe\s+(\d{1,2})(?:st|nd|rd|th)\b/))) {
      const iso = resolveDay(parseInt(m[1] || m[2], 10), null);
      if (iso) return { date: iso, match: m[0] };
    }
    if ((m = t.match(/\b(?:today|tonight|this (?:morning|afternoon|evening))\b/))) return { date: toISODate(now), match: m[0] };
    return null;
  }

  /** Detects a reporting period for questions like "how much did I spend last week". */
  function detectPeriod(text, today) {
    const now = today || new Date();
    const t = normalizeText(text);
    const iso = toISODate;
    const startOfWeek = (d) => addDays(d, -((d.getDay() + 6) % 7)); // Monday
    let m;
    if (/\btoday\b/.test(t)) return { key: "today", label: "today", start: iso(now), end: iso(now) };
    if (/\byesterday\b/.test(t)) {
      const y = addDays(now, -1);
      return { key: "yesterday", label: "yesterday", start: iso(y), end: iso(y) };
    }
    if (/\blast week\b|\bprevious week\b/.test(t)) {
      const s = addDays(startOfWeek(now), -7);
      return { key: "last-week", label: "last week", start: iso(s), end: iso(addDays(s, 6)) };
    }
    if (/\bthis week\b|\bweek so far\b/.test(t)) return { key: "this-week", label: "this week", start: iso(startOfWeek(now)), end: iso(now) };
    if ((m = t.match(/\b(?:last|past|previous)\s+(\d+)\s+days\b/))) {
      const n = parseInt(m[1], 10);
      return { key: "last-n-days", label: `in the last ${n} days`, start: iso(addDays(now, -(n - 1))), end: iso(now) };
    }
    if (/\blast month\b|\bprevious month\b/.test(t)) {
      const s = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const e = new Date(now.getFullYear(), now.getMonth(), 0);
      return { key: "last-month", label: "last month", start: iso(s), end: iso(e) };
    }
    if (/\bthis year\b|\bso far this year\b|\byear to date\b/.test(t)) {
      return { key: "this-year", label: "this year", start: `${now.getFullYear()}-01-01`, end: iso(now) };
    }
    if ((m = t.match(new RegExp(`\\b(?:in|during|for)\\s+(${MONTHS.join("|")})\\b`)))) {
      const idx = MONTHS.indexOf(m[1]);
      const year = idx > now.getMonth() ? now.getFullYear() - 1 : now.getFullYear();
      const s = new Date(year, idx, 1);
      const e = new Date(year, idx + 1, 0);
      return { key: "month", label: `in ${MONTHS[idx][0].toUpperCase()}${MONTHS[idx].slice(1)}`, start: iso(s), end: iso(e) };
    }
    const s = new Date(now.getFullYear(), now.getMonth(), 1);
    return { key: "this-month", label: "this month", start: iso(s), end: iso(now) };
  }

  // ---------------------------------------------------------------------------
  // Payment methods
  // ---------------------------------------------------------------------------
  const PAYMENT_PATTERNS = [
    [/\b(?:(?:with|using|via|by|through|on|from)\s+)?(?:my\s+|a\s+)?credit card\b/, "Credit Card"],
    [/\b(?:(?:with|using|via|by|through|on|from)\s+)?(?:my\s+|a\s+)?debit card\b/, "Debit Card"],
    [/\b(?:(?:with|using|via|by|through|on)\s+)?apple pay\b/, "Apple Pay"],
    [/\b(?:(?:with|using|via|by|through|on)\s+)?(?:google pay|gpay|g pay)\b/, "Google Pay"],
    [/\b(?:(?:with|using|via|by|through|on)\s+)?(?:upi|paytm|phonepe|phone pe|bhim)\b/, "UPI"],
    [/\b(?:(?:with|using|via|by|through|in|on)\s+)?(?:bank transfer|net ?banking|neft|imps|wire transfer)\b/, "Bank Transfer"],
    [/\b(?:(?:with|using|via|by|through|in|paid)\s+)cash\b|\bcash\b(?=\s*$)/, "Cash"],
    [/\b(?:with|using|via|by|on)\s+(?:my\s+|a\s+)?card\b/, "Credit Card"],
  ];
  function extractPayment(text) {
    const t = normalizeText(text);
    for (const [re, method] of PAYMENT_PATTERNS) {
      const m = t.match(re);
      if (m) return { method, match: m[0] };
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Category names (for budgets and questions such as "how much on food")
  // ---------------------------------------------------------------------------
  const CATEGORY_SYNONYMS = [
    ["Food & Dining", /\b(food|dining|eating out|restaurants?|takeout|takeaway|coffee|meals?)\b/],
    ["Groceries", /\b(groceries|grocery|supermarket)\b/],
    ["Shopping", /\b(shopping|clothes|clothing|amazon|online shopping)\b/],
    ["Transport", /\b(transport|transportation|commute|commuting|uber|taxi|cabs?|fuel|petrol|gas)\b/],
    ["Travel", /\b(travel|trips?|flights?|hotels?|vacations?|holidays?)\b/],
    ["Utilities", /\b(utilities|utility|bills?|electricity|internet|phone bill)\b/],
    ["Rent", /\b(rent|housing|mortgage)\b/],
    ["Entertainment", /\b(entertainment|fun|movies?|games?|gaming|going out)\b/],
    ["Health & Fitness", /\b(health|fitness|gym|medical|medicine|pharmacy|doctor)\b/],
    ["Education", /\b(education|books?|courses?|school|tuition|learning)\b/],
    ["Subscriptions", /\b(subscriptions?|streaming|memberships?)\b/],
    ["Miscellaneous", /\b(misc|miscellaneous|other)\b/],
  ];
  function detectCategoryName(text) {
    const t = normalizeText(text);
    for (const [cat, re] of CATEGORY_SYNONYMS) if (re.test(t)) return cat;
    return null;
  }

  // ---------------------------------------------------------------------------
  // Goals
  // ---------------------------------------------------------------------------
  const tokenize = (s) =>
    normalizeText(s)
      .replace(/[^a-z0-9 ]/g, " ")
      .split(" ")
      .filter((w) => w && !["my", "the", "a", "an", "goal", "fund", "savings", "saving", "for", "to"].includes(w));

  function matchGoal(phrase, goals) {
    if (!phrase || !Array.isArray(goals) || goals.length === 0) return null;
    const words = tokenize(phrase);
    if (!words.length) return null;
    let best = null;
    for (const g of goals) {
      const gw = tokenize(g.name);
      if (!gw.length) continue;
      const common = gw.filter((w) => words.some((p) => p === w || (p.length > 3 && (w.startsWith(p) || p.startsWith(w)))));
      const score = common.length / Math.max(1, Math.min(gw.length, words.length));
      if (score >= 0.5 && (!best || score > best.score)) best = { goal: g, score };
    }
    return best ? best.goal : null;
  }

  // ---------------------------------------------------------------------------
  // Intent detection
  // ---------------------------------------------------------------------------
  const PAGES = [
    ["dashboard", /\b(dashboard|home|overview|main screen|summary page)\b/],
    ["expenses", /\b(ledger|expenses|expense list|transactions|history|records|statement)\b/],
    ["ocr", /\b(scan|scanner|receipts?|ocr|camera)\b/],
    ["coach", /\b(coach|chat|assistant|advisor|copilot)\b/],
    ["budgets", /\b(budgets?|goals?|limits?|milestones?|savings)\b/],
    ["settings", /\b(settings|preferences|tools|account|profile|currency)\b/],
  ];

  function parseNavigation(t) {
    if (/\b(run|start|do|perform|generate|give me|show me)\b.*\baudit\b|^audit\b|\baudit (my|the)\b/.test(t)) return { type: "action", action: "audit" };
    if (/\b(scan|upload|photograph|take a (photo|picture) of)\b.*\b(receipt|bill|invoice)\b/.test(t)) return { type: "action", action: "scan" };
    if (/^(?:please\s+)?(?:add|new|create|log|record|enter)\s+(?:an?\s+|new\s+)*(?:expense|transaction|purchase|entry)$/.test(t)) return { type: "action", action: "add-expense" };
    if (/^(?:add|new|create|set up|start)\s+(?:an?\s+|new\s+)*(?:savings\s+)?goal$/.test(t)) return { type: "action", action: "add-goal" };
    if (/^(?:add|new|create|set)\s+(?:an?\s+|new\s+)*(?:category\s+)?(?:budget|limit)$/.test(t)) return { type: "action", action: "add-budget" };
    if (/\b(export|download)\b.*\b(csv|data|ledger|expenses|transactions|report)\b/.test(t)) return { type: "action", action: "export" };

    const hasVerb = /^(?:go to|goto|go back to|open|show|show me|take me to|switch to|navigate to|view|display|bring up|see)\b/.test(t);
    const bare = /^(?:my\s+|the\s+)?[a-z]+(?:\s+(?:page|tab|screen|section))?$/.test(t);
    if (!hasVerb && !bare) return null;
    for (const [tab, re] of PAGES) if (re.test(t)) return { type: "navigate", tab };
    return null;
  }

  function parseQuery(t, ctx) {
    const period = detectPeriod(t, ctx.today);
    // "how much did I spend on <X>" is always a spending question, whatever X is
    const spendOn = /\b(?:how much|what)\b.*\b(?:spen[dt]|spending|paid|pay)\b.*\b(?:on|at|for)\b/.test(t);
    if (!spendOn && /\b(subscriptions?|recurring|auto ?pay|renewals?)\b/.test(t)) return { type: "query", query: "subscriptions", period };
    if (!spendOn && /\bgoals?\b/.test(t)) return { type: "query", query: "goals", period };
    if (/\bsavings? rate\b|\bhow much (?:did|have|can|will) i (?:save|saved)\b|\bam i saving\b/.test(t)) return { type: "query", query: "savings", period };
    if (/\b(budget|left to spend|remaining|left over|leftover|afford|can i (?:still )?spend|safe to spend|allowance|how much (?:do i have|is) left|how much left)\b/.test(t)) {
      return { type: "query", query: "remaining", period, category: detectCategoryName(t.replace(/\bbudget\b/g, "")) };
    }
    if (/\b(biggest|largest|most expensive|highest|top|priciest)\b.*\b(expenses?|purchases?|transactions?|spends?|payments?|bills?)\b/.test(t)) return { type: "query", query: "biggest", period };
    if (/\bwhere\b.*\b(most|money go)\b|\btop (?:spending )?categor|\bwhich categor|\bwhat (?:do|did) i spend (?:the )?most on\b|\bbreakdown\b/.test(t)) return { type: "query", query: "top-category", period };
    if (/\b(income|earned|earnings|salary)\b/.test(t)) return { type: "query", query: "income", period };
    if (/^(?:should|why|could|would|is it)\b|\b(?:advice|tips?|recommend|invest|investing)\b/.test(t)) return null;
    if (/\bhow much\b/.test(t) || (/\b(?:spent|spend|spending|expenses)\b/.test(t) && /\b(?:did|have|do|my|total|what|show)\b/.test(t))) {
      let subject = null;
      const m = t.match(/\b(?:on|at|for|in)\s+(?!(?:this|last|the past|past|today|yesterday)\b)(.+?)(?:\s+(?:this|last|in|during|today|yesterday|so far|over)\b.*)?$/);
      if (m) subject = m[1].replace(/^(?:the|my)\s+/, "").trim();
      let merchant = null;
      let category = null;
      if (subject) {
        const known = (ctx.merchants || []).find((name) => merchantKey(name).includes(merchantKey(subject)) && merchantKey(subject).length > 2);
        if (known) merchant = known;
        else category = detectCategoryName(subject) || (classifyMerchant(subject) || {}).category || null;
      }
      return { type: "query", query: "spend", period, category, merchant };
    }
    return null;
  }

  const EXPENSE_VERBS = /\b(?:i|we|just|have|had|log|logged|logging|add|added|record|recorded|spent|spend|spending|paid|pay|paying|bought|buy|buying|purchased|purchase|ordered|order|got|an expense of|expense of|expense|cost me|costs?|was|for a total of|total of)\b/g;

  function cleanPhrase(s) {
    return String(s || "")
      .replace(/^[\s,.-]+|[\s,.-]+$/g, "")
      .replace(/^(?:the|a|an|my|some|our|about|around|like|and|on|for|at)\s+/g, "")
      .replace(/\s+(?:and|for|at|on|the|a)$/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function buildExpenseIntent(t, amt, ctx, dateInfo) {
    let rest = ` ${t} `;
    rest = rest.replace(` ${amt.raw} `, " ").replace(amt.raw, " ");
    if (dateInfo) rest = rest.replace(dateInfo.match, " ");
    const payment = extractPayment(rest);
    if (payment) rest = rest.replace(payment.match, " ");

    const isIncome = ctx.isIncome === true;
    let isSubscription = /\b(subscription|subscriptions|membership|monthly plan|annual plan|renewal|recurring)\b/.test(rest);
    rest = rest.replace(EXPENSE_VERBS, " ").replace(/\b(?:got paid|received|receive|earned|credited|deposited)\b/g, " ");
    rest = rest.replace(/\s+/g, " ").trim();

    // Split on preposition markers: "at X", "from X", "to X" name the merchant; "for X", "on X" describe it.
    const segments = { lead: [] };
    let current = "lead";
    for (const w of rest.split(" ")) {
      if (["at", "from", "to", "for", "on", "towards", "in"].includes(w) && current !== w) {
        current = w;
        segments[current] = segments[current] || [];
        continue;
      }
      (segments[current] = segments[current] || []).push(w);
    }
    const seg = (k) => cleanPhrase((segments[k] || []).join(" "));
    const place = seg("at") || seg("from") || seg("to") || seg("in");
    const purpose = seg("for") || seg("on") || seg("towards");
    const lead = seg("lead");

    let merchant = place || purpose || lead;
    let note = place ? purpose || lead : purpose && lead ? lead : "";
    if (isSubscription) {
      merchant = merchant.replace(/\s*\b(subscription|membership|monthly plan|annual plan|renewal)\b\s*/g, " ").trim() || merchant;
      if (!note) note = "Subscription";
    }
    merchant = merchant ? canonicalMerchant(merchant) : "";
    note = note ? note.charAt(0).toUpperCase() + note.slice(1) : "";

    let category;
    if (isIncome) category = "Salary/Income";
    else {
      const guess = classifyMerchant(`${merchant} ${note}`, ctx.memory);
      category = guess ? guess.category : isSubscription ? "Subscriptions" : "Miscellaneous";
      if (isSubscription && category !== "Subscriptions" && ["Entertainment", "Miscellaneous", "Education"].includes(category)) category = "Subscriptions";
      if (category === "Subscriptions") isSubscription = true;
      if (category === "Salary/Income") category = "Miscellaneous";
    }

    return {
      type: "expense",
      amount: amt.amount,
      currency: amt.currency || ctx.baseCurrency || "USD",
      merchant,
      note,
      category,
      date: dateInfo ? dateInfo.date : toISODate(ctx.today || new Date()),
      paymentMethod: payment ? payment.method : null,
      isSubscription,
      isIncome,
    };
  }

  /**
   * Detects what a spoken/typed command wants.
   * @param {string} rawText
   * @param {{baseCurrency?:string, goals?:Array<{id:string,name:string}>, merchants?:string[],
   *          memory?:Object<string,string>, today?:Date}} [ctx]
   */
  function parseVoiceIntent(rawText, ctx) {
    ctx = ctx || {};
    const base = ctx.baseCurrency || "USD";
    let t = normalizeText(rawText)
      .replace(/^(?:hey |hi |ok |okay )?(?:spend ?sense|spendsense)(?: ai)?[,:]?\s*/, "")
      .replace(/^(?:please|can you|could you|would you|will you|i want to|i'd like to|i would like to|let's|lets|i need to)\s+/, "")
      .replace(/\s+please$/, "")
      .replace(/[?!]+$/, "")
      .replace(/\.$/, "")
      .trim();
    if (!t) return { type: "none" };

    const raw = String(rawText || "").trim();
    t = wordsToNumbers(t);

    if (/^(?:cancel|never ?mind|stop|close|exit|nothing|no|no thanks|forget it|dismiss)$/.test(t)) return { type: "cancel" };
    if (/^undo(?: that| it)?$/.test(t) || /\b(?:undo|delete|remove|cancel)\b.*\b(?:last|previous|latest|most recent)\b.*\b(?:expense|transaction|entry|one|purchase|log)?\b/.test(t)) {
      return { type: "undo" };
    }

    const dateInfo = extractDate(t, ctx.today);
    const withoutDate = dateInfo ? t.replace(dateInfo.match, " ").replace(/\s+/g, " ").trim() : t;
    const amt = extractAmount(withoutDate, base);
    const isQuestion =
      /^(?:how|what|what's|whats|where|which|when|who|why|am i|did i|do i|have i|has|is my|is there|are my|are there|can i|could i|should i|tell me|show me how|give me|list|summari[sz]e)\b/.test(t) ||
      /\?\s*$/.test(raw);
    const withCurrency = (a) => ({ amount: a.amount, currency: a.currency || base });

    if (amt && !isQuestion) {
      // Budgets: "set my budget to 2000", "set food budget to 300", "budget 500 for groceries"
      if (/\b(?:set|change|update|make|increase|decrease|raise|lower)\b.*\b(?:budget|limit)\b|\b(?:budget|limit)\b.*\b(?:to|at|of|is)\b|^(?:monthly )?budget\b/.test(t)) {
        const category = /\b(?:monthly|overall|total|whole|month)\b/.test(t) ? null : detectCategoryName(t.replace(/\b(budget|limit|monthly|set|my|the|to)\b/g, " "));
        return { type: "set-budget", ...withCurrency(amt), category };
      }
      // Income setting: "set my income to 5000", "my salary is 80000"
      if (/\b(?:set|change|update)\b.*\b(?:income|salary)\b|\bmy (?:monthly )?(?:income|salary) is\b/.test(t)) {
        return { type: "set-income", ...withCurrency(amt) };
      }
      // Goal deposit: "add 200 to my japan trip", "put 500 into savings"
      if (/\b(?:add|put|deposit|save|saved|move|moved|transfer|transferred|stash|contribute|allocate|set aside)\b/.test(t)) {
        const m = withoutDate.match(/\b(?:to|into|towards|toward|in|for)\s+(?:my\s+|the\s+)?(.+?)$/);
        const goal = m ? matchGoal(m[1], ctx.goals) : null;
        if (goal || /\b(?:goal|goals|fund|savings|saving|piggy bank|emergency fund|rainy day)\b/.test(t)) {
          return {
            type: "deposit",
            ...withCurrency(amt),
            goalId: goal ? goal.id : null,
            goalName: goal ? goal.name : m ? canonicalMerchant(cleanPhrase(m[1].replace(/\b(goal|fund)\b/g, ""))) : "",
          };
        }
      }
      // Income: "got paid 5000", "received 300 refund from amazon"
      if (/\b(?:got paid|get paid|received|receive|earned|earn|credited|paycheck|salary|bonus|refund|cashback|cash back|income)\b/.test(t) && !/\b(?:spent|spend|bought|buy|paid for)\b/.test(t)) {
        return buildExpenseIntent(withoutDate, amt, { ...ctx, isIncome: true }, dateInfo);
      }
    }

    if (isQuestion || (!amt && /\b(?:how much|total|summary|breakdown|left|remaining)\b/.test(t))) {
      const q = parseQuery(t, ctx);
      if (q) return q;
    }

    const nav = parseNavigation(t);
    if (nav && !amt) return nav;

    if (amt && !isQuestion) return buildExpenseIntent(withoutDate, amt, ctx, dateInfo);

    return { type: "ask", text: raw };
  }

  const api = {
    normalizeText,
    titleCase,
    canonicalMerchant,
    merchantKey,
    classifyMerchant,
    wordsToNumbers,
    extractAmount,
    extractDate,
    detectPeriod,
    extractPayment,
    detectCategoryName,
    matchGoal,
    parseVoiceIntent,
    toISODate,
    CATEGORY_KEYWORDS,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.SSNLU = api;
})(typeof window !== "undefined" ? window : globalThis);
