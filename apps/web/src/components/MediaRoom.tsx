import { useCallback, useEffect, useRef, useState } from "react";
import type { MediaState } from "@friendcord/shared";
import { getSocket } from "../socket";

interface YouTubePlayer {
  playVideo(): void;
  pauseVideo(): void;
  stopVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  setVolume(volume: number): void;
  mute(): void;
  unMute(): void;
  destroy(): void;
}

interface SpotifyController {
  play(): void;
  pause(): void;
  seek(seconds: number): void;
  addListener(event: string, listener: (event: SpotifyPlaybackEvent) => void): void;
  destroy(): void;
}

interface SpotifyPlaybackEvent {
  data?: { isPaused?: boolean; position?: number };
}

interface SpotifyIframeApi {
  createController(
    element: HTMLElement,
    options: { uri: string; width: string; height: number },
    callback: (controller: SpotifyController) => void,
  ): void;
}

declare global {
  interface Window {
    YT?: { Player: new (element: HTMLElement, options: object) => YouTubePlayer };
    onYouTubeIframeAPIReady?: () => void;
    SpotifyIframeApi?: SpotifyIframeApi;
    onSpotifyIframeApiReady?: (api: SpotifyIframeApi) => void;
  }
}

type Provider = "youtube" | "spotify";
type QueueItem = { provider: Provider; mediaId: string; mediaType: string };

let youtubeApiPromise: Promise<void> | null = null;
let spotifyApiPromise: Promise<SpotifyIframeApi> | null = null;

function loadYouTubeApi() {
  if (window.YT) return Promise.resolve();
  if (youtubeApiPromise) return youtubeApiPromise;
  youtubeApiPromise = new Promise<void>((resolve) => {
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      resolve();
    };
    if (!document.querySelector("script[src='https://www.youtube.com/iframe_api']")) {
      const script = document.createElement("script");
      script.src = "https://www.youtube.com/iframe_api";
      document.head.appendChild(script);
    }
  });
  return youtubeApiPromise;
}

function loadSpotifyApi() {
  if (window.SpotifyIframeApi) return Promise.resolve(window.SpotifyIframeApi);
  if (spotifyApiPromise) return spotifyApiPromise;
  spotifyApiPromise = new Promise<SpotifyIframeApi>((resolve) => {
    const previous = window.onSpotifyIframeApiReady;
    window.onSpotifyIframeApiReady = (api) => {
      window.SpotifyIframeApi = api;
      previous?.(api);
      resolve(api);
    };
    if (!document.querySelector("script[src='https://open.spotify.com/embed/iframe-api/v1']")) {
      const script = document.createElement("script");
      script.src = "https://open.spotify.com/embed/iframe-api/v1";
      script.async = true;
      document.head.appendChild(script);
    }
  });
  return spotifyApiPromise;
}

function extract(input: string, provider: Provider): QueueItem | null {
  const value = input.trim();
  if (!value) return null;
  if (provider === "youtube") {
    const match = value.match(/(?:youtu\.be\/|youtube(?:-nocookie)?\.com\/(?:watch\?.*?v=|embed\/|shorts\/|live\/))([\w-]{11})/i);
    const mediaId = match?.[1] ?? (/^[\w-]{11}$/.test(value) ? value : "");
    return mediaId ? { provider, mediaId, mediaType: "video" } : null;
  }
  const match = value.match(/open\.spotify\.com\/(track|episode|playlist|album|show)\/([\w]+)/i)
    ?? value.match(/^spotify:(track|episode|playlist|album|show):([\w]+)$/i);
  return match ? { provider, mediaType: match[1].toLowerCase(), mediaId: match[2] } : null;
}

function spotifyUri(item: Pick<MediaState, "mediaId" | "mediaType">) {
  return `spotify:${item.mediaType ?? "track"}:${item.mediaId}`;
}

