import { useCallback, useEffect, useRef, useState } from "react";
import type { MediaState } from "@friendcord/shared";
import { getSocket } from "../socket";

type QueueItem = Pick<MediaState, "provider" | "mediaId" | "mediaType" | "title" | "artist" | "artworkUrl" | "officialUrl">;
type SearchResult = { id: string; title: string; artist: string; artworkUrl: string; previewUrl: string; officialUrl: string; collection: string };

export function MediaRoom({ channelId }: { channelId: string }) {
  const [scope, setScope] = useState<"solo" | "room">("solo");
  const [state, setState] = useState<MediaState | null>(null);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [collapsed, setCollapsed] = useState(false);
  const [error, setError] = useState("");
  const [volume, setVolume] = useState(() => Number(localStorage.getItem("friendcord_media_volume") ?? 70));
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);

  const broadcast = useCallback((next: MediaState) => {
    setState(next);
    if (scope === "room") getSocket().emit("media:update", { channelId, state: next });
  }, [channelId, scope]);

  useEffect(() => {
    const receive = (next: MediaState) => { setScope("room"); setState(next); };
    getSocket().on("media:state", receive);
    return () => { getSocket().off("media:state", receive); };
  }, []);

  useEffect(() => { localStorage.setItem("friendcord_media_volume", String(volume)); }, [volume]);
  useEffect(() => {
    if (!audioRef.current) return;
    audioRef.current.volume = volume / 100;
    if (state?.playing) void audioRef.current.play().catch(() => undefined);
    else audioRef.current.pause();
  }, [state, volume]);

  const searchMusic = async () => {
    const term = search.trim();
    if (term.length < 2) { setError("Digite o nome da musica ou do artista."); return; }
    setSearching(true); setError(""); setResults([]);
    try {
      const response = await fetch(`https://itunes.apple.com/search?media=music&entity=song&limit=15&country=BR&term=${encodeURIComponent(term)}`);
      if (!response.ok) throw new Error();
      const data = await response.json() as { results?: Array<{ trackId?: number; trackName?: string; artistName?: string; artworkUrl100?: string; previewUrl?: string; trackViewUrl?: string; collectionName?: string }> };
      setResults((data.results ?? []).filter((item) => item.previewUrl && item.trackName).map((item) => ({
        id: String(item.trackId ?? item.previewUrl), title: item.trackName!, artist: item.artistName ?? "Artista desconhecido",
        artworkUrl: (item.artworkUrl100 ?? "").replace("100x100", "300x300"), previewUrl: item.previewUrl!,
        officialUrl: item.trackViewUrl ?? "https://music.apple.com/br", collection: item.collectionName ?? "",
      })));
    } catch {
      setError("Nao foi possivel pesquisar agora. Tente novamente em instantes.");
    } finally { setSearching(false); }
  };

  const playItem = (item: QueueItem) => broadcast({ ...item, playing: true, positionSeconds: 0, updatedAt: Date.now() });
  const fromResult = (result: SearchResult): QueueItem => ({ provider: "preview", mediaId: result.previewUrl, mediaType: "song", title: result.title, artist: result.artist, artworkUrl: result.artworkUrl, officialUrl: result.officialUrl });
  const updatePlayback = (playing: boolean) => state && broadcast({ ...state, playing, updatedAt: Date.now() });
  const stop = () => state && broadcast({ ...state, playing: false, positionSeconds: 0, updatedAt: Date.now() });
  const next = () => { const [first, ...rest] = queue; if (first) { setQueue(rest); playItem(first); } };

  if (collapsed) return <button className="media-bot-bubble" onClick={() => setCollapsed(false)}>Musica</button>;
  return <section className="media-room floating-media">
    <header><div><strong>Bot de musica</strong><small>Busca unificada em um unico catalogo</small></div><button className="media-hide" onClick={() => setCollapsed(true)}>-</button></header>
    <div className="music-search">
      <div><input placeholder="Pesquise por musica, artista ou album" value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => event.key === "Enter" && searchMusic()}/><select aria-label="Modo de reproducao" value={scope} onChange={(event) => setScope(event.target.value as typeof scope)}><option value="solo">So para mim</option><option value="room">Sincronizar na sala</option></select><button className="primary" onClick={searchMusic} disabled={searching}>{searching ? "Buscando..." : "Pesquisar"}</button></div>
      {results.length > 0 && <section className="music-results">{results.map((result) => <article key={result.id}><img src={result.artworkUrl} alt=""/><span><strong>{result.title}</strong><small>{result.artist}{result.collection ? ` - ${result.collection}` : ""}</small></span><button className="primary" onClick={() => playItem(fromResult(result))}>Tocar</button><button title="Adicionar a fila" onClick={() => setQueue((items) => [...items, fromResult(result)])}>+</button></article>)}</section>}
    </div>
    {state && <div className="media-content media-preview"><div className="preview-player">{state.artworkUrl && <img src={state.artworkUrl} alt=""/>}<span><strong>{state.title}</strong><small>{state.artist}</small></span><audio ref={audioRef} src={state.mediaId} autoPlay controls onEnded={next}/></div></div>}
    {error && <p className="media-inline-error">{error}</p>}
    <div className="media-controls"><div className="media-transport"><button onClick={() => updatePlayback(true)} disabled={!state}>Play</button><button onClick={() => updatePlayback(false)} disabled={!state}>Pausa</button><button onClick={stop} disabled={!state}>Parar</button><button onClick={next} disabled={!queue.length}>Proxima <span>{queue.length}</span></button></div><label className="media-volume"><span>Vol.</span><input aria-label="Volume do bot para mim" type="range" min="0" max="100" value={volume} onChange={(event) => setVolume(Number(event.target.value))}/><output>{volume}%</output></label></div>
    {state?.officialUrl && <a className="media-official-link" href={state.officialUrl} target="_blank" rel="noreferrer">Abrir fonte oficial</a>}
    {queue.length > 0 && <div className="media-queue"><strong>Fila</strong><span>{queue.map((item, index) => `${index + 1}. ${item.title ?? "Musica"}`).join(" - ")}</span></div>}
    <small className="media-legal">A busca toca previas oficiais. O FriendCord nao baixa nem retransmite musicas completas.</small>
  </section>;
}
