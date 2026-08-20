const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";
export const getToken = () => localStorage.getItem("friendcord_token");
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_URL}/api${path}`, { ...options, headers: { "Content-Type": "application/json", ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}), ...options.headers } });
  if (!response.ok) { const data = await response.json().catch(() => ({})); throw new Error(data.error ?? "Falha na comunicação"); }
  return response.status === 204 ? undefined as T : response.json();
}
export { API_URL };
