export type CoreRealtimeEvent = {
  id: string;
  type: string;
  occurredAt: string;
  employeeId?: string;
  terminalId?: string;
};

type SubscribeOptions = {
  getAccessToken: () => Promise<string | null>;
  onEvent: (event: CoreRealtimeEvent) => void;
  onUnauthorized?: () => void;
};

function eventUrl(path: string) {
  const value = process.env.NEXT_PUBLIC_API_URL?.trim().replace(/\/$/, "");
  if (!value) throw new Error("API_URL_MISSING");
  const root = value.endsWith("/api/v1") ? value : `${value}/api/v1`;
  return `${root}/${path.replace(/^\//, "")}`;
}

function readEvent(block: string): CoreRealtimeEvent | null {
  let type = "message";
  const data: string[] = [];
  for (const line of block.split("\n")) {
    if (line.startsWith("event:")) type = line.slice(6).trim();
    if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
  }
  if (!data.length || type === "connected" || type === "heartbeat") return null;
  try {
    const parsed = JSON.parse(data.join("\n")) as CoreRealtimeEvent;
    return parsed?.type ? parsed : null;
  } catch {
    return null;
  }
}

async function consume(response: Response, signal: AbortSignal, onEvent: SubscribeOptions["onEvent"]) {
  if (!response.body) throw new Error("SSE_BODY_MISSING");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (!signal.aborted) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer = (buffer + decoder.decode(value, { stream: true })).replace(/\r\n/g, "\n");
    let boundary = buffer.indexOf("\n\n");
    while (boundary >= 0) {
      const event = readEvent(buffer.slice(0, boundary));
      buffer = buffer.slice(boundary + 2);
      if (event) onEvent(event);
      boundary = buffer.indexOf("\n\n");
    }
  }
}

export function subscribeToCoreEvents(path: string, options: SubscribeOptions) {
  let stopped = false;
  let retryDelay = 1_000;
  let retryTimer: number | undefined;
  let controller: AbortController | undefined;

  const scheduleReconnect = () => {
    if (stopped) return;
    retryTimer = window.setTimeout(() => void connect(), retryDelay);
    retryDelay = Math.min(retryDelay * 2, 15_000);
  };

  const connect = async () => {
    try {
      const accessToken = await options.getAccessToken();
      if (!accessToken) {
        scheduleReconnect();
        return;
      }
      controller = new AbortController();
      const response = await fetch(eventUrl(path), {
        headers: {
          Accept: "text/event-stream",
          Authorization: `Bearer ${accessToken}`,
          "Cache-Control": "no-cache",
        },
        cache: "no-store",
        signal: controller.signal,
      });
      if (response.status === 401 || response.status === 403) options.onUnauthorized?.();
      if (!response.ok) throw new Error(`SSE_${response.status}`);
      retryDelay = 1_000;
      await consume(response, controller.signal, options.onEvent);
    } catch (error) {
      if ((error as { name?: string }).name === "AbortError") return;
    }
    scheduleReconnect();
  };

  void connect();
  return () => {
    stopped = true;
    controller?.abort();
    if (retryTimer !== undefined) window.clearTimeout(retryTimer);
  };
}
