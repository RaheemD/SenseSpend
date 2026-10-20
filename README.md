# SpendSense AI

Personal money copilot: log expenses by voice, form or receipt photo, track budgets and savings goals, and ask an AI coach that knows your numbers.

Live: https://sensespendai.netlify.app

## Project layout

| Path | What it is |
| --- | --- |
| `spendsense_ai.html` | The app's markup and styles (Tailwind via CDN) |
| `app.js` | Application logic: data, sync, rendering, AI, receipt scanner, voice assistant |
| `nlu.js` | Pure natural-language helpers used by the voice assistant (amounts, currencies, dates, categories, intents) |
| `netlify/functions/ai-proxy.js` | Authenticated, rate-limited proxy to OpenRouter |
| `tests/nlu.test.js` | Unit tests for the voice parser |

Data is stored in `localStorage` when signed out and in Cloud Firestore (`users/{uid}/…`) when signed in. Amounts keep the currency they were entered in and are converted to the display currency at live rates.

## Netlify environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `OPENROUTER_API_KEY` | yes | OpenRouter key used by the proxy |
| `FIREBASE_API_KEY` | yes | Firebase Web API key, used to verify users' ID tokens |
| `OPENROUTER_MODEL` | no | Primary model (default `anthropic/claude-haiku-5.5`) |
| `OPENROUTER_FALLBACK_MODELS` | no | Comma-separated fallbacks (default `google/gemini-3-flash-preview`) |
| `AI_DAILY_LIMIT` | no | AI requests per user per day (default `10`) |
| `FIREBASE_SERVICE_ACCOUNT` | recommended | Service-account JSON (raw or base64). When set, the daily usage counter is written with server credentials, so clients can be denied write access to it (see rules below). |

The model is chosen by the server and output tokens are capped, so signed-in users cannot use the proxy to call other models.

## Recommended Firestore rules

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{uid} {
      allow read, write: if request.auth != null && request.auth.uid == uid;

      match /{collection}/{docId} {
        allow read, write: if request.auth != null && request.auth.uid == uid && collection != 'api_usage';
      }

      // Usage counter: readable by the user, writable only by the server (requires FIREBASE_SERVICE_ACCOUNT).
      // Until the service account is configured, keep `write` allowed for the owner or AI calls will fail open.
      match /api_usage/{day} {
        allow read: if request.auth != null && request.auth.uid == uid;
      }
    }
  }
}
```

## Development

```bash
node --test tests/nlu.test.js     # voice parser tests
npx netlify dev                    # runs the site and the AI proxy locally
```

Without `netlify dev`, any static server works for everything except AI features. To call OpenRouter directly from `localhost` while developing, run `localStorage.setItem("dev_api_key", "<key>")` in the browser console.
