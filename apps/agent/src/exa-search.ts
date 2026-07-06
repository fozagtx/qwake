import Exa from "exa-js";

const EXA_RESULT_LIMIT = 3;
const EXA_SEARCH_WINDOW_DAYS = 3;

export function requireExaSearchConfig(): string {
  const apiKey = process.env.EXA_API_KEY;
  if (!apiKey) {
    throw new Error("EXA_API_KEY is required");
  }

  return apiKey;
}

export async function searchExaContext(query: string): Promise<string | null> {
  requireExaSearchConfig();

  try {
    const exa = new Exa();
    const response = await exa.search(query, {
      type: "auto",
      numResults: EXA_RESULT_LIMIT,
      startPublishedDate: startPublishedDate(),
      contents: {
        highlights: true,
      },
    });

    const results = response.results
      .slice(0, EXA_RESULT_LIMIT)
      .map((result, index) => {
        const title = result.title?.trim() || "Untitled source";
        const date = result.publishedDate ? ` (${result.publishedDate.slice(0, 10)})` : "";
        const highlight = cleanSnippet(result.highlights?.[0]);
        return `${index + 1}. ${title}${date} - ${result.url}${highlight ? `\n   ${highlight}` : ""}`;
      });

    if (results.length === 0) {
      return null;
    }

    return ["Exa live web context:", ...results].join("\n");
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "qwake.agent.exa_error",
        error: formatSearchError(error),
      }),
    );
    return "Exa live web context is unavailable right now.";
  }
}

function startPublishedDate(): string {
  const start = new Date(Date.now() - EXA_SEARCH_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  return start.toISOString().slice(0, 10);
}

function cleanSnippet(snippet: string | undefined): string {
  if (!snippet) {
    return "";
  }

  return snippet.replace(/\s+/g, " ").trim();
}

function formatSearchError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return "unknown Exa search error";
}
