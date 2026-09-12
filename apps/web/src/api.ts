const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";
export const getToken = () => localStorage.getItem("friendcord_token");
const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));
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
async function fetchWithRetry(url: string, options: RequestInit) {
  updateLoading(1);
  const delays = [0, 1500, 3500];
  let lastError: unknown;
  let lastResponse: Response | undefined;
  try {
    for (const delay of delays) {
      if (delay) await wait(delay);
      try {
        const response = await fetch(url, { ...options, signal: AbortSignal.timeout(12_000) });
        const contentType = response.headers.get("content-type") ?? "";
        const renderIsStarting = [502, 503, 504].includes(response.status) || contentType.includes("text/html");
        if (!renderIsStarting) return response;
        lastResponse = response;
      }
      catch (error) { lastError = error; }
    }
    if (lastResponse) return lastResponse;
    throw new Error(lastError instanceof TypeError ? "Servidor temporariamente indisponível (FC-NET-01). Tente novamente em alguns segundos." : "Não foi possível conectar ao servidor (FC-NET-02).");
  } finally {
    updateLoading(-1);
  }
}
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  let response: Response;
  try { response = await fetchWithRetry(`${API_URL}/api${path}`, { cache: "no-store", ...options, headers: { "Content-Type": "application/json", ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}), ...options.headers } }); }
  catch (error) { import("./telemetry").then(({ reportClientError }) => reportClientError(error, { area: "api", path, method: options.method ?? "GET" })); throw error; }
  if (!response.ok) { const data = await response.json().catch(() => ({})); throw new Error(data.error ?? "Falha na comunicação"); }
  return response.status === 204 ? undefined as T : response.json();
}
export async function uploadFile<T>(file: Blob, filename: string): Promise<T> {
  const form = new FormData(); form.append("file", file, filename);
  const response = await fetchWithRetry(`${API_URL}/api/attachments`, { method: "POST", headers: getToken() ? { Authorization: `Bearer ${getToken()}` } : {}, body: form });
  if (!response.ok) { const data = await response.json().catch(() => ({})); throw new Error(data.error ?? "Falha ao enviar arquivo"); }
  return response.json();
}
export { API_URL };
