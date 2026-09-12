const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";
export const getToken = () => localStorage.getItem("friendcord_token");
const REQUEST_TIMEOUT_MS = 60_000;
type LoadingListener = (pendingRequests: number) => void;
const loadingListeners = new Set<LoadingListener>();
let pendingRequests = 0;
const updateLoading = (change: number) => {
  pendingRequests = Math.max(0, pendingRequests + change);
  loadingListeners.forEach((listener) => listener(pendingRequests));
};
export const subscribeToLoading = (listener: LoadingListener) => {
  loadingListeners.add(listener);
  listener(pendingRequests);
  return () => { loadingListeners.delete(listener); };
};
function wait(milliseconds: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    signal.throwIfAborted();
    const onAbort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", onAbort); resolve(); }, milliseconds);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
async function request<T>(url: string, options: RequestInit): Promise<T> {
  const controller = new AbortController();
  const callerSignal = options.signal;
  const onAbort = () => controller.abort(callerSignal?.reason);
  if (callerSignal?.aborted) onAbort();
  else callerSignal?.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(new DOMException("Tempo de espera excedido", "TimeoutError")), REQUEST_TIMEOUT_MS);
  const signal = controller.signal;
  // Never automatically replay writes: the server may already have processed them.
  const delays = ["GET", "HEAD"].includes((options.method ?? "GET").toUpperCase()) ? [0, 1500, 4000, 8000] : [0];
  updateLoading(1);
  try {
    let response: Response | undefined;
    for (const delay of delays) {
      signal.throwIfAborted();
      if (delay) await wait(delay, signal);
      try { response = await fetch(url, { ...options, signal }); break; }
      catch (error) {
        if (signal.aborted) throw signal.reason;
        if (!(error instanceof TypeError)) throw error;
      }
    }
    if (!response) throw new Error("Não foi possível conectar ao servidor. Verifique sua conexão e tente novamente.");
    if (!response.ok) {
      const data = await response.json().catch(() => { signal.throwIfAborted(); return {}; });
      throw new Error(data.error ?? "Servidor temporariamente indisponível. Tente novamente.");
    }
    // The deadline also covers downloading the response body.
    return response.status === 204 ? undefined as T : await response.json();
  } catch (error) {
    if (callerSignal?.aborted) throw callerSignal.reason;
    if (signal.aborted) throw new Error("O servidor demorou demais para responder. Ele pode estar iniciando. Tente novamente em alguns instantes.");
    throw error;
  } finally {
    clearTimeout(timer);
    callerSignal?.removeEventListener("abort", onAbort);
    updateLoading(-1);
  }
}
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  return request<T>(`${API_URL}/api${path}`, { cache: "no-store", ...options, headers: { "Content-Type": "application/json", ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}), ...options.headers } });
}
export async function uploadFile<T>(file: Blob, filename: string): Promise<T> {
  const form = new FormData(); form.append("file", file, filename);
  return request<T>(`${API_URL}/api/attachments`, { method: "POST", headers: getToken() ? { Authorization: `Bearer ${getToken()}` } : {}, body: form });
}
export { API_URL };
