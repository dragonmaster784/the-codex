import type { APIRoute } from "astro";

export const prerender = false; // Essential for server-side processing of dynamic requests

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

  const buyerName = requestBody.buyerName?.trim();
  const schema = requestBody.schema?.trim() || "LegalEntity"; // Default to LegalEntity if not provided

  if (!buyerName) {
    return new Response(JSON.stringify({ error: "Buyer name is required." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const OPEN_SANCTIONS_KEY = import.meta.env.OPEN_SANCTIONS_KEY;

  if (!OPEN_SANCTIONS_KEY) {
    console.error("OPEN_SANCTIONS_KEY is not set.");
    return new Response(
      JSON.stringify({
        error: "Server configuration error: OPEN_SANCTIONS_KEY is missing.",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  try {
    const matchingRequestBody = {
      queries: {
        q1: {
          schema: schema,
          properties: {
            name: [buyerName],
          },
        },
      },
    };

    const response = await fetch(
      "https://api.opensanctions.org/match/default",
      {
        method: "POST",
        headers: {
          Authorization: `Apikey ${OPEN_SANCTIONS_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(matchingRequestBody),
      },
    );

    if (!response.ok) {
      console.error(
        `OpenSanctions API error: ${response.status} - ${response.statusText}`,
      );
      const errorData = await response.json();
      console.error("OpenSanctions error response:", errorData);
      return new Response(
        JSON.stringify({
          error: `Failed to fetch data from OpenSanctions: ${errorData.detail || response.statusText}`,
        }),
        {
          status: response.status,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    const data = await response.json();
    const results = data.responses?.q1?.results || [];

    // Define a mapping from OpenSanctions internal topics to desired display tags
    const topicToDisplayTagMap: { [key: string]: string } = {
      sanction: "Sanctioned entity",
      "export.control": "Export controlled",
      debarment: "Debarred entity",
      "sanction-linked": "Sanction-linked entity",
      terrorism: "Terrorism",
      "trade.risk": "Trade risk",
    };

    // The tags that automatically trigger an "NO" overall status (red)
    const criticalTags: string[] = [
      "Sanctioned entity",
      "Debarred entity",
      "Terrorism",
      "Trade risk",
    ];

    // Process each result to include its compliance signals
    for (const result of results) {
      let resultStatus: "YES" | "NO" | "YES IF" = "NO";
      let resultOverall: "NO" | "AMBER" | "GREEN" = "GREEN";
      const resultDetectedTags: string[] = [];
      const resultDetectedCountries: string[] = [];
      let resultHasCriticalTag = false;
      let resultHasAnyTag = false;

      // Process topics for tags for the current result
      if (
        result.properties?.topics &&
        Array.isArray(result.properties.topics)
      ) {
        for (const topic of result.properties.topics) {
          const displayTag = topicToDisplayTagMap[topic];
          if (displayTag && !resultDetectedTags.includes(displayTag)) {
            resultDetectedTags.push(displayTag);
            resultHasAnyTag = true;
            if (criticalTags.includes(displayTag)) {
              resultHasCriticalTag = true;
            }
          }
        }
      }

      // Process countries for locales for the current result
      if (
        result.properties?.country &&
        Array.isArray(result.properties.country)
      ) {
        for (const countryCode of result.properties.country) {
          if (!resultDetectedCountries.includes(countryCode.toUpperCase())) {
            resultDetectedCountries.push(countryCode.toUpperCase());
          }
        }
      }

      // Determine final status and overall for this specific result
      if (resultHasCriticalTag) {
        resultStatus = "YES";
        resultOverall = "NO"; // Red
      } else if (resultHasAnyTag) {
        // If results exist but no critical tags, it's conditional
        resultStatus = "YES IF";
        resultOverall = "AMBER"; // Amber
      }
      // If hasAnyTag is false, status and overall remain "NO" and "GREEN" by default

      // Attach compliance signals to the result object
      result.compliance = {
        status: resultStatus,
        overall: resultOverall,
        matched_tags: resultDetectedTags,
        locales: resultDetectedCountries.sort(), // Sort locales for consistency
      };
    }

    const timestamp = new Date().toISOString();
    // The source URL should still be general, based on the original query
    const sourceUrl = `https://www.opensanctions.org/search/?q=${encodeURIComponent(buyerName)}&scope=sanctions`;

    return new Response(
      JSON.stringify({
        source_url: sourceUrl,
        timestamp,
        raw_results: results, // Include all enriched results
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  } catch (error: any) {
    console.error("Server error during API call:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Internal server error." }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
};
