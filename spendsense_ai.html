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