export function MediaRoom({ channelId }: { channelId: string }) {
  const [provider, setProvider] = useState<Provider>("youtube");
  const [scope, setScope] = useState<"solo" | "room">("solo");
  const [input, setInput] = useState("");
  const [state, setState] = useState<MediaState | null>(null);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(() => Number(localStorage.getItem("friendcord_media_volume") ?? 70));
  const [collapsed, setCollapsed] = useState(false);
  const [playerError, setPlayerError] = useState("");
  const [ready, setReady] = useState(false);
  const youtubeHost = useRef<HTMLDivElement>(null);
  const spotifyHost = useRef<HTMLDivElement>(null);
  const youtubePlayer = useRef<YouTubePlayer | null>(null);
  const spotifyPlayer = useRef<SpotifyController | null>(null);

  const broadcast = useCallback((next: MediaState, nextScope = scope) => {
    setState(next);
    if (nextScope === "room") getSocket().emit("media:update", { channelId, state: next });
  }, [channelId, scope]);

  const currentPosition = () => state?.provider === "youtube"
    ? youtubePlayer.current?.getCurrentTime() ?? state.positionSeconds
    : state?.positionSeconds ?? 0;

  const publish = useCallback((patch: Partial<MediaState>) => {
    if (!state) return;
    broadcast({ ...state, ...patch, positionSeconds: currentPosition(), updatedAt: Date.now() });
  }, [broadcast, state]);

  useEffect(() => {
    const receive = (next: MediaState) => {
      setScope("room");
      setState(next);
    };
    getSocket().on("media:state", receive);
    return () => { getSocket().off("media:state", receive); };
  }, []);

  useEffect(() => {
    if (!state || state.provider !== "youtube" || !youtubeHost.current) return;
    let cancelled = false;
    setReady(false);
    setPlayerError("");
    loadYouTubeApi().then(() => {
      if (cancelled || !youtubeHost.current || !window.YT) return;
      youtubePlayer.current?.destroy();
      youtubePlayer.current = new window.YT.Player(youtubeHost.current, {
        videoId: state.mediaId,
        playerVars: { origin: location.origin, playsinline: 1, rel: 0 },
        events: {
          onReady: () => {
            if (cancelled) return;
            setReady(true);
            youtubePlayer.current?.setVolume(volume);
            if (muted || volume === 0) youtubePlayer.current?.mute();
            youtubePlayer.current?.seekTo(state.positionSeconds, true);
            state.playing ? youtubePlayer.current?.playVideo() : youtubePlayer.current?.pauseVideo();
          },
          onError: () => setPlayerError("O proprietário bloqueou a reprodução incorporada deste vídeo."),
        },
      });
    });
    return () => {
      cancelled = true;
      youtubePlayer.current?.destroy();
      youtubePlayer.current = null;
    };
  }, [state?.mediaId, state?.provider]);

  useEffect(() => {
    if (!state || state.provider !== "spotify" || !spotifyHost.current) return;
    let cancelled = false;
    setReady(false);
    setPlayerError("");
    loadSpotifyApi().then((api) => {
      if (cancelled || !spotifyHost.current) return;
      spotifyPlayer.current?.destroy();
      api.createController(spotifyHost.current, { uri: spotifyUri(state), width: "100%", height: 152 }, (controller) => {
        if (cancelled) {
          controller.destroy();
          return;
        }
        spotifyPlayer.current = controller;
        controller.addListener("ready", () => {
          setReady(true);
          if (state.positionSeconds > 0) controller.seek(state.positionSeconds);
          if (state.playing) controller.play();
        });
        controller.addListener("playback_error", () => setPlayerError("O Spotify não conseguiu carregar este conteúdo no player oficial."));
      });
    });
    return () => {
      cancelled = true;
      spotifyPlayer.current?.destroy();
      spotifyPlayer.current = null;
    };
  }, [state?.mediaId, state?.mediaType, state?.provider]);

  useEffect(() => {
    if (!state || !ready) return;
    if (state.provider === "youtube") {
      const player = youtubePlayer.current;
      const expectedPosition = state.playing
        ? state.positionSeconds + (Date.now() - state.updatedAt) / 1000
        : state.positionSeconds;
      if (Math.abs((player?.getCurrentTime() ?? 0) - expectedPosition) > 2.5) player?.seekTo(expectedPosition, true);
      state.playing ? player?.playVideo() : player?.pauseVideo();
    } else {
      if (state.positionSeconds > 0) spotifyPlayer.current?.seek(state.positionSeconds);
      state.playing ? spotifyPlayer.current?.play() : spotifyPlayer.current?.pause();
    }
  }, [ready, state?.playing, state?.positionSeconds, state?.updatedAt]);

  useEffect(() => {
    localStorage.setItem("friendcord_media_volume", String(volume));
    if (state?.provider !== "youtube") return;
    youtubePlayer.current?.setVolume(volume);
    if (muted || volume === 0) youtubePlayer.current?.mute();
    else youtubePlayer.current?.unMute();
  }, [muted, state?.provider, volume]);

  const load = (item?: QueueItem) => {
    const selected = item ?? extract(input, provider);
    if (!selected) {
      setPlayerError(`Cole um link oficial válido do ${provider === "youtube" ? "YouTube" : "Spotify"}.`);
      return;
    }
    setPlayerError("");
    broadcast({ ...selected, playing: false, positionSeconds: 0, updatedAt: Date.now() });
    setInput("");
  };

  const addQueue = () => {
    const selected = extract(input, provider);
    if (!selected) {
      setPlayerError(`Cole um link oficial válido do ${provider === "youtube" ? "YouTube" : "Spotify"}.`);
      return;
    }
    setQueue((items) => [...items, selected]);
    setInput("");
    setPlayerError("");
  };

  const play = () => {
    if (!state) return;
    state.provider === "youtube" ? youtubePlayer.current?.playVideo() : spotifyPlayer.current?.play();
    publish({ playing: true });
  };

  const pause = () => {
    if (!state) return;
    state.provider === "youtube" ? youtubePlayer.current?.pauseVideo() : spotifyPlayer.current?.pause();
    publish({ playing: false });
  };

  const stop = () => {
    if (!state) return;
    if (state.provider === "youtube") youtubePlayer.current?.stopVideo();
    else {
      spotifyPlayer.current?.pause();
      spotifyPlayer.current?.seek(0);
    }
    broadcast({ ...state, playing: false, positionSeconds: 0, updatedAt: Date.now() });
  };

  const next = () => {
    const [first, ...rest] = queue;
    if (!first) return;
    setQueue(rest);
    load(first);
  };

  if (collapsed) return <button className="media-bot-bubble" onClick={() => setCollapsed(false)}>♫ Abrir mídia</button>;

  return (
    <section className="media-room floating-media">
      <header>
        <div><strong>♫ Bot de mídia</strong><small>Players oficiais</small></div>
        <button className="media-hide" onClick={() => setCollapsed(true)} aria-label="Ocultar bot">×</button>
      </header>
      <div className="media-form">
        <label><span>Serviço</span><select value={provider} onChange={(event) => setProvider(event.target.value as Provider)}><option value="youtube">YouTube</option><option value="spotify">Spotify</option></select></label>
        <label><span>Reprodução</span><select value={scope} onChange={(event) => setScope(event.target.value as typeof scope)}><option value="solo">Só para mim</option><option value="room">Sincronizar na sala</option></select></label>
        <div className="media-link-row">
          <input placeholder={`Cole o link do ${provider === "youtube" ? "YouTube" : "Spotify"}`} value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") load(); }} />
          <button className="primary" onClick={() => load()}>▶ Tocar</button>
          <button onClick={addQueue}>＋ Fila</button>
        </div>
      </div>
      {state && <div className={`media-content media-${state.provider}`}>
        {state.provider === "youtube" && <div className="embed" ref={youtubeHost} />}
        {state.provider === "spotify" && <div className="embed spotify-embed" ref={spotifyHost} />}
        {playerError && <div className="media-fallback">
          <strong>Não foi possível reproduzir aqui</strong><p>{playerError}</p>
          {state.provider === "youtube" && <a href={`https://www.youtube.com/watch?v=${state.mediaId}`} target="_blank" rel="noreferrer">Abrir no YouTube ↗</a>}
          {state.provider === "spotify" && <a href={`https://open.spotify.com/${state.mediaType ?? "track"}/${state.mediaId}`} target="_blank" rel="noreferrer">Abrir no Spotify ↗</a>}
        </div>}
      </div>}
      {!state && playerError && <p className="media-inline-error">{playerError}</p>}
      <div className="media-controls">
        <div className="media-transport">
          <button onClick={play} disabled={!state || !ready} title="Reproduzir">▶</button>
          <button onClick={pause} disabled={!state || !ready} title="Pausar">Ⅱ</button>
          <button onClick={stop} disabled={!state || !ready} title="Parar">■</button>
          <button onClick={next} disabled={!queue.length} title="Próximo">⏭ <span>{queue.length}</span></button>
        </div>
        {state?.provider === "spotify" ? (
          <div className="media-volume media-volume-official" title="A API oficial do Spotify não permite alterar o volume externamente.">🔊 <span>Volume no player</span></div>
        ) : (
          <label className="media-volume">
            <button onClick={() => setMuted((value) => !value)} title="Silenciar somente para você">{muted || volume === 0 ? "🔇" : "🔊"}</button>
            <input aria-label="Volume somente para mim" type="range" min="0" max="100" value={volume} onChange={(event) => { setMuted(false); setVolume(Number(event.target.value)); }} />
            <output>{volume}%</output>
          </label>
        )}
      </div>
      {queue.length > 0 && <div className="media-queue"><strong>Fila</strong><span>{queue.map((item, index) => `${index + 1}. ${item.provider === "youtube" ? "YouTube" : "Spotify"}`).join(" · ")}</span></div>}
      <small className="media-legal">A sala sincroniza os players oficiais; não baixa, retransmite ou remove anúncios.</small>
    </section>
  );
}
