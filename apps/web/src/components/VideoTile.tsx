import { useEffect, useRef } from "react";
import { API_URL } from "../api";

type SinkVideo = HTMLVideoElement & { setSinkId?: (deviceId: string) => Promise<void> };
export function VideoTile({ stream, muted = false, volume = 1, label, avatarUrl, videoVisible, screenSharing = false, outputDeviceId }: { stream: MediaStream; muted?: boolean; volume?: number; label: string; avatarUrl?: string | null; videoVisible: boolean; screenSharing?: boolean; outputDeviceId?: string }) {
  const ref = useRef<SinkVideo>(null);
  useEffect(() => { if (!ref.current) return; ref.current.srcObject = stream; ref.current.volume = volume; if (outputDeviceId && ref.current.setSinkId) ref.current.setSinkId(outputDeviceId).catch(() => undefined); }, [stream, volume, outputDeviceId]);
  const image = avatarUrl ? `${API_URL}${avatarUrl}` : null;
  return <div className={screenSharing ? "video-tile sharing" : "video-tile"}><video className={videoVisible ? "" : "audio-only-video"} ref={ref} autoPlay playsInline muted={muted}/>{!videoVisible && <div className="call-avatar">{image ? <img src={image} alt=""/> : <span>{label.slice(0, 1).toUpperCase()}</span>}</div>}<span>{screenSharing ? "🖥 " : ""}{label}</span></div>;
}
