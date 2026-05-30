// Netlify Serverless Function: AI Proxy
// This function securely proxies requests to OpenRouter API
// so the API key never touches the browser.
// SECURITY: Only authenticated Firebase users can access this endpoint.

exports.handler = async (event) => {
  // Only allow POST requests
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  }

  // --- STEP 1: Verify Firebase Authentication ---
  const authHeader = event.headers["x-firebase-token"] || event.headers["X-Firebase-Token"];

  if (!authHeader) {
    return {
      statusCode: 401,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Authentication required. Please sign in to use AI features." }),
    };
  }

  // Verify the Firebase ID token using Google's Identity Toolkit REST API
  const FIREBASE_API_KEY = process.env.FIREBASE_API_KEY;

  if (!FIREBASE_API_KEY) {
    // Fallback: If FIREBASE_API_KEY env var is not set, still reject gracefully
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Server authentication not configured." }),
    };
  }

  try {
    // Call Firebase Auth REST API to verify the token
    const verifyResponse = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${FIREBASE_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken: authHeader }),
      }
    );

    if (!verifyResponse.ok) {
      return {
        statusCode: 401,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Invalid or expired session. Please sign in again." }),
      };
    }

    const verifyData = await verifyResponse.json();
    if (!verifyData.users || verifyData.users.length === 0) {
      return {
        statusCode: 401,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "User account not found. Please sign up first." }),
      };
    }

    const uid = verifyData.users[0].localId;

    // --- STEP 1.5: Enforce Daily Rate Limit (10 calls/day) ---
    // Use the user's local date to ensure it resets at their local midnight
    const localDateHeader = event.headers["x-local-date"] || event.headers["X-Local-Date"];
    const serverUtcDate = new Date().toISOString().split('T')[0];
    
    // Validate format (YYYY-MM-DD), fallback to UTC if invalid/missing
    const today = (localDateHeader && /^\d{4}-\d{2}-\d{2}$/.test(localDateHeader)) 
                  ? localDateHeader 
                  : serverUtcDate;

    const PROJECT_ID = "my-expense-tracker-50a7a";
    const usageDocUrl = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/users/${uid}/api_usage/${today}`;

    let currentUsage = 0;
    try {
      // 1. Get current usage for today
      const getUsageRes = await fetch(usageDocUrl, {
        method: "GET",
        headers: { "Authorization": `Bearer ${authHeader}` }
      });

      if (getUsageRes.ok) {
        const usageData = await getUsageRes.json();
        if (usageData.fields && usageData.fields.count && usageData.fields.count.integerValue) {
          currentUsage = parseInt(usageData.fields.count.integerValue, 10);
        }
      }

      // 2. Check limit
      if (currentUsage >= 10) {
        return {
          statusCode: 429,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ error: "You have reached your limit of 10 free AI calls for today. Please come back tomorrow!" }),
        };
      }

      // 3. Increment usage for today
      await fetch(usageDocUrl + "?updateMask.fieldPaths=count", {
        method: "PATCH",
        headers: {
          "Authorization": `Bearer ${authHeader}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          fields: {
            count: { integerValue: currentUsage + 1 }
          }
        })
      });
    } catch (limitError) {
      // Fail open: if Firestore is down, we still allow the request so we don't break the app
      console.log("Rate limiting check bypassed due to error:", limitError.message);
    }

  } catch (verifyError) {
    return {
      statusCode: 401,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Authentication verification failed." }),
    };
  }

  // --- STEP 2: Proxy request to OpenRouter (user is verified) ---
  const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

  if (!OPENROUTER_API_KEY) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "API key not configured on server" }),
    };
  }

  try {
    // Parse the incoming request body from the frontend
    const requestBody = JSON.parse(event.body);

    // Forward the request to OpenRouter API
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
        "HTTP-Referer": "https://sensespendai.netlify.app",
        "X-Title": "SpendSense AI",
      },
      body: JSON.stringify(requestBody),
    });

    const data = await response.json();

    if (!response.ok) {
      return {
        statusCode: response.status,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      };
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Internal server error: " + error.message }),
    };
  }
};
