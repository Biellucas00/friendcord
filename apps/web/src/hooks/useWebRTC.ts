import { useCallback, useEffect, useRef, useState } from "react";
import type { PublicUser } from "@friendcord/shared";
import { getSocket } from "../socket";

type Quality = { width: number; height: number; frameRate: number };
export interface RemotePeer { id: string; stream: MediaStream; user: PublicUser; audioEnabled: boolean; videoEnabled: boolean; screenSharing: boolean }
type VoiceConstraints = MediaTrackConstraints & { voiceIsolation?: boolean };
const microphoneConstraints = (deviceId: string | undefined, noiseSuppression: boolean): VoiceConstraints => ({
  deviceId: deviceId ? { exact: deviceId } : undefined,
  echoCancellation: true,
  noiseSuppression,
  autoGainControl: true,
  channelCount: 1,
  sampleRate: 48000,
  sampleSize: 16,
  voiceIsolation: noiseSuppression,
});
type IsolatedVoice = { stream: MediaStream; close: () => void };
const isolateVoice = async (sourceStream: MediaStream): Promise<IsolatedVoice> => {
  const sourceTrack = sourceStream.getAudioTracks()[0];
  if (!sourceTrack) return { stream: sourceStream, close: () => undefined };
  const context = new AudioContext({ sampleRate: 48000, latencyHint: "interactive" });
  await context.resume();
  const source = context.createMediaStreamSource(new MediaStream([sourceTrack]));
  const highPass = context.createBiquadFilter(); highPass.type = "highpass"; highPass.frequency.value = 150; highPass.Q.value = 0.8;
  const lowPass = context.createBiquadFilter(); lowPass.type = "lowpass"; lowPass.frequency.value = 6800; lowPass.Q.value = 0.6;
  const compressor = context.createDynamicsCompressor(); compressor.threshold.value = -32; compressor.knee.value = 10; compressor.ratio.value = 4; compressor.attack.value = 0.006; compressor.release.value = 0.14;
  const analyser = context.createAnalyser(); analyser.fftSize = 1024; analyser.smoothingTimeConstant = 0.82;
  const gate = context.createGain(); gate.gain.value = 0;
  const destination = context.createMediaStreamDestination();
  source.connect(highPass).connect(lowPass).connect(compressor).connect(analyser).connect(gate).connect(destination);
  const samples = new Uint8Array(analyser.fftSize);
  let openUntil = 0;
  let noiseFloor = 0.012;
  const timer = window.setInterval(() => {
    analyser.getByteTimeDomainData(samples);
    let energy = 0;
    for (const sample of samples) { const value = (sample - 128) / 128; energy += value * value; }
    const level = Math.sqrt(energy / samples.length);
    const now = performance.now();
    if (level < noiseFloor * 1.8) noiseFloor = noiseFloor * 0.96 + level * 0.04;
    const voiceThreshold = Math.max(0.042, noiseFloor * 3.2);
    if (level > voiceThreshold) openUntil = now + 170;
    const target = now < openUntil ? 1 : 0.002;
    gate.gain.setTargetAtTime(target, context.currentTime, target > gate.gain.value ? 0.008 : 0.045);
  }, 32);
  const processedTrack = destination.stream.getAudioTracks()[0];
  if ("contentHint" in processedTrack) processedTrack.contentHint = "speech";
  return { stream: new MediaStream([processedTrack, ...sourceStream.getVideoTracks()]), close: () => { window.clearInterval(timer); sourceTrack.stop(); processedTrack.stop(); void context.close(); } };
};
const splitUrls = (value?: string) => value?.split(",").map((url) => url.trim()).filter(Boolean) ?? [];
const stunUrls = splitUrls(import.meta.env.VITE_STUN_URL);
const turnUrls = splitUrls(import.meta.env.VITE_TURN_URL);
const iceServers: RTCIceServer[] = [
  { urls: stunUrls.length ? stunUrls : ["stun:stun.cloudflare.com:3478", "stun:stun.l.google.com:19302"] },
  ...(turnUrls.length ? [{ urls: turnUrls, username: import.meta.env.VITE_TURN_USERNAME, credential: import.meta.env.VITE_TURN_CREDENTIAL }] : []),
];

