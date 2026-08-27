import { useEffect, useRef, useState } from "react";
import { API_URL } from "../api";

type SinkVideo = HTMLVideoElement & { setSinkId?: (deviceId: string) => Promise<void> };
export function useSpeaking(stream: MediaStream | null, enabled = true) {
  const [speaking, setSpeaking] = useState(false); const speakingRef = useRef(false);
  useEffect(() => { if (!stream || !enabled || !stream.getAudioTracks().some((track) => track.enabled)) { setSpeaking(false); return; } const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext: typeof AudioContext }).webkitAudioContext; const context = new AudioContextClass(); const analyser = context.createAnalyser(); analyser.fftSize = 512; analyser.smoothingTimeConstant = .72; const source = context.createMediaStreamSource(stream); source.connect(analyser); const samples = new Uint8Array(analyser.fftSize); let quietFrames = 0; const timer = window.setInterval(() => { analyser.getByteTimeDomainData(samples); let energy = 0; for (const sample of samples) { const normalized = (sample - 128) / 128; energy += normalized * normalized; } const active = Math.sqrt(energy / samples.length) > .028; quietFrames = active ? 0 : quietFrames + 1; const next = active || quietFrames < 3; if (next !== speakingRef.current) { speakingRef.current = next; setSpeaking(next); } }, 90); return () => { window.clearInterval(timer); source.disconnect(); analyser.disconnect(); void context.close(); }; }, [enabled, stream]);
  return speaking;
}
export function VideoTile({ stream, muted = false, volume = 1, label, avatarUrl, videoVisible, screenSharing = false, mirror = false, outputDeviceId }: { stream: MediaStream; muted?: boolean; volume?: number; label: string; avatarUrl?: string | null; videoVisible: boolean; screenSharing?: boolean; mirror?: boolean; outputDeviceId?: string }) {
  const ref = useRef<SinkVideo>(null);
  const speaking = useSpeaking(stream);
  useEffect(() => { if (!ref.current) return; ref.current.srcObject = stream; ref.current.volume = volume; if (outputDeviceId && ref.current.setSinkId) ref.current.setSinkId(outputDeviceId).catch(() => undefined); }, [stream, volume, outputDeviceId]);
  const image = avatarUrl ? `${API_URL}${avatarUrl}` : null;
  const classes = ["video-tile", screenSharing ? "sharing" : "", speaking ? "speaking" : ""].filter(Boolean).join(" ");
  const pictureInPicture = async () => { if (!ref.current || !document.pictureInPictureEnabled) return; if (document.pictureInPictureElement === ref.current) await document.exitPictureInPicture(); else await ref.current.requestPictureInPicture(); };
  return <div className={classes}><video className={`${videoVisible ? "" : "audio-only-video"}${mirror ? " mirrored-video" : ""}`} ref={ref} autoPlay playsInline muted={muted}/>{!videoVisible && <div className="call-avatar">{image ? <img src={image} alt=""/> : <span>{label.slice(0, 1).toUpperCase()}</span>}</div>}{videoVisible && document.pictureInPictureEnabled && <button className="pip-button" title="Manter vídeo sobre outras abas" onClick={pictureInPicture}>▣</button>}<span>{screenSharing ? "🖥 " : ""}{label}</span></div>;
}
