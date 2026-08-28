import { useCallback, useEffect, useMemo, useState } from "react";
import type { MediaState } from "@friendcord/shared";
import { getSocket } from "../socket";

type Provider = MediaState["provider"];
type QueueItem = Pick<MediaState, "provider" | "mediaId" | "mediaType">;

function serviceName(provider: Provider) { return provider === "youtube" ? "YouTube" : provider === "spotify" ? "Spotify" : "SoundCloud"; }

function extract(input: string, provider: Provider): QueueItem | null {
  const value = input.trim();
  if (provider === "youtube") {
    const match = value.match(/(?:youtu\.be\/|youtube(?:-nocookie)?\.com\/(?:watch\?.*?v=|embed\/|shorts\/|live\/))([\w-]{11})/i);
    const mediaId = match?.[1] ?? (/^[\w-]{11}$/.test(value) ? value : "");
    return mediaId ? { provider, mediaId, mediaType: "video" } : null;
  }
  if (provider === "spotify") {
    const match = value.match(/open\.spotify\.com\/(track|episode|playlist|album|show)\/([\w]+)/i) ?? value.match(/^spotify:(track|episode|playlist|album|show):([\w]+)$/i);
    return match ? { provider, mediaType: match[1].toLowerCase(), mediaId: match[2] } : null;
  }
  try {
    const url = new URL(value);
    return /(^|\.)soundcloud\.com$/i.test(url.hostname) ? { provider, mediaId: url.toString(), mediaType: "track" } : null;
  } catch { return null; }
}

export function MediaRoom({ channelId }: { channelId: string }) {
  const [provider, setProvider] = useState<Provider>("soundcloud");
  const [scope, setScope] = useState<"solo" | "room">("solo");
  const [input, setInput] = useState("");
  const [state, setState] = useState<MediaState | null>(null);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [collapsed, setCollapsed] = useState(false);
  const [error, setError] = useState("");
  const [volume, setVolume] = useState(() => Number(localStorage.getItem("friendcord_media_volume") ?? 70));

  const broadcast = useCallback((next: MediaState, targetScope = scope) => {
    setState(next);
    if (targetScope === "room") getSocket().emit("media:update", { channelId, state: next });
  }, [channelId, scope]);

  useEffect(() => {
    const receive = (next: MediaState) => { setScope("room"); setState(next); };
    getSocket().on("media:state", receive);
    return () => { getSocket().off("media:state", receive); };
  }, []);
  useEffect(() => { localStorage.setItem("friendcord_media_volume", String(volume)); }, [volume]);

  const embedUrl = useMemo(() => {
    if (!state) return "";
    if (state.provider === "youtube") return `https://www.youtube-nocookie.com/embed/${state.mediaId}?autoplay=${state.playing ? 1 : 0}&playsinline=1&rel=0&start=${Math.floor(state.positionSeconds)}`;
    if (state.provider === "spotify") return `https://open.spotify.com/embed/${state.mediaType ?? "track"}/${state.mediaId}?utm_source=generator`;
    return `https://w.soundcloud.com/player/?url=${encodeURIComponent(state.mediaId)}&color=%237c5cff&auto_play=${state.playing ? "true" : "false"}&hide_related=true&show_comments=false&show_reposts=false&visual=true`;
  }, [state]);

  const officialUrl = !state ? "" : state.provider === "youtube" ? `https://www.youtube.com/watch?v=${state.mediaId}` : state.provider === "spotify" ? `https://open.spotify.com/${state.mediaType ?? "track"}/${state.mediaId}` : state.mediaId;

  const load = (item?: QueueItem) => {
    const selected = item ?? extract(input, provider);
    if (!selected) { setError(`Cole um link oficial válido do ${serviceName(provider)}.`); return; }
    setError(""); setInput("");
    broadcast({ ...selected, playing: true, positionSeconds: 0, updatedAt: Date.now() });
  };
  const addQueue = () => {
    const selected = extract(input, provider);
    if (!selected) { setError(`Cole um link oficial válido do ${serviceName(provider)}.`); return; }
    setQueue((items) => [...items, selected]); setInput(""); setError("");
  };
  const updatePlayback = (playing: boolean) => state && broadcast({ ...state, playing, updatedAt: Date.now() });
  const stop = () => state && broadcast({ ...state, playing: false, positionSeconds: 0, updatedAt: Date.now() });
  const next = () => { const [first, ...rest] = queue; if (first) { setQueue(rest); load(first); } };

  if (collapsed) return <button className="media-bot-bubble" onClick={() => setCollapsed(false)}>♫ Abrir mídia</button>;
  return <section className="media-room floating-media">
    <header><div><strong>♫ Bot de mídia</strong><small>SoundCloud recomendado · players oficiais</small></div><button className="media-hide" onClick={() => setCollapsed(true)}>×</button></header>
    <div className="media-form">
      <label><span>Serviço</span><select value={provider} onChange={(event) => setProvider(event.target.value as Provider)}><option value="soundcloud">SoundCloud</option><option value="youtube">YouTube</option><option value="spotify">Spotify</option></select></label>
      <label><span>Reprodução</span><select value={scope} onChange={(event) => setScope(event.target.value as typeof scope)}><option value="solo">Só para mim</option><option value="room">Sincronizar na sala</option></select></label>
      <div className="media-link-row"><input placeholder={`Cole o link do ${serviceName(provider)}`} value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => event.key === "Enter" && load()} /><button className="primary" onClick={() => load()}>▶ Tocar</button><button onClick={addQueue}>+ Fila</button></div>
    </div>
    {state && <div className={`media-content media-${state.provider}`}><iframe key={embedUrl} className={`embed ${state.provider}-embed`} title={serviceName(state.provider)} src={embedUrl} allow="autoplay; encrypted-media; fullscreen; picture-in-picture" allowFullScreen /></div>}
    {error && <p className="media-inline-error">{error}</p>}
    <div className="media-controls"><div className="media-transport"><button onClick={() => updatePlayback(true)} disabled={!state}>▶</button><button onClick={() => updatePlayback(false)} disabled={!state}>Ⅱ</button><button onClick={stop} disabled={!state}>■</button><button onClick={next} disabled={!queue.length}>⏭ <span>{queue.length}</span></button></div><label className="media-volume"><span>🔊</span><input aria-label="Volume do bot para mim" type="range" min="0" max="100" value={volume} onChange={(event) => setVolume(Number(event.target.value))} /><output>{volume}%</output></label></div>
    {state && <a className="media-official-link" href={officialUrl} target="_blank" rel="noreferrer">Abrir no {serviceName(state.provider)} ↗</a>}
    {queue.length > 0 && <div className="media-queue"><strong>Fila</strong><span>{queue.map((item, index) => `${index + 1}. ${serviceName(item.provider)}`).join(" · ")}</span></div>}
    <small className="media-legal">O FriendCord não baixa nem retransmite conteúdo. Login, anúncios e disponibilidade são controlados pelo serviço oficial.</small>
  </section>;
}
