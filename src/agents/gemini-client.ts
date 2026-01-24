type GeminiRequest = {
  contents: { role: string; parts: { text: string }[] }[];
  generationConfig?: {
    temperature?: number;
    maxOutputTokens?: number;
  };
};

type GeminiResponse = {
  candidates?: {
    content?: {
      parts?: { text?: string }[];
    };
  }[];
};

type FetchFn = (
  input: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
  }
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown>; text: () => Promise<string> }>;

function getFetch(): FetchFn {
  const maybeFetch = (globalThis as { fetch?: FetchFn }).fetch;
  if (!maybeFetch) {
    throw new Error("Fetch API is not available in this runtime.");
  }
  return maybeFetch;
}

class GeminiHttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function extractCandidateText(payload: GeminiResponse): string {
  const candidate = payload.candidates?.[0];
  const parts = candidate?.content?.parts ?? [];
  const text = parts.map((part) => part.text ?? "").join("").trim();
  if (!text) {
    throw new Error("Gemini response missing text.");
  }
  return text;
}

async function callGeminiWithVersion(
  apiVersion: string,
  params: {
    apiKey: string;
    model: string;
    prompt: string;
    temperature?: number;
    maxOutputTokens?: number;
  }
): Promise<string> {
  const { apiKey, model, prompt, temperature, maxOutputTokens } = params;
  const url = `https://generativelanguage.googleapis.com/${apiVersion}/models/${model}:generateContent?key=${apiKey}`;
  const body: GeminiRequest = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: temperature ?? 0.2,
      maxOutputTokens: maxOutputTokens ?? 512,
    },
  };

  const fetch = getFetch();
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    const suffix = errorText ? `: ${errorText}` : "";
    throw new GeminiHttpError(response.status, `Gemini API error ${response.status}${suffix}`);
  }

  const payload = (await response.json()) as GeminiResponse;
  return extractCandidateText(payload);
}

export async function callGemini(params: {
  apiKey: string;
  model: string;
  prompt: string;
  temperature?: number;
  maxOutputTokens?: number;
}): Promise<string> {
  const envVersion = process.env.GEMINI_API_VERSION;
  const versions = envVersion ? [envVersion] : ["v1", "v1beta"];
  let lastError: Error | null = null;

  for (const apiVersion of versions) {
    try {
      return await callGeminiWithVersion(apiVersion, params);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (error instanceof GeminiHttpError && error.status === 404) {
        continue;
      }
      break;
    }
  }

  if (lastError) {
    throw lastError;
  }
  throw new Error("Gemini API call failed.");
}

export async function callGeminiNarrator(params: {
  apiKey: string;
  model: string;
  prompt: string;
}): Promise<string> {
  return callGemini(params);
}
