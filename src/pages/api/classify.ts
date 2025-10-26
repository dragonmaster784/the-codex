import type { APIRoute } from "astro";

export const prerender = false; // Essential for server-side processing of dynamic requests

// Simple in-memory cache for the regulation HTML to avoid refetching on every request
let regulationHtmlCache: { content: string; timestamp: number } | null = null;
const CACHE_DURATION = 1000 * 60 * 60 * 24; // 24 hours

async function getRegulationHtml(): Promise<string> {
  const regUrl =
    "https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX%3A02021R0821-20241108";

  if (
    regulationHtmlCache &&
    Date.now() - regulationHtmlCache.timestamp < CACHE_DURATION
  ) {
    console.log("Using cached EU Dual-Use Regulation HTML.");
    return regulationHtmlCache.content;
  }

  console.log("Fetching EU Dual-Use Regulation HTML...");
  try {
    const response = await fetch(regUrl);
    if (!response.ok) {
      throw new Error(
        `Failed to fetch EU Regulation: ${response.status} ${response.statusText}`,
      );
    }
    const html = await response.text();
    regulationHtmlCache = { content: html, timestamp: Date.now() };
    console.log("EU Dual-Use Regulation HTML fetched and cached.");
    return html;
  } catch (error) {
    console.error("Error fetching EU Dual-Use Regulation HTML:", error);
    throw error;
  }
}

export const POST: APIRoute = async ({ request }) => {
  if (request.headers.get("Content-Type") !== "application/json") {
    return new Response(JSON.stringify({ error: "Expected JSON body." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  let requestBody;
  try {
    requestBody = await request.json();
  } catch (e) {
    return new Response(JSON.stringify({ error: "Invalid JSON body." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const productName = requestBody.product?.trim() || "";
  const hsCode = requestBody.hs_code?.trim() || "";

  if (!productName && !hsCode) {
    return new Response(
      JSON.stringify({ error: "Either product name or HS code is required." }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  const regUrl =
    "https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX%3A02021R0821-20241108";

  try {
    const html = await getRegulationHtml();
    const htmlLower = html.toLowerCase();

    let status: "Restricted" | "Permitted" | "Conditional" = "Permitted";
    let overall: "NO" | "AMBER" | "GREEN" = "GREEN";
    let snippet = "Not found in Annex I text.";
    let legalCitation = "Regulation (EU) 2021/821 Annex I"; // Default citation

    const searchNeedle = (hsCode || productName).toLowerCase();

    // Basic search logic: prefer exact HS code matches, then product name
    // This is a very basic text search for MVP. Enhancements are needed for robust parsing.
    let matchFound = false;

    // Prioritize HS code exact match if provided
    if (hsCode) {
      // Regex for HS codes with optional periods for flexibility (e.g., 8486.90 or 848690)
      const hsCodePattern = new RegExp(
        `\\b${hsCode.replace(".", "\\.?")}\\b`,
        "i",
      );
      if (hsCodePattern.test(htmlLower)) {
        matchFound = true;
        status = "Restricted";
        overall = "NO"; // Red for controlled
        const matchIndex = htmlLower.search(hsCodePattern);
        snippet = html.substring(
          matchIndex > 50 ? matchIndex - 50 : 0,
          matchIndex + 150,
        );
        // Clean up snippet (remove newlines, extra spaces)
        snippet = snippet.replace(/\s+/g, " ").trim();
      }
    }

    // If no HS code match or no HS code provided, try product name keyword search
    if (!matchFound && productName) {
      if (htmlLower.includes(productName.toLowerCase())) {
        matchFound = true;
        // For keyword search, lean towards YES IF as it's less precise
        status = "Conditional";
        overall = "AMBER"; // Amber for potentially controlled
        const matchIndex = htmlLower.indexOf(productName.toLowerCase());
        snippet = html.substring(
          matchIndex > 50 ? matchIndex - 50 : 0,
          matchIndex + 150,
        );
        // Clean up snippet
        snippet = snippet.replace(/\s+/g, " ").trim();
      }
    }

    return new Response(
      JSON.stringify({
        product: productName,
        hs_code: hsCode,
        status,
        overall,
        snippet,
        source_url: regUrl,
        timestamp: new Date().toISOString(),
        legal_citation: legalCitation,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  } catch (error: any) {
    console.error("Server error during product classification:", error);
    return new Response(
      JSON.stringify({
        error:
          error.message ||
          "Internal server error during product classification.",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
};
