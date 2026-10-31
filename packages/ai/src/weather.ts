// The weather for job ideas, from an MCP server the owner added and approved (brief Part 13). Only
// the tools the owner approved are called, with the arguments the owner set, and what comes back
// is untrusted: it is cut short and goes into the prompt as quoted data, never as instructions.
import { createMCPClient } from '@ai-sdk/mcp';

export interface WeatherServer {
  url: string;
  tools: { name: string; arguments: Record<string, unknown> }[];
}

const MAX_CHARS = 600;

/** The forecast as plain text, or null when there is none to be had. Never throws. */
export async function readForecast(server: WeatherServer, timeoutMs = 5000): Promise<string | null> {
  const tool = server.tools[0];
  if (!tool || !server.url.startsWith('https://')) return null;
  let client: Awaited<ReturnType<typeof createMCPClient>> | undefined;
  try {
    const signal = AbortSignal.timeout(timeoutMs);
    client = await createMCPClient({ transport: { type: 'http', url: server.url, redirect: 'error' }, clientName: 'family-time', initializationOptions: { signal } });
    const result = await client.callTool({ name: tool.name, arguments: tool.arguments, options: { signal } });
    const content = 'content' in result && Array.isArray(result.content) ? result.content : [];
    const text = content
      .filter((c): c is { type: 'text'; text: string } => (c as { type?: string }).type === 'text')
      .map((c) => c.text)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    return text ? text.slice(0, MAX_CHARS) : null;
  } catch {
    return null;
  } finally {
    await client?.close().catch(() => undefined);
  }
}
