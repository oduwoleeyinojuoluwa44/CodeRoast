import { GoogleGenAI } from "@google/genai";

type GeminiGenerateRequest = {
  model: string;
  contents: string;
  config?: {
    temperature?: number;
    maxOutputTokens?: number;
  };
};

type GeminiClient = {
  models: {
    generateContent: (params: GeminiGenerateRequest) => Promise<{ text?: string }>;
  };
};

type GeminiClientFactory = (options: {
  apiKey: string;
  apiVersion?: string;
}) => GeminiClient;

const defaultFactory: GeminiClientFactory = (options) =>
  new GoogleGenAI({
    apiKey: options.apiKey,
    apiVersion: options.apiVersion,
  });

let createClient: GeminiClientFactory = defaultFactory;

export function setGeminiClientFactoryForTests(factory: GeminiClientFactory | null): void {
  createClient = factory ?? defaultFactory;
}

export function getGeminiApiKey(): string | undefined {
  return process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
}

function buildClient(apiKey: string): GeminiClient {
  const apiVersion = process.env.GEMINI_API_VERSION;
  return createClient({ apiKey, apiVersion });
}

function extractText(response: { text?: string }): string {
  const text = typeof response?.text === "string" ? response.text.trim() : "";
  if (!text) {
    throw new Error("Gemini response missing text.");
  }
  return text;
}

export async function callGemini(params: {
  apiKey: string;
  model: string;
  prompt: string;
  temperature?: number;
  maxOutputTokens?: number;
}): Promise<string> {
  const client = buildClient(params.apiKey);
  const response = await client.models.generateContent({
    model: params.model,
    contents: params.prompt,
    config: {
      temperature: params.temperature ?? 0.2,
      maxOutputTokens: params.maxOutputTokens ?? 512,
    },
  });

  return extractText(response);
}

export async function callGeminiNarrator(params: {
  apiKey: string;
  model: string;
  prompt: string;
}): Promise<string> {
  return callGemini(params);
}