export function playSignal(kind: "join" | "leave" | "share" | "camera") {
  try {
    const Context = window.AudioContext || (window as typeof window & { webkitAudioContext: typeof AudioContext }).webkitAudioContext; const context = new Context(); const notes = kind === "join" ? [440, 660, 880] : kind === "leave" ? [720, 520, 360] : kind === "camera" ? [620, 780] : [520, 760, 1040];
    notes.forEach((frequency, index) => { const oscillator = context.createOscillator(); const gain = context.createGain(); const start = context.currentTime + index * 0.1; oscillator.frequency.value = frequency; oscillator.type = kind === "share" ? "triangle" : "sine"; gain.gain.setValueAtTime(0.0001, start); gain.gain.exponentialRampToValueAtTime(0.34, start + 0.018); gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.22); oscillator.connect(gain).connect(context.destination); oscillator.start(start); oscillator.stop(start + 0.24); });
    setTimeout(() => context.close(), 750);
  } catch { /* som de interface opcional */ }
}

export function useWebRTC() {
  const [localStream, setLocalStream] = useState<MediaStream | null>(null); const [remotePeers, setRemotePeers] = useState<RemotePeer[]>([]); const [inCall, setInCall] = useState(false); const [callChannelId, setCallChannelId] = useState(""); const [screenSharing, setScreenSharing] = useState(false); const [audioEnabled, setAudioEnabled] = useState(true); const [videoEnabled, setVideoEnabled] = useState(false); const [noiseSuppression, setNoiseSuppression] = useState(true);
  const isolatedVoiceRef = useRef<IsolatedVoice | null>(null); const reconnectTimers = useRef(new Map<string, number>()); const peers = useRef(new Map<string, RTCPeerConnection>()); const pendingCandidates = useRef(new Map<string, RTCIceCandidateInit[]>()); const peerUsers = useRef(new Map<string, PublicUser>()); const peerStates = useRef(new Map<string, { audioEnabled: boolean; videoEnabled: boolean; screenSharing: boolean }>()); const channelRef = useRef<string | undefined>(undefined); const streamRef = useRef<MediaStream | null>(null); const screenTrackRef = useRef<MediaStreamTrack | null>(null); const cameraTrackRef = useRef<MediaStreamTrack | null>(null); const cameraDeviceRef = useRef<string | undefined>(undefined);
  const publishState = useCallback((next: { audioEnabled: boolean; videoEnabled: boolean; screenSharing: boolean }) => { if (channelRef.current) getSocket().emit("call:state", { channelId: channelRef.current, ...next }); }, []);
  const negotiate = useCallback(async (id: string, peer: RTCPeerConnection) => { const offer = await peer.createOffer(); await peer.setLocalDescription(offer); getSocket().emit("webrtc:signal", { target: id, signal: { description: peer.localDescription } }); }, []);
  const updateRemote = useCallback((id: string, stream?: MediaStream) => { const user = peerUsers.current.get(id) ?? { id, username: "participante", displayName: "Participante" }; const state = peerStates.current.get(id) ?? { audioEnabled: true, videoEnabled: false, screenSharing: false }; setRemotePeers((current) => { const previous = current.find((item) => item.id === id); return [...current.filter((item) => item.id !== id), { id, stream: stream ?? previous?.stream ?? new MediaStream(), user, ...state }]; }); }, []);
  const makePeer = useCallback((id: string) => {
    const existing = peers.current.get(id);
    if (existing) return existing;
    const peer = new RTCPeerConnection({ iceServers, bundlePolicy: "max-bundle", iceCandidatePoolSize: 4 });
    peers.current.set(id, peer);
    peer.onicecandidate = ({ candidate }) => candidate && getSocket().emit("webrtc:signal", { target: id, signal: { candidate } });
    peer.ontrack = ({ track, streams }) => {
      const stream = streams[0] ?? new MediaStream([track]);
      updateRemote(id, stream);
    };
    peer.onconnectionstatechange = () => {
      if (peer.connectionState === "connected") {
        const timer = reconnectTimers.current.get(id);
        if (timer) window.clearTimeout(timer);
        reconnectTimers.current.delete(id);
      }
      if (peer.connectionState === "failed" || peer.connectionState === "disconnected") {
        if (reconnectTimers.current.has(id)) return;
        const timer = window.setTimeout(() => {
          reconnectTimers.current.delete(id);
          if (peer.connectionState === "failed" || peer.connectionState === "disconnected") {
            peer.restartIce();
            void negotiate(id, peer).catch(() => undefined);
          }
        }, peer.connectionState === "failed" ? 0 : 2500);
        reconnectTimers.current.set(id, timer);
      }
      if (peer.connectionState === "closed") {
        const timer = reconnectTimers.current.get(id);
        if (timer) window.clearTimeout(timer);
        reconnectTimers.current.delete(id);
        peers.current.delete(id);
        pendingCandidates.current.delete(id);
        setRemotePeers((items) => items.filter((item) => item.id !== id));
      }
    };
    streamRef.current?.getTracks().forEach((track) => peer.addTrack(track, streamRef.current!));
    return peer;
  }, [negotiate, updateRemote]);
  const finishScreenSharing = useCallback((screenTrack: MediaStreamTrack) => { if (screenTrackRef.current !== screenTrack) return; screenTrackRef.current = null; setScreenSharing(false); publishState({ audioEnabled, videoEnabled, screenSharing: false }); const cameraTrack = cameraTrackRef.current; streamRef.current?.removeTrack(screenTrack); if (cameraTrack && !streamRef.current?.getVideoTracks().includes(cameraTrack)) streamRef.current?.addTrack(cameraTrack); if (streamRef.current) setLocalStream(new MediaStream(streamRef.current.getTracks())); void Promise.all([...peers.current.values()].map(async (peer) => { const sender = peer.getSenders().find((item) => item.track?.kind === "video"); if (sender) await sender.replaceTrack(cameraTrack?.enabled ? cameraTrack : null); })).catch(() => undefined); playSignal("share"); }, [audioEnabled, publishState, videoEnabled]);
  const stopScreen = useCallback(() => { const track = screenTrackRef.current; if (!track) return; track.stop(); finishScreenSharing(track); }, [finishScreenSharing]);
  const disconnect = useCallback(() => { const wasInCall = !!channelRef.current; isolatedVoiceRef.current?.close(); isolatedVoiceRef.current = null; if (channelRef.current) getSocket().emit("call:leave", channelRef.current); peers.current.forEach((peer) => peer.close()); peers.current.clear(); peerUsers.current.clear(); peerStates.current.clear(); streamRef.current?.getTracks().forEach((track) => track.stop()); streamRef.current = null; screenTrackRef.current = null; cameraTrackRef.current = null; channelRef.current = undefined; setCallChannelId(""); setLocalStream(null); setRemotePeers([]); setInCall(false); setScreenSharing(false); setAudioEnabled(true); setVideoEnabled(false); if (wasInCall) playSignal("leave"); }, []);
  const join = useCallback(async (channelId: string, inputDeviceId?: string, cameraDeviceId?: string) => { if (channelRef.current === channelId) return; disconnect(); cameraDeviceRef.current = cameraDeviceId; let stream = new MediaStream(); let microphoneAvailable = false; try { stream = await navigator.mediaDevices.getUserMedia({ audio: microphoneConstraints(inputDeviceId, noiseSuppression), video: false }); if (noiseSuppression) { isolatedVoiceRef.current = await isolateVoice(stream); stream = isolatedVoiceRef.current.stream; } microphoneAvailable = stream.getAudioTracks().length > 0; } catch (error) { console.warn("Entrada de microfone indisponível; entrando como ouvinte.", error); } const audioTrack = stream.getAudioTracks()[0]; if (audioTrack && "contentHint" in audioTrack) audioTrack.contentHint = "speech"; streamRef.current = stream; setLocalStream(new MediaStream(stream.getTracks())); channelRef.current = channelId; setCallChannelId(channelId); setInCall(true); setAudioEnabled(microphoneAvailable); setVideoEnabled(false); const socket = getSocket(); socket.emit("call:join", channelId); socket.emit("call:state", { channelId, audioEnabled: microphoneAvailable, videoEnabled: false, screenSharing: false }); playSignal("join"); }, [disconnect, noiseSuppression]);
  const toggleNoiseSuppression = useCallback(async () => { const next = !noiseSuppression; const track = streamRef.current?.getAudioTracks()[0]; if (track) await track.applyConstraints(microphoneConstraints(undefined, next)); setNoiseSuppression(next); return next; }, [noiseSuppression]);
  const switchAudioInput = useCallback(async (deviceId?: string) => { if (!streamRef.current) return; let replacementStream = await navigator.mediaDevices.getUserMedia({ audio: microphoneConstraints(deviceId, noiseSuppression), video: false }); isolatedVoiceRef.current?.close(); isolatedVoiceRef.current = noiseSuppression ? await isolateVoice(replacementStream) : null; if (isolatedVoiceRef.current) replacementStream = isolatedVoiceRef.current.stream; const replacement = replacementStream.getAudioTracks()[0]; const previous = streamRef.current.getAudioTracks()[0]; replacement.enabled = previous?.enabled ?? true; if ("contentHint" in replacement) replacement.contentHint = "speech"; for (const peer of peers.current.values()) { const sender = peer.getSenders().find((item) => item.track?.kind === "audio"); if (sender) await sender.replaceTrack(replacement); else peer.addTrack(replacement, streamRef.current); } if (previous) { streamRef.current.removeTrack(previous); previous.stop(); } streamRef.current.addTrack(replacement); setLocalStream(new MediaStream(streamRef.current.getTracks())); }, [noiseSuppression]);
  const toggleAudio = useCallback(async () => { let track = streamRef.current?.getAudioTracks()[0]; if (!track && streamRef.current) { const microphone = await navigator.mediaDevices.getUserMedia({ audio: microphoneConstraints(undefined, noiseSuppression), video: false }); track = microphone.getAudioTracks()[0]; if (track) { if ("contentHint" in track) track.contentHint = "speech"; streamRef.current.addTrack(track); for (const [id, peer] of peers.current) { peer.addTrack(track, streamRef.current); await negotiate(id, peer); } setLocalStream(new MediaStream(streamRef.current.getTracks())); } } if (!track) return false; track.enabled = !audioEnabled; setAudioEnabled(track.enabled); publishState({ audioEnabled: track.enabled, videoEnabled, screenSharing }); return track.enabled; }, [audioEnabled, negotiate, noiseSuppression, publishState, screenSharing, videoEnabled]);
  const toggleVideo = useCallback(async () => { if (!streamRef.current) return false; let track = cameraTrackRef.current; if (!track) { const camera = await navigator.mediaDevices.getUserMedia({ video: { deviceId: cameraDeviceRef.current ? { exact: cameraDeviceRef.current } : undefined, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } }, audio: false }); track = camera.getVideoTracks()[0]; cameraTrackRef.current = track; streamRef.current.addTrack(track); for (const [id, peer] of peers.current) { peer.addTrack(track, streamRef.current); await negotiate(id, peer); } } else track.enabled = !track.enabled; const enabled = track.enabled; setVideoEnabled(enabled); setLocalStream(new MediaStream(streamRef.current.getTracks())); publishState({ audioEnabled, videoEnabled: enabled, screenSharing }); return enabled; }, [audioEnabled, negotiate, publishState, screenSharing]);
  const shareScreen = useCallback(async (quality: Quality) => { if (!streamRef.current || screenTrackRef.current) return; if (typeof navigator.mediaDevices?.getDisplayMedia !== "function") throw new DOMException("O navegador deste celular não permite compartilhar a tela. No iPhone/iPad, use um computador para transmitir; pelo celular você ainda pode assistir.", "NotSupportedError"); const display = await navigator.mediaDevices.getDisplayMedia({ video: { width: { ideal: quality.width }, height: { ideal: quality.height }, frameRate: { ideal: quality.frameRate, max: quality.frameRate } }, audio: true }); const screenTrack = display.getVideoTracks()[0]; if ("contentHint" in screenTrack) screenTrack.contentHint = "detail"; screenTrackRef.current = screenTrack; const oldVisibleTrack = streamRef.current.getVideoTracks()[0]; if (oldVisibleTrack) streamRef.current.removeTrack(oldVisibleTrack); streamRef.current.addTrack(screenTrack); setLocalStream(new MediaStream(streamRef.current.getTracks())); setScreenSharing(true); publishState({ audioEnabled, videoEnabled, screenSharing: true }); playSignal("share"); screenTrack.onended = () => finishScreenSharing(screenTrack); void Promise.all([...peers.current.entries()].map(async ([id, peer]) => { let sender = peer.getSenders().find((item) => item.track?.kind === "video"); if (sender) await sender.replaceTrack(screenTrack); else { sender = peer.addTrack(screenTrack, streamRef.current!); await negotiate(id, peer); } const parameters = sender.getParameters(); parameters.encodings = parameters.encodings?.length ? parameters.encodings : [{}]; parameters.encodings[0].maxBitrate = quality.height >= 2160 ? 25_000_000 : quality.height >= 1440 ? 16_000_000 : 10_000_000; parameters.degradationPreference = "maintain-resolution"; await sender.setParameters(parameters).catch(() => undefined); })).catch(() => undefined); }, [audioEnabled, finishScreenSharing, negotiate, publishState, videoEnabled]);
  useEffect(() => { const socket = getSocket(); const peerJoined = async ({ socketId, user }: { socketId: string; user: PublicUser }) => { peerUsers.current.set(socketId, user); updateRemote(socketId); const peer = makePeer(socketId); await negotiate(socketId, peer); playSignal("join"); }; const signal = async ({ from, signal }: { from: string; signal: unknown }) => { const peer = makePeer(from); const data = signal as { description?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit }; try { if (data.description) { await peer.setRemoteDescription(data.description); const queued = pendingCandidates.current.get(from) ?? []; pendingCandidates.current.delete(from); for (const candidate of queued) await peer.addIceCandidate(candidate); if (data.description.type === "offer") { const answer = await peer.createAnswer(); await peer.setLocalDescription(answer); socket.emit("webrtc:signal", { target: from, signal: { description: peer.localDescription } }); } } else if (data.candidate) { if (peer.remoteDescription) await peer.addIceCandidate(data.candidate); else pendingCandidates.current.set(from, [...(pendingCandidates.current.get(from) ?? []), data.candidate]); } } catch (error) { console.warn("Falha na negociação WebRTC", error); } }; const left = ({ socketId }: { socketId: string }) => { peers.current.get(socketId)?.close(); peers.current.delete(socketId); pendingCandidates.current.delete(socketId); peerUsers.current.delete(socketId); peerStates.current.delete(socketId); setRemotePeers((items) => items.filter((item) => item.id !== socketId)); playSignal("leave"); }; const state = ({ socketId, user, audioEnabled: remoteAudio, videoEnabled: remoteVideo, screenSharing: remoteScreen }: { socketId: string; user: PublicUser; audioEnabled: boolean; videoEnabled: boolean; screenSharing: boolean }) => { const previous = peerStates.current.get(socketId); peerUsers.current.set(socketId, user); peerStates.current.set(socketId, { audioEnabled: remoteAudio, videoEnabled: remoteVideo, screenSharing: remoteScreen }); updateRemote(socketId); if (previous && previous.screenSharing !== remoteScreen) playSignal("share"); if (previous && !previous.videoEnabled && remoteVideo) playSignal("camera"); }; socket.on("webrtc:peer-joined", peerJoined); socket.on("webrtc:signal", signal); socket.on("webrtc:peer-left", left); socket.on("call:state", state); return () => { socket.off("webrtc:peer-joined", peerJoined); socket.off("webrtc:signal", signal); socket.off("webrtc:peer-left", left); socket.off("call:state", state); }; }, [makePeer, negotiate, updateRemote]);
  useEffect(() => { const socket = getSocket(); const moderated = ({ action }: { action: "mute" | "stop-screen" }) => { if (action === "mute") { const track = streamRef.current?.getAudioTracks()[0]; if (track) { track.enabled = false; setAudioEnabled(false); publishState({ audioEnabled: false, videoEnabled, screenSharing }); } } else stopScreen(); }; socket.on("call:moderated", moderated); return () => { socket.off("call:moderated", moderated); }; }, [publishState, screenSharing, stopScreen, videoEnabled]);
  useEffect(() => {
    const socket = getSocket();
    const restoreCall = () => {
      const channelId = channelRef.current;
      if (!channelId) return;
      peers.current.forEach((peer) => peer.close());
      peers.current.clear();
      peerUsers.current.clear();
      peerStates.current.clear();
      setRemotePeers([]);
      const audioTrack = streamRef.current?.getAudioTracks()[0];
      const cameraTrack = cameraTrackRef.current;
      const screenTrack = screenTrackRef.current;
      socket.emit("call:join", channelId);
      socket.emit("call:state", { channelId, audioEnabled: !!audioTrack?.enabled, videoEnabled: !!cameraTrack?.enabled, screenSharing: !!screenTrack });
    };
    const resume = () => {
      if (!channelRef.current || document.visibilityState === "hidden") return;
      if (!socket.connected) socket.connect();
    };
    socket.on("connect", restoreCall);
    window.addEventListener("online", resume);
    window.addEventListener("focus", resume);
    document.addEventListener("visibilitychange", resume);
    return () => {
      socket.off("connect", restoreCall);
      window.removeEventListener("online", resume);
      window.removeEventListener("focus", resume);
      document.removeEventListener("visibilitychange", resume);
    };
  }, []);
  return { localStream, remotePeers, inCall, callChannelId, screenSharing, audioEnabled, videoEnabled, noiseSuppression, join, leave: () => undefined, disconnect, shareScreen, stopScreen, toggleAudio, toggleVideo, toggleNoiseSuppression, switchAudioInput };
}




