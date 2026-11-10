
import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import socket from "../socket";
import { getAvatarUrl } from "../utils/url";
import "../css/CallManager.css";

const CALL_TIMEOUT_MS = 45000;
const END_SCREEN_MS = 3000;
const MIN_CALL_WIDTH = 340;
const MIN_CALL_HEIGHT = 380;
const INCOMING_RINGTONE = "/audio/calls/tono-llamada-entrante.mp3";
const OUTGOING_RINGTONE = "/audio/calls/tono-llamada-saliente.mp3";

const permissionEnabled = (permissions, key) => {
  let parsed = permissions || {};
  if (typeof parsed === "string") {
    try { parsed = JSON.parse(parsed); } catch { parsed = {}; }
  }
  return [1, "1", true, "true"].includes(parsed?.[key]);
};

const buildIceServers = () => {
  const servers = [{ urls: "stun:stun.l.google.com:19302" }];
  const turnUrl = String(import.meta.env.VITE_TURN_URL || "").trim();
  if (turnUrl) {
    servers.push({
      urls: turnUrl.split(",").map((item) => item.trim()).filter(Boolean),
      username: import.meta.env.VITE_TURN_USERNAME || "",
      credential: import.meta.env.VITE_TURN_CREDENTIAL || "",
    });
  }
  return servers;
};

const ICE_CONFIG = { iceServers: buildIceServers(), iceCandidatePoolSize: 10 };
const displayName = (person = {}) => String(person.nombre_completo || person.nombre || person.usuario_nombre || person.name || "Usuario").trim();
const initials = (person = {}) => displayName(person).split(/\s+/).slice(0, 2).map((part) => part.charAt(0).toUpperCase()).join("") || "U";

function Avatar({ person = {}, className = "", large = false }) {
  const avatar = person?.url_imagen ? getAvatarUrl(person.url_imagen) : "";
  if (avatar) {
    return <img className={className} src={avatar} alt={displayName(person)} draggable={false} />;
  }
  return (
    <span className={`qc-call-default-avatar ${large ? "is-large" : ""} ${className}`.trim()} aria-label={displayName(person)}>
      <i className="fa-solid fa-user" />
    </span>
  );
}

// Iconos vectoriales integrados: estados claros de iniciar y detener la pantalla.
function ShareScreenIcon({ sharing = false }) {
  return sharing ? (
    <svg className="qc-share-screen-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
      <rect x="2.75" y="4.2" width="18.5" height="13.2" rx="2.15" stroke="currentColor" strokeWidth="2" />
      <path d="M8.5 8.25l7 5.5M15.5 8.25l-7 5.5" stroke="currentColor" strokeWidth="2.15" strokeLinecap="round" />
      <path d="M9.2 20h5.6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  ) : (
    <svg className="qc-share-screen-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
      <rect x="2.75" y="4.2" width="18.5" height="13.2" rx="2.15" stroke="currentColor" strokeWidth="2" />
      <path d="M9.2 20h5.6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M7.5 13.8l7.1-6.8m-4.8.1h4.8v4.8" stroke="currentColor" strokeWidth="2.1" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function RemoteAudioSink({ stream, muted = false, outputDeviceId = "", volume = 1 }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !stream) return;
    if (el.srcObject !== stream) el.srcObject = stream;
    el.muted = Boolean(muted);
    el.volume = Math.max(0, Math.min(1, Number(volume) || 0));
    if (outputDeviceId && typeof el.setSinkId === "function") {
      el.setSinkId(outputDeviceId).catch(() => {});
    }
    const play = el.play();
    if (play?.catch) play.catch(() => {});
  }, [stream, muted, outputDeviceId, volume]);
  return <audio ref={ref} autoPlay playsInline style={{ display: "none" }} />;
}

function MediaTile({
  stream,
  muted = false,
  local = false,
  videoEnabled = true,
  person = {},
  mediaState = {},
  locallyMuted = false,
  localPreviewVisible = true,
  onSpeakingChange,
  speakerId,
  onToggleLocalMute,
  onToggleDeafen,
  onTogglePreview,
  onOpenPreview,
  onOpenSettings,
  screenAvailable = false,
  onOpenScreen,
}) {
  const videoRef = useRef(null);
  const rafRef = useRef(null);
  const audioCtxRef = useRef(null);
  const [speaking, setSpeaking] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const hasVideoTrack = Boolean(videoEnabled && stream?.getVideoTracks?.().some((track) => track.enabled !== false));
  const showVideo = hasVideoTrack && (!local || localPreviewVisible);

  useEffect(() => {
    if (videoRef.current && stream && videoRef.current.srcObject !== stream) videoRef.current.srcObject = stream;
  }, [stream]);

  useEffect(() => {
    setSpeaking(false);
    if (!stream) return undefined;
    const track = stream.getAudioTracks?.()[0];
    if (!track) return undefined;
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return undefined;
      const ctx = new AudioCtx();
      audioCtxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.72;
      source.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      let activeFrames = 0;
      const tick = () => {
        analyser.getByteFrequencyData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i += 1) sum += data[i];
        const avg = sum / data.length;
        if (avg > 10 && !mediaState?.micMuted && !mediaState?.deafened) activeFrames += 1;
        else activeFrames = Math.max(0, activeFrames - 1);
        const nextSpeaking = activeFrames > 1;
        setSpeaking(nextSpeaking);
        onSpeakingChange?.(speakerId, nextSpeaking);
        rafRef.current = window.requestAnimationFrame(tick);
      };
      rafRef.current = window.requestAnimationFrame(tick);
    } catch {
      setSpeaking(false);
    }
    return () => {
      if (rafRef.current) window.cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      if (audioCtxRef.current) {
        audioCtxRef.current.close().catch(() => {});
        audioCtxRef.current = null;
      }
    };
  }, [stream, speakerId, onSpeakingChange, mediaState?.micMuted, mediaState?.deafened]);

  useEffect(() => () => onSpeakingChange?.(speakerId, false), [speakerId, onSpeakingChange]);

  return (
    <div
      className={`qc-call-tile ${local ? "is-local" : ""} ${showVideo ? "has-video" : "audio-only"} ${speaking ? "is-speaking" : ""} ${screenAvailable ? "has-screen-share" : ""}`}
      onClick={(event) => {
        // Los controles del participante conservan sus propias acciones.
        if (event.target.closest("button, a, .qc-call-participant-menu")) return;
        if (screenAvailable) onOpenScreen?.();
        else setMenuOpen((value) => !value);
      }}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget || !["Enter", " "].includes(event.key)) return;
        event.preventDefault();
        if (screenAvailable) onOpenScreen?.();
        else setMenuOpen((value) => !value);
      }}
      role="button"
      tabIndex={0}
      aria-label={screenAvailable ? `Ver transmisión de ${local ? "tú" : displayName(person)}` : `Opciones de ${local ? "tu perfil" : displayName(person)}`}
    >
      {showVideo && stream ? (
        <video ref={videoRef} autoPlay playsInline muted />
      ) : (
        <div className="qc-call-audio-stage">
          <div className={`qc-call-avatar-wrap ${speaking ? "is-speaking" : ""}`}>
            {person?.url_imagen ? (
              <img src={getAvatarUrl(person.url_imagen)} alt={displayName(person)} draggable={false} />
            ) : (
              <span style={{ background: person?.background || "linear-gradient(145deg,#2f6bf6,#6d4cff)" }}>{initials(person)}</span>
            )}
          </div>
        </div>
      )}

      {screenAvailable && (
        <button type="button" className="qc-call-live-badge" onClick={() => onOpenScreen?.()} title="Ver transmisión">
          <span>EN VIVO</span><i className="fa-solid fa-display" />
        </button>
      )}

      <div className="qc-call-participant-flags" aria-label="Estado del participante">
        {mediaState?.deafened && <span className="is-deafened" title="Ensordecido"><i className="fa-solid fa-headphones-simple" /><i className="fa-solid fa-slash qc-flag-slash" /></span>}
        {!mediaState?.deafened && mediaState?.micMuted && <span className="is-muted" title="Micrófono silenciado"><i className="fa-solid fa-microphone-slash" /></span>}
        {locallyMuted && !local && <span title="Lo silenciaste para ti"><i className="fa-solid fa-volume-xmark" /></span>}
      </div>

      <button className="qc-call-tile-more" type="button" onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v); }} title="Opciones del participante" aria-label="Opciones del participante">
        <i className="fa-solid fa-ellipsis" />
      </button>

      {menuOpen && (
        <div className="qc-call-participant-menu" onClick={(e) => e.stopPropagation()}>
          <button type="button"><i className="fa-solid fa-user" /><span>Ver perfil</span></button>
          {!local && (
            <button type="button" onClick={() => onToggleLocalMute?.()}>
              <i className={`fa-solid ${locallyMuted ? "fa-volume-high" : "fa-volume-xmark"}`} />
              <span>{locallyMuted ? "Dejar de silenciar" : "Silenciar"}</span>
              <span className={`qc-menu-check ${locallyMuted ? "checked" : ""}`} />
            </button>
          )}
          {local && (
            <>
              <button type="button" onClick={() => onToggleDeafen?.()}>
                <i className="fa-solid fa-headphones" /><span>Ensordecer</span><span className={`qc-menu-check ${mediaState?.deafened ? "checked" : ""}`} />
              </button>
              <button type="button" onClick={() => onTogglePreview?.()}>
                <i className="fa-solid fa-video" /><span>Mostrar mi cámara</span><span className={`qc-menu-check ${localPreviewVisible ? "checked" : ""}`} />
              </button>
              <button type="button" onClick={() => onOpenPreview?.()}><i className="fa-solid fa-eye" /><span>Vista previa de la cámara</span></button>
              <button type="button" onClick={() => onOpenSettings?.()}><i className="fa-solid fa-gear" /><span>Ajustes de voz y video</span></button>
            </>
          )}
        </div>
      )}

      <div className="qc-call-tile-name">{local ? "Tú" : displayName(person)}</div>
    </div>
  );
}


// Una transmisión anunciada aparece en la cuadrícula sin suscribirse a WebRTC
// hasta que el espectador pulse "Ver transmisión" (comportamiento tipo Discord).
function ScreenSharePreview({ person = {}, onWatch, requesting = false }) {
  return (
    <div className="qc-screen-preview" aria-label={`Transmisión disponible de ${displayName(person)}`}>
      <span className="qc-screen-preview-live"><i className="fa-solid fa-display" /> EN VIVO</span>
      <div className="qc-screen-preview-center">
        <div className="qc-screen-preview-avatar"><Avatar person={person} /></div>
        <strong>{displayName(person)} está compartiendo su pantalla</strong>
        <button type="button" className="qc-screen-preview-watch" onClick={onWatch} disabled={requesting}>
          <i className={`fa-solid ${requesting ? "fa-circle-notch fa-spin" : "fa-play"}`} />
          {requesting ? "Conectando…" : "Ver transmisión"}
        </button>
      </div>
    </div>
  );
}

function ScreenShareVideo({ stream, person = {}, local = false, focused = false, onFocus, onStopWatching, onExitFocus, viewerCount = 0 }) {
  const ref = useRef(null);
  const [playBlocked, setPlayBlocked] = useState(false);
  const playVideo = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const result = el.play();
    if (result?.then) result.then(() => setPlayBlocked(false)).catch(() => setPlayBlocked(true));
  }, []);
  useEffect(() => {
    const el = ref.current;
    if (!el || !stream) return;
    if (el.srcObject !== stream) el.srcObject = stream;
    playVideo();
  }, [stream, playVideo]);
  return (
    <div className={`qc-screen-stream ${focused ? "is-focused" : ""} ${onFocus ? "is-interactive" : ""}`} onClick={onFocus ? () => onFocus() : undefined} onKeyDown={onFocus ? (event) => { if (["Enter", " "].includes(event.key) && event.target === event.currentTarget) { event.preventDefault(); onFocus(); } } : undefined} role={onFocus ? "button" : undefined} tabIndex={onFocus ? 0 : undefined} aria-label={onFocus ? (focused ? "Mostrar u ocultar controles" : "Ampliar transmisión") : undefined}>
      {stream ? <video ref={ref} autoPlay playsInline muted={local} /> : (
        <div className="qc-screen-stream-loading"><i className="fa-solid fa-circle-notch fa-spin" /> Conectando transmisión…</div>
      )}
      <div className="qc-screen-stream-top">
        <span className="qc-screen-live-pill">EN VIVO</span>
        <strong>{local ? "Tu transmisión" : displayName(person)}</strong>
      </div>
      {focused && onExitFocus && (
        <button type="button" className="qc-screen-exit-focus" onClick={(event) => { event.stopPropagation(); onExitFocus(); }} title="Volver a participantes" aria-label="Volver a participantes">
          <i className="fa-solid fa-table-cells-large" /><span>Volver a participantes</span>
        </button>
      )}
      {playBlocked && <button className="qc-screen-play-button" type="button" onClick={(event) => { event.stopPropagation(); playVideo(); }}><i className="fa-solid fa-play" /> Reproducir transmisión</button>}
      <div className="qc-screen-stream-bottom">
        <span><i className="fa-solid fa-eye" /> {viewerCount} {viewerCount === 1 ? "espectador" : "espectadores"}</span>
        {!local && onStopWatching && <button type="button" onClick={(e) => { e.stopPropagation(); onStopWatching(); }}>Dejar de ver</button>}
      </div>
    </div>
  );
}

const CallManager = forwardRef(function CallManager({ user }, ref) {
  const [incoming, setIncoming] = useState(null);
  const [call, setCall] = useState(null);
  const [localStream, setLocalStream] = useState(null);
  const [remoteStreams, setRemoteStreams] = useState({});
  const [micEnabled, setMicEnabled] = useState(true);
  const [cameraEnabled, setCameraEnabled] = useState(true);
  const [statusText, setStatusText] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [cameraPending, setCameraPending] = useState(false);
  const [speakerEnabled, setSpeakerEnabled] = useState(true);
  const [deafened, setDeafened] = useState(false);
  const [participantStates, setParticipantStates] = useState({});
  const [locallyMutedPeers, setLocallyMutedPeers] = useState({});
  const [localPreviewVisible, setLocalPreviewVisible] = useState(true);
  const [confirmHidePreview, setConfirmHidePreview] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [devices, setDevices] = useState({ audioinput: [], audiooutput: [], videoinput: [] });
  const [selectedDevices, setSelectedDevices] = useState({ audioinput: "", audiooutput: "", videoinput: "" });
  const [speakerVolume, setSpeakerVolume] = useState(1);
  const [micVolume, setMicVolume] = useState(1);
  const [minimized, setMinimized] = useState(false);
  const [popoutHost, setPopoutHost] = useState(null);
  const [speakingUsers, setSpeakingUsers] = useState({});
  const [screenPickerOpen, setScreenPickerOpen] = useState(false);
  const [screenPickerTab, setScreenPickerTab] = useState("applications");
  const [screenShareActive, setScreenShareActive] = useState(false);
  const [availableScreenShares, setAvailableScreenShares] = useState({});
  const [remoteScreenStreams, setRemoteScreenStreams] = useState({});
  const [watchedScreens, setWatchedScreens] = useState({});
  const [focusedScreenOwner, setFocusedScreenOwner] = useState(null);
  const [controlsPinned, setControlsPinned] = useState(false);
  const [screenViewerCounts, setScreenViewerCounts] = useState({});
  const [requestingScreenOwner, setRequestingScreenOwner] = useState(null);
  const [windowRect, setWindowRect] = useState(() => ({ x: 0, y: 0, width: 700, height: 500 }));
  const [compactRect, setCompactRect] = useState(() => ({ x: 18, y: Math.max(18, (window.innerHeight || 768) - 110), width: Math.min(760, (window.innerWidth || 1000) - 36), height: 78 }));

  const peersRef = useRef(new Map());
  const localStreamRef = useRef(null);
  const callRef = useRef(null);
  const incomingRef = useRef(null);
  const timerRef = useRef(null);
  const endTimerRef = useRef(null);
  const interactionRef = useRef(null);
  const ringAudioRef = useRef(null);
  const statusTimerRef = useRef(null);
  const popoutWindowRef = useRef(null);
  const callWindowRef = useRef(null);
  const previewVideoRef = useRef(null);
  const previewStreamRef = useRef(null);
  const deafenPrevMicRef = useRef(true);
  const screenStreamRef = useRef(null);
  const screenSharesRef = useRef({});
  const screenSendersRef = useRef(new Map());
  const mainRemoteStreamIdsRef = useRef(new Map());
  const pendingScreenViewersRef = useRef(new Set());
  const speakerActivitySeqRef = useRef(0);
  const queuedRenegotiationsRef = useRef(new Map());

  useEffect(() => { callRef.current = call; }, [call]);
  useEffect(() => { incomingRef.current = incoming; }, [incoming]);
  useEffect(() => { screenSharesRef.current = availableScreenShares; }, [availableScreenShares]);

  const showStatus = (message, duration = 3000) => {
    if (statusTimerRef.current) window.clearTimeout(statusTimerRef.current);
    setStatusText(message);
    statusTimerRef.current = window.setTimeout(() => {
      setStatusText("");
      statusTimerRef.current = null;
    }, duration);
  };

  const emitMediaState = (overrides = {}) => {
    const current = callRef.current;
    if (!current?.callId || current.phase === "ended") return;
    socket.emit("call:media-state", {
      callId: current.callId,
      micMuted: overrides.micMuted ?? !micEnabled,
      deafened: overrides.deafened ?? deafened,
      cameraEnabled: overrides.cameraEnabled ?? cameraEnabled,
    });
  };


  const playStreamPresenceSound = (joined = true) => {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(joined ? 660 : 420, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(joined ? 880 : 300, ctx.currentTime + .12);
      gain.gain.setValueAtTime(.0001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(.055, ctx.currentTime + .015);
      gain.gain.exponentialRampToValueAtTime(.0001, ctx.currentTime + .18);
      osc.connect(gain); gain.connect(ctx.destination); osc.start(); osc.stop(ctx.currentTime + .2);
      window.setTimeout(() => ctx.close().catch(() => {}), 260);
    } catch {}
  };

  const renegotiatePeer = async (peerUserId) => {
    const current = callRef.current;
    const key = String(peerUserId);
    const pc = peersRef.current.get(key);
    if (!current?.callId || !pc || pc.signalingState === "closed") return;
    // La suscripción automática puede llegar durante la oferta inicial.
    // Esperar al estado stable evita que se pierda la renegociación de pantalla.
    if (pc.signalingState !== "stable") {
      if (!queuedRenegotiationsRef.current.has(key)) {
        const onStable = () => {
          if (pc.signalingState !== "stable" && pc.signalingState !== "closed") return;
          pc.removeEventListener("signalingstatechange", onStable);
          queuedRenegotiationsRef.current.delete(key);
          if (pc.signalingState === "stable" && peersRef.current.get(key) === pc) renegotiatePeer(peerUserId);
        };
        queuedRenegotiationsRef.current.set(key, { pc, listener: onStable });
        pc.addEventListener("signalingstatechange", onStable);
      }
      return;
    }
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit("call:offer", { callId: current.callId, toUserId: Number(peerUserId), sdp: pc.localDescription });
    } catch (error) {
      console.warn("No se pudo renegociar WebRTC:", error);
    }
  };

  const stopScreenShare = (notify = true) => {
    const current = callRef.current;
    const stream = screenStreamRef.current;
    if (stream) stream.getTracks().forEach((track) => { try { track.stop(); } catch {} });
    screenStreamRef.current = null;
    setScreenShareActive(false);
    setFocusedScreenOwner((prev) => String(prev) === String(user?.id) ? null : prev);
    setWatchedScreens((prev) => { const next = { ...prev }; delete next[String(user?.id)]; return next; });
    screenSendersRef.current.forEach((senders, peerId) => {
      const pc = peersRef.current.get(String(peerId));
      if (pc) senders.forEach((sender) => { try { pc.removeTrack(sender); } catch {} });
      renegotiatePeer(peerId);
    });
    screenSendersRef.current.clear();
    pendingScreenViewersRef.current.clear();
    if (notify && current?.callId) socket.emit("call:screen-stop", { callId: current.callId });
  };

  const startScreenShare = async (sourceType = screenPickerTab) => {
    const current = callRef.current;
    if (!current?.callId || current.phase !== "connected") {
      showStatus("La pantalla se puede compartir cuando la llamada esté conectada");
      return;
    }
    try {
      let stream;
      let label = "Pantalla";
      if (sourceType === "device") {
        const deviceId = selectedDevices.videoinput || devices.videoinput[0]?.deviceId || "";
        stream = await navigator.mediaDevices.getUserMedia({ video: deviceId ? { deviceId: { exact: deviceId } } : true, audio: false });
        label = devices.videoinput.find((item) => item.deviceId === deviceId)?.label || "Dispositivo de video";
      } else {
        const displaySurface = sourceType === "screen" ? "monitor" : "window";
        stream = await navigator.mediaDevices.getDisplayMedia({
          video: { displaySurface, frameRate: { ideal: 30, max: 30 } },
          audio: true,
          preferCurrentTab: false,
          selfBrowserSurface: "exclude",
          surfaceSwitching: "include",
          systemAudio: "include",
        });
        label = sourceType === "screen" ? "Pantalla completa" : "Aplicación";
      }
      if (!stream?.getVideoTracks?.().length) throw new Error("NO_VIDEO");
      stopScreenShare(false);
      screenStreamRef.current = stream;
      setScreenShareActive(true);
      setWatchedScreens((prev) => ({ ...prev, [String(user?.id)]: true }));
      // Mantener vista de participantes; pulsar la miniatura para ampliar.
      setFocusedScreenOwner(null);
      const videoTrack = stream.getVideoTracks()[0];
      label = videoTrack?.label || label;
      videoTrack.addEventListener("ended", () => stopScreenShare(true), { once: true });
      socket.emit("call:screen-start", {
        callId: current.callId,
        sourceType,
        label,
        streamId: stream.id,
      }, (response = {}) => {
        if (!response.ok) {
          stopScreenShare(false);
          showStatus(response.error || "No se pudo iniciar la transmisión");
        }
      });
      setAvailableScreenShares((prev) => ({
        ...prev,
        [String(user?.id)]: { ownerUserId: Number(user?.id), sourceType, label, streamId: stream.id },
      }));
      setScreenPickerOpen(false);
    } catch (error) {
      if (error?.name !== "NotAllowedError") showStatus("No se pudo compartir la pantalla");
      else showStatus("Se canceló o bloqueó el permiso para compartir");
    }
  };

  const toggleWatchScreen = (ownerUserId, forceValue) => {
    const ownerKey = String(ownerUserId);
    const current = callRef.current;
    if (!current?.callId) return;
    const nextValue = forceValue ?? !watchedScreens[ownerKey];
    if (Number(ownerUserId) === Number(user?.id)) {
      setWatchedScreens((prev) => ({ ...prev, [ownerKey]: nextValue }));
      setFocusedScreenOwner(nextValue ? ownerKey : null);
      return;
    }
    setRequestingScreenOwner(ownerKey);
    socket.timeout(8000).emit("call:screen-watch", { callId: current.callId, ownerUserId: Number(ownerUserId), watching: nextValue }, (error, response = {}) => {
      setRequestingScreenOwner((prev) => prev === ownerKey ? null : prev);
      if (error || !response.ok) return showStatus(response.error || "No se pudo abrir la transmisión");
      if (callRef.current?.callId !== current.callId) return;
      setWatchedScreens((prev) => ({ ...prev, [ownerKey]: nextValue }));
      if (nextValue) setFocusedScreenOwner(ownerKey);
      else {
        setRemoteScreenStreams((prev) => { const next = { ...prev }; delete next[ownerKey]; return next; });
        setFocusedScreenOwner((prev) => String(prev) === ownerKey ? null : prev);
      }
    });
  };

  const refreshDevices = async () => {
    try {
      const list = await navigator.mediaDevices.enumerateDevices();
      const grouped = { audioinput: [], audiooutput: [], videoinput: [] };
      list.forEach((item) => { if (grouped[item.kind]) grouped[item.kind].push(item); });
      setDevices(grouped);
      setSelectedDevices((prev) => ({
        audioinput: prev.audioinput || grouped.audioinput[0]?.deviceId || "",
        audiooutput: prev.audiooutput || grouped.audiooutput[0]?.deviceId || "",
        videoinput: prev.videoinput || grouped.videoinput[0]?.deviceId || "",
      }));
    } catch {}
  };

  const closePopout = () => {
    const popup = popoutWindowRef.current;
    popoutWindowRef.current = null;
    setPopoutHost(null);
    if (popup && !popup.closed) {
      try { popup.close(); } catch {}
    }
  };

  const openPopout = () => {
    if (popoutWindowRef.current && !popoutWindowRef.current.closed) {
      popoutWindowRef.current.focus();
      return;
    }
    const popup = window.open("", `quickchat_call_${callRef.current?.callId || "active"}`, "popup=yes,width=860,height=640,resizable=yes,scrollbars=no");
    if (!popup) {
      showStatus("El navegador bloqueó la ventana emergente");
      return;
    }
    popup.document.open();
    popup.document.write(`<!doctype html><html><head><title>${callRef.current?.title || "Llamada"} - QuickChat</title></head><body><div id="quickchat-call-popout"></div></body></html>`);
    popup.document.close();
    document.querySelectorAll('link[rel="stylesheet"], style').forEach((node) => {
      try { popup.document.head.appendChild(node.cloneNode(true)); } catch {}
    });
    popup.document.documentElement.setAttribute("data-theme", document.documentElement.getAttribute("data-theme") || "dark");
    popup.document.body.className = document.body.className;
    popup.document.body.style.margin = "0";
    popup.document.body.style.overflow = "hidden";
    const mount = popup.document.getElementById("quickchat-call-popout");
    popoutWindowRef.current = popup;
    setMinimized(false);
    setPopoutHost(mount);
    const returnToChat = () => {
      popoutWindowRef.current = null;
      setPopoutHost(null);
    };
    popup.addEventListener("beforeunload", returnToChat, { once: true });
  };

  const toggleFullscreen = async () => {
    const el = callWindowRef.current;
    if (!el) return;
    const doc = el.ownerDocument || document;
    try {
      if (doc.fullscreenElement) await doc.exitFullscreen();
      else await el.requestFullscreen();
    } catch {
      showStatus("No se pudo activar pantalla completa");
    }
  };

  const resetWindowRect = () => {
    const vw = window.innerWidth || 1366;
    const vh = window.innerHeight || 768;
    const width = Math.min(700, Math.max(MIN_CALL_WIDTH, vw - 48));
    const height = Math.min(500, Math.max(MIN_CALL_HEIGHT, vh - 80));
    const x = Math.max(12, vw - width - 24);
    const y = Math.max(12, vh - height - 24);
    setWindowRect({ x, y, width, height });
  };

  const clampWindowRect = (rect) => {
    const vw = window.innerWidth || rect.width;
    const vh = window.innerHeight || rect.height;
    const width = Math.min(Math.max(rect.width, MIN_CALL_WIDTH), Math.max(MIN_CALL_WIDTH, vw - 16));
    const height = Math.min(Math.max(rect.height, MIN_CALL_HEIGHT), Math.max(MIN_CALL_HEIGHT, vh - 16));
    return {
      width,
      height,
      x: Math.min(Math.max(8, rect.x), Math.max(8, vw - width - 8)),
      y: Math.min(Math.max(8, rect.y), Math.max(8, vh - height - 8)),
    };
  };

  useEffect(() => {
    const onResize = () => setWindowRect((prev) => clampWindowRect(prev));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const beginMove = (event) => {
    if (event.button !== 0 || event.target.closest("button")) return;
    event.preventDefault();
    interactionRef.current = { mode: "move", startX: event.clientX, startY: event.clientY, rect: { ...windowRect } };
  };

  const beginCompactMove = (event) => {
    if (event.button !== 0 || event.target.closest("button")) return;
    event.preventDefault();
    interactionRef.current = { mode: "compact-move", startX: event.clientX, startY: event.clientY, rect: { ...compactRect } };
  };

  const beginCompactResize = (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    interactionRef.current = { mode: "compact-resize", startX: event.clientX, startY: event.clientY, rect: { ...compactRect } };
  };

  const beginResize = (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    interactionRef.current = {
      mode: "resize",
      startX: event.clientX,
      startY: event.clientY,
      rect: { ...windowRect },
    };
  };

  useEffect(() => {
    const onMove = (event) => {
      const active = interactionRef.current;
      if (!active) return;
      const dx = event.clientX - active.startX;
      const dy = event.clientY - active.startY;
      if (active.mode === "move") {
        setWindowRect(clampWindowRect({ ...active.rect, x: active.rect.x + dx, y: active.rect.y + dy }));
      } else if (active.mode === "resize") {
        setWindowRect(clampWindowRect({ ...active.rect, width: active.rect.width + dx, height: active.rect.height + dy }));
      } else if (active.mode === "compact-move") {
        const vw = window.innerWidth || 1366;
        const vh = window.innerHeight || 768;
        const width = active.rect.width;
        const height = active.rect.height;
        setCompactRect({ ...active.rect, x: Math.min(Math.max(8, active.rect.x + dx), Math.max(8, vw - width - 8)), y: Math.min(Math.max(8, active.rect.y + dy), Math.max(8, vh - height - 8)) });
      } else if (active.mode === "compact-resize") {
        const vw = window.innerWidth || 1366;
        const width = Math.min(Math.max(430, active.rect.width + dx), Math.max(430, vw - 16));
        setCompactRect({ ...active.rect, width, height: Math.min(92, Math.max(70, active.rect.height + dy)) });
      }
    };
    const onUp = () => { interactionRef.current = null; };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [windowRect, compactRect]);

  const stopRingtone = () => {
    const audio = ringAudioRef.current;
    if (!audio) return;
    try {
      audio.pause();
      audio.currentTime = 0;
    } catch {}
    ringAudioRef.current = null;
  };

  const startRingtone = (type = "incoming") => {
    stopRingtone();
    try {
      const audio = new Audio(type === "outgoing" ? OUTGOING_RINGTONE : INCOMING_RINGTONE);
      audio.loop = true;
      audio.volume = type === "outgoing" ? 0.72 : 0.95;
      ringAudioRef.current = audio;
      const playPromise = audio.play();
      if (playPromise?.catch) playPromise.catch(() => {});
    } catch {}
  };

  const stopLocalMedia = () => {
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;
    setLocalStream(null);
  };

  const closePeer = (peerUserId) => {
    const key = String(peerUserId);
    const pc = peersRef.current.get(key);
    const queued = queuedRenegotiationsRef.current.get(key);
    if (queued) {
      queued.pc.removeEventListener("signalingstatechange", queued.listener);
      queuedRenegotiationsRef.current.delete(key);
    }
    if (pc) { try { pc.close(); } catch {} }
    peersRef.current.delete(key);
    pendingScreenViewersRef.current.delete(key);
    mainRemoteStreamIdsRef.current.delete(key);
    setRemoteScreenStreams((prev) => { const next = { ...prev }; delete next[key]; return next; });
    setRemoteStreams((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const stopCallResources = () => {
    stopRingtone();
    stopScreenShare(false);
    if (timerRef.current) window.clearInterval(timerRef.current);
    timerRef.current = null;
    queuedRenegotiationsRef.current.forEach(({ pc, listener }) => pc.removeEventListener("signalingstatechange", listener));
    queuedRenegotiationsRef.current.clear();
    peersRef.current.forEach((pc) => { try { pc.close(); } catch {} });
    peersRef.current.clear();
    setRequestingScreenOwner(null);
    pendingScreenViewersRef.current.clear();
    stopLocalMedia();
    setRemoteStreams({});
    setRemoteScreenStreams({});
    setAvailableScreenShares({});
    screenSharesRef.current = {};
    setWatchedScreens({});
    setFocusedScreenOwner(null);
    setScreenViewerCounts({});
    setMicEnabled(true);
    setCameraEnabled(true);
    setElapsed(0);
    setSpeakingUsers({});
    setCameraPending(false);
    setSpeakerEnabled(true);
    setDeafened(false);
    setParticipantStates({});
    setLocallyMutedPeers({});
    setLocalPreviewVisible(true);
    setPreviewOpen(false);
    setSettingsOpen(false);
    setConfirmHidePreview(false);
    setMinimized(false);
    if (previewStreamRef.current) { previewStreamRef.current.getTracks().forEach((track) => track.stop()); previewStreamRef.current = null; }
    closePopout();
  };

  const closeAllCallUi = () => {
    if (endTimerRef.current) window.clearTimeout(endTimerRef.current);
    endTimerRef.current = null;
    setIncoming(null);
    incomingRef.current = null;
    setCall(null);
    callRef.current = null;
    closePopout();
  };

  const finishCall = (message = "Llamada finalizada") => {
    stopCallResources();
    if (callRef.current) {
      const ended = { ...callRef.current, phase: "ended", endedMessage: message };
      setCall(ended);
      callRef.current = ended;
      setIncoming(null);
      incomingRef.current = null;
      if (endTimerRef.current) window.clearTimeout(endTimerRef.current);
      endTimerRef.current = window.setTimeout(closeAllCallUi, END_SCREEN_MS);
      return;
    }
    if (incomingRef.current) {
      const endedIncoming = { ...incomingRef.current, phase: "ended", endedMessage: message };
      setIncoming(endedIncoming);
      incomingRef.current = endedIncoming;
      if (endTimerRef.current) window.clearTimeout(endTimerRef.current);
      endTimerRef.current = window.setTimeout(closeAllCallUi, END_SCREEN_MS);
      return;
    }
    showStatus(message, END_SCREEN_MS);
  };

  const getMedia = async (kind) => {
    if (localStreamRef.current) return localStreamRef.current;
    const constraints = {
      audio: {
        echoCancellation: true, noiseSuppression: true, autoGainControl: true,
        ...(selectedDevices.audioinput ? { deviceId: { exact: selectedDevices.audioinput } } : {}),
      },
      video: kind === "video" ? {
        width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user",
        ...(selectedDevices.videoinput ? { deviceId: { exact: selectedDevices.videoinput } } : {}),
      } : false,
    };
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    localStreamRef.current = stream;
    setLocalStream(stream);
    setMicEnabled(true);
    setCameraEnabled(kind === "video");
    return stream;
  };

  const addCameraTrackAndRenegotiate = async () => {
    let stream = localStreamRef.current;
    if (!stream) return false;

    let videoTrack = stream.getVideoTracks?.()[0] || null;
    if (!videoTrack) {
      const cameraStream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user",
          ...(selectedDevices.videoinput ? { deviceId: { exact: selectedDevices.videoinput } } : {}),
        },
        audio: false,
      });
      videoTrack = cameraStream.getVideoTracks?.()[0] || null;
      if (!videoTrack) return false;
      stream.addTrack(videoTrack);
      setLocalStream(new MediaStream(stream.getTracks()));
    } else {
      videoTrack.enabled = true;
    }

    setCameraEnabled(true);
    emitMediaState({ cameraEnabled: true });

    for (const [peerId, pc] of peersRef.current.entries()) {
      const existingSender = pc.getSenders().find((sender) => sender.track?.kind === "video");
      if (existingSender) await existingSender.replaceTrack(videoTrack);
      else pc.addTrack(videoTrack, stream);

      const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true });
      await pc.setLocalDescription(offer);
      socket.emit("call:offer", {
        callId: callRef.current?.callId,
        toUserId: Number(peerId),
        sdp: pc.localDescription,
      });
    }
    return true;
  };

  const upgradeToVideo = async () => {
    const current = callRef.current;
    if (!current || current.phase === "ended" || current.kind === "video") return;
    if (!permissionEnabled(user?.permisos_chat, "realizar_videollamadas")) {
      showStatus("No tienes permiso para realizar videollamadas");
      return;
    }

    socket.timeout(10000).emit("call:upgrade-video", { callId: current.callId }, async (err, response = {}) => {
      if (err || !response.ok) {
        showStatus(response.error || "No se pudo cambiar a videollamada");
        return;
      }
      const next = { ...callRef.current, kind: "video" };
      callRef.current = next;
      setCall(next);
      setCameraPending(true);
      try {
        await addCameraTrackAndRenegotiate();
      } catch {
        setCameraEnabled(false);
        showStatus("No se pudo acceder a la cámara");
      } finally {
        setCameraPending(false);
      }
    });
  };

  const ensurePeer = async (peerUserId, shouldOffer = false) => {
    const key = String(peerUserId);
    let pc = peersRef.current.get(key);
    if (pc) return pc;
    const current = callRef.current;
    if (!current?.callId) return null;
    const stream = localStreamRef.current || await getMedia(current.kind);
    pc = new RTCPeerConnection(ICE_CONFIG);
    stream.getTracks().forEach((track) => pc.addTrack(track, stream));
    // Un espectador puede solicitar la transmisión justo cuando se está creando el peer.
    // Añadimos esas pistas antes de la oferta WebRTC para no perder la suscripción.
    if (pendingScreenViewersRef.current.has(key) && screenStreamRef.current) {
      const senders = [];
      screenStreamRef.current.getTracks().forEach((track) => {
        try { senders.push(pc.addTrack(track, screenStreamRef.current)); } catch {}
      });
      if (senders.length) screenSendersRef.current.set(key, senders);
      pendingScreenViewersRef.current.delete(key);
    }
    pc.onicecandidate = (event) => {
      if (event.candidate) socket.emit("call:ice", { callId: current.callId, toUserId: Number(peerUserId), candidate: event.candidate });
    };
    pc.ontrack = (event) => {
      const remote = event.streams?.[0];
      if (!remote) return;
      const announcedShare = screenSharesRef.current?.[key];
      const mainStreamId = mainRemoteStreamIdsRef.current.get(key);
      const looksLikeScreen = Boolean(
        announcedShare && (
          remote.id === announcedShare.streamId ||
          (mainStreamId && remote.id !== mainStreamId && event.track?.kind === "video")
        )
      );
      if (looksLikeScreen) {
        setRemoteScreenStreams((prev) => ({ ...prev, [key]: remote }));
        return;
      }
      if (!mainStreamId) mainRemoteStreamIdsRef.current.set(key, remote.id);
      setRemoteStreams((prev) => ({ ...prev, [key]: remote }));
    };
    pc.onconnectionstatechange = () => {
      if (["failed", "closed"].includes(pc.connectionState)) closePeer(peerUserId);
    };
    peersRef.current.set(key, pc);
    if (shouldOffer) {
      const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: current.kind === "video" });
      await pc.setLocalDescription(offer);
      socket.emit("call:offer", { callId: current.callId, toUserId: Number(peerUserId), sdp: pc.localDescription });
    }
    return pc;
  };

  const startTimer = () => {
    if (timerRef.current) return;
    const startedAt = Date.now();
    timerRef.current = window.setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000);
  };

  const startCall = async ({ kind, chat }) => {
    const permissionKey = kind === "video" ? "realizar_videollamadas" : "realizar_llamadas";
    if (!permissionEnabled(user?.permisos_chat, permissionKey)) {
      showStatus(kind === "video" ? "No tienes permiso para realizar videollamadas" : "No tienes permiso para realizar llamadas");
      return false;
    }
    if (chat?.tipo === "grupo" && !["admin", "propietario"].includes(String(chat?.rol || ""))) {
      showStatus("Solo administradores y propietario pueden iniciar llamadas grupales");
      return false;
    }
    if (callRef.current || incomingRef.current) {
      showStatus("Ya tienes una llamada en curso");
      return false;
    }
    try {
      await getMedia(kind);
    } catch {
      showStatus(kind === "video" ? "No se pudo acceder a cámara o micrófono" : "No se pudo acceder al micrófono");
      return false;
    }

    const payload = chat?.tipo === "grupo"
      ? { kind, chatType: "grupo", groupId: Number(chat.grupo_id) }
      : { kind, chatType: "privado", targetUserId: Number(chat?.usuario_id) };

    socket.timeout(10000).emit("call:start", payload, (err, response) => {
      if (err || !response?.ok) {
        stopLocalMedia();
        showStatus(response?.error || "No se pudo iniciar la llamada");
        return;
      }
      resetWindowRect();
      const next = {
        callId: response.callId,
        kind,
        chatType: payload.chatType,
        title: response.title || displayName(chat),
        participants: response.participants || [],
        initiatorId: Number(user?.id),
        phase: "ringing",
      };
      setCall(next);
      callRef.current = next;
      startRingtone("outgoing");
      window.setTimeout(() => {
        const active = callRef.current;
        if (active?.callId === response.callId && active.phase === "ringing") {
          socket.emit("call:leave", { callId: response.callId, reason: "timeout" });
          finishCall("La llamada no fue contestada");
        }
      }, CALL_TIMEOUT_MS);
    });
    return true;
  };

  useImperativeHandle(ref, () => ({ startCall }), [user]);

  const acceptIncoming = async () => {
    const current = incomingRef.current;
    if (!current || current.phase === "ended") return;
    try {
      await getMedia(current.kind);
    } catch {
      showStatus(current.kind === "video" ? "No se pudo acceder a cámara o micrófono" : "No se pudo acceder al micrófono");
      return;
    }
    stopRingtone();
    resetWindowRect();
    const next = { ...current, phase: "connecting" };
    setCall(next);
    callRef.current = next;
    setIncoming(null);
    incomingRef.current = null;
    socket.emit("call:accept", { callId: current.callId }, (response = {}) => {
      if (!response.ok) finishCall(response.error || "La llamada ya no está disponible");
      else startTimer();
    });
  };

  const rejectIncoming = () => {
    const current = incomingRef.current;
    if (current?.callId) socket.emit("call:reject", { callId: current.callId });
    stopRingtone();
    setIncoming(null);
    incomingRef.current = null;
  };

  const ignoreIncoming = () => {
    stopRingtone();
    setIncoming((prev) => {
      const next = prev ? { ...prev, silenced: true } : prev;
      incomingRef.current = next;
      return next;
    });
  };

  const hangup = () => {
    const current = callRef.current;
    if (current?.callId && current.phase !== "ended") socket.emit("call:leave", { callId: current.callId, reason: "hangup" });
    finishCall("Llamada finalizada");
  };

  const toggleMic = () => {
    if (deafened) return;
    const track = localStreamRef.current?.getAudioTracks?.()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setMicEnabled(track.enabled);
    emitMediaState({ micMuted: !track.enabled });
  };

  const toggleDeafen = () => {
    const next = !deafened;
    const track = localStreamRef.current?.getAudioTracks?.()[0];
    if (next) {
      deafenPrevMicRef.current = Boolean(track?.enabled);
      if (track) track.enabled = false;
      setMicEnabled(false);
      setSpeakerEnabled(false);
    } else {
      if (track) track.enabled = deafenPrevMicRef.current;
      setMicEnabled(Boolean(track?.enabled));
      setSpeakerEnabled(true);
    }
    setDeafened(next);
    emitMediaState({ deafened: next, micMuted: next ? true : !Boolean(track?.enabled) });
  };

  const togglePeerLocalMute = (peerId) => {
    const key = String(peerId);
    setLocallyMutedPeers((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const toggleCamera = async () => {
    if (cameraPending) return;
    let track = localStreamRef.current?.getVideoTracks?.()[0];
    if (!track) {
      setCameraPending(true);
      try {
        const added = await addCameraTrackAndRenegotiate();
        if (!added) throw new Error("camera-unavailable");
      } catch {
        setCameraEnabled(false);
        showStatus("No se pudo acceder a la cámara");
      } finally {
        setCameraPending(false);
      }
      return;
    }
    track.enabled = !track.enabled;
    setCameraEnabled(track.enabled);
    emitMediaState({ cameraEnabled: track.enabled });
  };

  const requestToggleLocalPreview = () => {
    if (localPreviewVisible && cameraEnabled) {
      setConfirmHidePreview(true);
      return;
    }
    setLocalPreviewVisible((prev) => !prev);
  };

  const openCameraPreview = async () => {
    await refreshDevices();
    setPreviewOpen(true);
    try {
      if (previewStreamRef.current) previewStreamRef.current.getTracks().forEach((track) => track.stop());
      const stream = await navigator.mediaDevices.getUserMedia({
        video: selectedDevices.videoinput ? { deviceId: { exact: selectedDevices.videoinput }, width: { ideal: 1280 }, height: { ideal: 720 } } : { width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      previewStreamRef.current = stream;
      window.setTimeout(() => { if (previewVideoRef.current) previewVideoRef.current.srcObject = stream; }, 0);
    } catch {
      showStatus("No se pudo acceder a la cámara");
    }
  };

  const closeCameraPreview = () => {
    if (previewStreamRef.current) previewStreamRef.current.getTracks().forEach((track) => track.stop());
    previewStreamRef.current = null;
    setPreviewOpen(false);
  };

  const switchAudioInput = async (deviceId) => {
    setSelectedDevices((prev) => ({ ...prev, audioinput: deviceId }));
    try {
      const replacement = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: deviceId }, echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
      const newTrack = replacement.getAudioTracks()[0];
      if (!newTrack) return;
      const stream = localStreamRef.current;
      const oldTrack = stream?.getAudioTracks?.()[0];
      if (stream && oldTrack) { stream.removeTrack(oldTrack); oldTrack.stop(); }
      if (stream) stream.addTrack(newTrack);
      localStreamRef.current = stream ? new MediaStream(stream.getTracks()) : replacement;
      setLocalStream(localStreamRef.current);
      for (const pc of peersRef.current.values()) {
        const sender = pc.getSenders().find((item) => item.track?.kind === "audio");
        if (sender) await sender.replaceTrack(newTrack);
      }
      newTrack.enabled = !deafened && micEnabled;
    } catch { showStatus("No se pudo cambiar el micrófono"); }
  };

  const switchVideoInput = async (deviceId) => {
    setSelectedDevices((prev) => ({ ...prev, videoinput: deviceId }));
    if (!cameraEnabled) return;
    try {
      const replacement = await navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
      const newTrack = replacement.getVideoTracks()[0];
      const stream = localStreamRef.current;
      const oldTrack = stream?.getVideoTracks?.()[0];
      if (stream && oldTrack) { stream.removeTrack(oldTrack); oldTrack.stop(); }
      if (stream) stream.addTrack(newTrack);
      localStreamRef.current = stream ? new MediaStream(stream.getTracks()) : replacement;
      setLocalStream(localStreamRef.current);
      for (const pc of peersRef.current.values()) {
        const sender = pc.getSenders().find((item) => item.track?.kind === "video");
        if (sender) await sender.replaceTrack(newTrack);
      }
    } catch { showStatus("No se pudo cambiar la cámara"); }
  };

  const openSettings = async () => {
    await refreshDevices();
    setSettingsOpen(true);
  };

  useEffect(() => {
    const track = localStreamRef.current?.getAudioTracks?.()[0];
    if (!track?.applyConstraints) return;
    track.applyConstraints({ volume: micVolume }).catch(() => {});
  }, [micVolume]);

  useEffect(() => {
    if (!user?.id) return undefined;

    const onIncoming = (payload) => {
      if (callRef.current || incomingRef.current) {
        socket.emit("call:reject", { callId: payload.callId, reason: "busy" });
        return;
      }
      const next = { ...payload, phase: "incoming", silenced: false };
      setIncoming(next);
      incomingRef.current = next;
      startRingtone("incoming");
    };

    const onPeerReady = async ({ callId, peerUserId, shouldOffer }) => {
      if (callRef.current?.callId !== callId) return;
      stopRingtone();
      setCall((prev) => prev ? { ...prev, phase: "connected" } : prev);
      if (callRef.current) callRef.current = { ...callRef.current, phase: "connected" };
      startTimer();
      emitMediaState();
      try { await ensurePeer(peerUserId, Boolean(shouldOffer)); }
      catch (error) { console.error("Error creando peer WebRTC:", error); }
    };

    const onOffer = async ({ callId, fromUserId, sdp }) => {
      if (callRef.current?.callId !== callId) return;
      try {
        const pc = await ensurePeer(fromUserId, false);
        await pc.setRemoteDescription(new RTCSessionDescription(sdp));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit("call:answer", { callId, toUserId: Number(fromUserId), sdp: pc.localDescription });
      } catch (error) {
        console.error("Error respondiendo oferta WebRTC:", error);
      }
    };

    const onAnswer = async ({ callId, fromUserId, sdp }) => {
      if (callRef.current?.callId !== callId) return;
      const pc = peersRef.current.get(String(fromUserId));
      if (!pc) return;
      try { await pc.setRemoteDescription(new RTCSessionDescription(sdp)); }
      catch (error) { console.error("Error aplicando answer WebRTC:", error); }
    };

    const onIce = async ({ callId, fromUserId, candidate }) => {
      if (callRef.current?.callId !== callId) return;
      const pc = peersRef.current.get(String(fromUserId));
      if (!pc || !candidate) return;
      try { await pc.addIceCandidate(new RTCIceCandidate(candidate)); }
      catch (error) { console.warn("ICE candidate rechazado:", error); }
    };

    const onParticipantLeft = ({ callId, userId: leftId }) => {
      if (callRef.current?.callId !== callId) return;
      closePeer(leftId);
      setParticipantStates((prev) => { const next = { ...prev }; delete next[String(leftId)]; return next; });
      setLocallyMutedPeers((prev) => { const next = { ...prev }; delete next[String(leftId)]; return next; });
    };

    const onMediaState = ({ callId, userId: stateUserId, micMuted, deafened: isDeafened, cameraEnabled: hasCamera }) => {
      if (callRef.current?.callId !== callId) return;
      setParticipantStates((prev) => ({
        ...prev,
        [String(stateUserId)]: { micMuted: Boolean(micMuted), deafened: Boolean(isDeafened), cameraEnabled: Boolean(hasCamera) },
      }));
    };

    const onCallEnded = ({ callId, reason }) => {
      if (callRef.current?.callId === callId || incomingRef.current?.callId === callId) {
        finishCall(reason === "rejected" ? "Llamada rechazada" : reason === "busy" ? "El usuario está ocupado" : "Llamada finalizada");
      }
    };

    const onRejected = ({ callId, userId: rejectedId, reason }) => {
      if (callRef.current?.callId !== callId) return;
      if (callRef.current.chatType === "privado") {
        finishCall(reason === "busy" ? "El usuario está ocupado" : "Llamada rechazada");
      } else {
        closePeer(rejectedId);
      }
    };

    const onUpgradedVideo = ({ callId, byUserId }) => {
      if (callRef.current?.callId === callId) {
        const next = { ...callRef.current, kind: "video" };
        callRef.current = next;
        setCall(next);
        setCameraEnabled(Boolean(localStreamRef.current?.getVideoTracks?.()[0]?.enabled));
        if (Number(byUserId) !== Number(user?.id)) showStatus("La llamada cambió a videollamada");
        return;
      }
      if (incomingRef.current?.callId === callId) {
        const nextIncoming = { ...incomingRef.current, kind: "video" };
        incomingRef.current = nextIncoming;
        setIncoming(nextIncoming);
      }
    };

    const onScreenAvailable = ({ callId, ownerUserId, sourceType = "applications", label = "Pantalla", streamId = "" } = {}) => {
      if (callRef.current?.callId !== callId) return;
      const ownerKey = String(ownerUserId);
      const share = {
        ownerUserId: Number(ownerUserId),
        sourceType,
        label: String(label || "Pantalla"),
        streamId: String(streamId || ""),
      };
      setAvailableScreenShares((prev) => ({ ...prev, [ownerKey]: share }));
      if (Number(ownerUserId) === Number(user?.id)) {
        setWatchedScreens((prev) => ({ ...prev, [ownerKey]: true }));
      }
    };

    const onScreenStopped = ({ callId, ownerUserId } = {}) => {
      if (callRef.current?.callId !== callId) return;
      const ownerKey = String(ownerUserId);
      setAvailableScreenShares((prev) => { const next = { ...prev }; delete next[ownerKey]; return next; });
      setRemoteScreenStreams((prev) => { const next = { ...prev }; delete next[ownerKey]; return next; });
      setWatchedScreens((prev) => { const next = { ...prev }; delete next[ownerKey]; return next; });
      setScreenViewerCounts((prev) => { const next = { ...prev }; delete next[ownerKey]; return next; });
      setRequestingScreenOwner((prev) => prev === ownerKey ? null : prev);
      setFocusedScreenOwner((prev) => String(prev) === ownerKey ? null : prev);
      if (Number(ownerUserId) === Number(user?.id)) {
        setScreenShareActive(false);
        screenStreamRef.current = null;
        screenSendersRef.current.clear();
      }
    };

    const onScreenViewer = async ({ callId, viewerUserId, watching = true, count = 0 } = {}) => {
      if (callRef.current?.callId !== callId || !screenStreamRef.current) return;
      const viewerKey = String(viewerUserId);
      setScreenViewerCounts((prev) => ({ ...prev, [String(user?.id)]: Number(count) || 0 }));
      const pc = peersRef.current.get(viewerKey);
      if (!pc) {
        if (watching) pendingScreenViewersRef.current.add(viewerKey);
        else pendingScreenViewersRef.current.delete(viewerKey);
        return;
      }

      if (watching) {
        if (!screenSendersRef.current.has(viewerKey)) {
          const senders = [];
          screenStreamRef.current.getTracks().forEach((track) => {
            try { senders.push(pc.addTrack(track, screenStreamRef.current)); } catch {}
          });
          screenSendersRef.current.set(viewerKey, senders);
          await renegotiatePeer(viewerUserId);
          playStreamPresenceSound(true);
        }
        return;
      }

      const senders = screenSendersRef.current.get(viewerKey) || [];
      senders.forEach((sender) => { try { pc.removeTrack(sender); } catch {} });
      screenSendersRef.current.delete(viewerKey);
      await renegotiatePeer(viewerUserId);
      playStreamPresenceSound(false);
    };

    const onScreenViewerCount = ({ callId, ownerUserId, count = 0 } = {}) => {
      if (callRef.current?.callId !== callId) return;
      setScreenViewerCounts((prev) => ({ ...prev, [String(ownerUserId)]: Number(count) || 0 }));
    };

    socket.on("call:incoming", onIncoming);
    socket.on("call:peer-ready", onPeerReady);
    socket.on("call:offer", onOffer);
    socket.on("call:answer", onAnswer);
    socket.on("call:ice", onIce);
    socket.on("call:participant-left", onParticipantLeft);
    socket.on("call:media-state", onMediaState);
    socket.on("call:screen-available", onScreenAvailable);
    socket.on("call:screen-stopped", onScreenStopped);
    socket.on("call:screen-viewer", onScreenViewer);
    socket.on("call:screen-viewer-count", onScreenViewerCount);
    socket.on("call:ended", onCallEnded);
    socket.on("call:rejected", onRejected);
    socket.on("call:upgraded-video", onUpgradedVideo);

    return () => {
      socket.off("call:incoming", onIncoming);
      socket.off("call:peer-ready", onPeerReady);
      socket.off("call:offer", onOffer);
      socket.off("call:answer", onAnswer);
      socket.off("call:ice", onIce);
      socket.off("call:participant-left", onParticipantLeft);
      socket.off("call:media-state", onMediaState);
      socket.off("call:screen-available", onScreenAvailable);
      socket.off("call:screen-stopped", onScreenStopped);
      socket.off("call:screen-viewer", onScreenViewer);
      socket.off("call:screen-viewer-count", onScreenViewerCount);
      socket.off("call:ended", onCallEnded);
      socket.off("call:rejected", onRejected);
      socket.off("call:upgraded-video", onUpgradedVideo);
    };
  }, [user?.id]);

  useEffect(() => () => {
    stopRingtone();
    if (timerRef.current) window.clearInterval(timerRef.current);
    if (endTimerRef.current) window.clearTimeout(endTimerRef.current);
    if (statusTimerRef.current) window.clearTimeout(statusTimerRef.current);
    closePopout();
    stopScreenShare(false);
    peersRef.current.forEach((pc) => pc.close());
    stopLocalMedia();
  }, []);

  const formatTime = (seconds) => `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  const participants = useMemo(() => call?.participants || incoming?.participants || [], [call?.participants, incoming?.participants]);
  const personById = (id) => participants.find((item) => Number(item.id) === Number(id)) || { nombre: "Usuario" };
  const remotePeople = participants.filter((item) => Number(item.id) !== Number(user?.id));
  const primaryRemotePerson = remotePeople[0] || incoming?.caller || { nombre: call?.title || "Usuario" };

  const canUpgradeVideo = Boolean(
    call &&
    permissionEnabled(user?.permisos_chat, "realizar_videollamadas") &&
    (call.chatType !== "grupo" || Number(call.initiatorId) === Number(user?.id))
  );

  const handleSpeakingChange = useCallback((id, speaking) => {
    const key = String(id);
    setSpeakingUsers((prev) => {
      if (Boolean(prev[key]) === Boolean(speaking)) return prev;
      // El último que comienza a hablar aparece primero en la fila inferior.
      return { ...prev, [key]: speaking ? ++speakerActivitySeqRef.current : 0 };
    });
  }, []);

  const activeSpeakerId = useMemo(() => {
    const active = Object.entries(speakingUsers).filter(([, order]) => order > 0).sort((a, b) => b[1] - a[1]);
    return active[0]?.[0] || null;
  }, [speakingUsers]);

  const callTiles = useMemo(() => {
    if (!call || call.phase === "ended") return [];
    const localId = String(user?.id || "local");
    const items = [
      { id: localId, stream: localStream, local: true, person: user, mediaState: { micMuted: !micEnabled, deafened, cameraEnabled } },
      ...Object.entries(remoteStreams).map(([peerId, stream]) => ({ id: String(peerId), stream, local: false, person: personById(peerId), mediaState: participantStates[String(peerId)] || {} })),
    ];
    return items.sort((a, b) => (speakingUsers[b.id] || 0) - (speakingUsers[a.id] || 0));
  }, [call, localStream, remoteStreams, user, participants, speakingUsers, participantStates, micEnabled, deafened, cameraEnabled]);

  const activeScreenShares = useMemo(() => Object.values(availableScreenShares || {}), [availableScreenShares]);
  const watchedScreenEntries = useMemo(() => activeScreenShares.filter((share) => watchedScreens[String(share.ownerUserId)]), [activeScreenShares, watchedScreens]);
  // Si una transmisión ya está siendo vista, ocupar el escenario principal.
  // Esto evita el cuadro redundante "Tu transmisión" encima de las personas.
  const screenStageOwner = (focusedScreenOwner && availableScreenShares[String(focusedScreenOwner)] && watchedScreens[String(focusedScreenOwner)])
    ? String(focusedScreenOwner)
    : null;
  const getScreenStream = (ownerUserId) => Number(ownerUserId) === Number(user?.id) ? screenStreamRef.current : remoteScreenStreams[String(ownerUserId)];

  // La suscripción remota es explícita: primero se anuncia la transmisión,
  // después el usuario decide si quiere verla. La propia transmisión local
  // puede verse como miniatura sin abrir el escenario grande.

  const callStatus = call?.phase === "ended"
    ? call.endedMessage || "Llamada finalizada"
    : call?.phase === "ringing"
      ? "Llamando…"
      : call?.phase === "connecting"
        ? "Conectando…"
        : formatTime(elapsed);

  const renderCallWindow = () => {
    if (!call) return null;
    const groupClass = call.chatType === "grupo" ? "group-call" : "private-call";
    const isScreenFocused = Boolean(screenStageOwner);
    return (
      <section
        ref={callWindowRef}
        className={`qc-call-window ${isScreenFocused ? "has-focused-screen" : ""} ${controlsPinned ? "controls-pinned" : ""} ${call.kind === "video" ? "video-call" : "voice-call"} ${groupClass} ${call.phase === "ended" ? "is-ended" : ""} ${minimized ? "is-minimized" : ""} ${popoutHost ? "is-popout" : ""}`}
        role="dialog"
        aria-label="Llamada en curso"
        onMouseLeave={() => setControlsPinned(false)}
        style={popoutHost ? undefined : (minimized ? { left: compactRect.x, top: compactRect.y, width: compactRect.width, height: compactRect.height } : { left: windowRect.x, top: windowRect.y, width: windowRect.width, height: windowRect.height })}
      >
        <header className="qc-call-window-header" onPointerDown={popoutHost ? undefined : (minimized ? beginCompactMove : beginMove)}>
          <div className="qc-call-heading">
            <strong>{call.title || "Llamada"}</strong>
            <span>{call.chatType === "grupo" && call.phase === "connected" ? `${callStatus} • ${Object.keys(remoteStreams).length + 1} participantes` : callStatus}</span>
          </div>
          <div className="qc-call-window-actions">
            {!minimized && <span className="qc-call-encrypted"><i className="fa-solid fa-lock" /> WebRTC</span>}
            {!minimized && !popoutHost && <button type="button" onClick={openPopout} title="Abrir en otra ventana"><i className="fa-solid fa-arrow-up-right-from-square" /></button>}
            {!minimized && popoutHost && <button type="button" onClick={closePopout} title="Regresar al chat"><i className="fa-solid fa-arrow-right-to-bracket" /></button>}
            {!minimized && <button type="button" onClick={toggleFullscreen} title="Pantalla completa"><i className="fa-solid fa-expand" /></button>}
            <button type="button" onClick={() => setMinimized((prev) => !prev)} title={minimized ? "Maximizar llamada" : "Minimizar llamada"}><i className={`fa-solid ${minimized ? "fa-up-right-and-down-left-from-center" : "fa-minus"}`} /></button>
          </div>
        </header>

        {minimized ? (
          <div className="qc-call-mini-bar" onPointerDown={popoutHost ? undefined : beginCompactMove}>
            <div className="qc-call-mini-channel">
              <i className={`fa-solid ${call.kind === "video" ? "fa-video" : "fa-volume-high"}`} />
              <div><span>{call.chatType === "grupo" ? "LLAMADA GRUPAL" : call.kind === "video" ? "VIDEOLLAMADA" : "LLAMADA DE VOZ"}</span><strong>{call.title || "Llamada"}</strong></div>
            </div>
            <div className="qc-call-mini-speaker">
              <Avatar person={activeSpeakerId ? (String(activeSpeakerId) === String(user?.id) ? user : personById(activeSpeakerId)) : primaryRemotePerson} />
              <div><span>HABLANDO</span><strong>{activeSpeakerId ? (String(activeSpeakerId) === String(user?.id) ? "Tú" : displayName(personById(activeSpeakerId))) : "En llamada"}</strong></div>
            </div>
            <div className="qc-call-mini-controls">
              <button onClick={toggleMic} disabled={deafened} className={`qc-call-control ${!micEnabled ? "off" : ""}`} title={micEnabled ? "Silenciar micrófono" : "Activar micrófono"}><i className={`fa-solid ${micEnabled ? "fa-microphone" : "fa-microphone-slash"}`} /></button>
              <button onClick={toggleDeafen} className={`qc-call-control ${deafened ? "off" : ""}`} aria-label={deafened ? "Dejar de ensordecer" : "Ensordecer"} data-tooltip={deafened ? "Activar sonido" : "Ensordecer"}><i className={`fa-solid ${deafened ? "fa-volume-xmark" : "fa-headphones"}`} /></button>
              <button onClick={() => screenShareActive ? stopScreenShare(true) : setScreenPickerOpen(true)} className={`qc-call-control qc-call-share-control ${screenShareActive ? "is-sharing" : ""}`} aria-label={screenShareActive ? "Dejar de transmitir pantalla" : "Compartir pantalla"} data-tooltip={screenShareActive ? "Dejar de transmitir" : "Compartir pantalla"}><ShareScreenIcon sharing={screenShareActive} /></button>
              <button onClick={() => setMinimized(false)} className="qc-call-control" title="Maximizar llamada"><i className="fa-solid fa-up-right-and-down-left-from-center" /></button>
              <button onClick={hangup} className="qc-call-control hangup" title="Desconectar"><i className="fa-solid fa-phone-slash" /></button>
            </div>
          </div>
        ) : (
          <>
            <div className={`qc-call-grid ${call.kind === "audio" ? "is-audio-layout" : ""} ${isScreenFocused ? "has-screen-focus" : ""} ${activeScreenShares.length && !isScreenFocused ? "has-screen-available" : ""}`} onClick={(event) => { if (event.target === event.currentTarget) setControlsPinned((value) => !value); }}>
              {call.phase === "ended" ? (
                <div className="qc-call-ended-state">
                  <div className="qc-call-ended-icon"><i className="fa-solid fa-phone-slash" /></div>
                  <strong>{call.endedMessage || "Llamada finalizada"}</strong>
                  <span>Esta ventana se cerrará automáticamente…</span>
                </div>
              ) : Object.keys(remoteStreams).length === 0 && ["ringing", "connecting"].includes(call.phase) ? (
                <div className="qc-call-waiting-panel">
                  <div className="qc-call-waiting-remote">
                    <div className="qc-call-waiting-avatar-ring"><Avatar person={primaryRemotePerson} className="qc-call-waiting-avatar" large /></div>
                    <strong>{displayName(primaryRemotePerson)}</strong>
                    <span>{call.phase === "connecting" ? "Conectando…" : "Esperando respuesta…"}</span>
                  </div>
                  <div className="qc-call-waiting-icon-wrap"><div className="qc-call-waiting-icon"><i className={`fa-solid ${call.kind === "video" ? "fa-video" : "fa-phone"}`} /></div></div>
                </div>
              ) : isScreenFocused ? (
                <div className="qc-screen-focus-layout">
                  <ScreenShareVideo
                    stream={getScreenStream(screenStageOwner)}
                    person={String(screenStageOwner) === String(user?.id) ? user : personById(screenStageOwner)}
                    local={String(screenStageOwner) === String(user?.id)}
                    focused
                    onFocus={() => setControlsPinned((value) => !value)}
                    onExitFocus={() => setFocusedScreenOwner(null)}
                    viewerCount={screenViewerCounts[String(screenStageOwner)] || 0}
                    onStopWatching={String(screenStageOwner) === String(user?.id) ? null : () => toggleWatchScreen(screenStageOwner, false)}
                  />
                  <div className="qc-screen-focus-strip" aria-label="Participantes de la llamada">
                    {callTiles.map((tile) => (
                      <MediaTile
                        key={`focus-person-${tile.id}`}
                        stream={tile.stream}
                        muted={tile.local}
                        local={tile.local}
                        videoEnabled={call.kind === "video" && (!tile.local || cameraEnabled)}
                        person={tile.person}
                        mediaState={tile.mediaState}
                        locallyMuted={!tile.local && Boolean(locallyMutedPeers[tile.id])}
                        localPreviewVisible={localPreviewVisible}
                        speakerId={tile.id}
                        onSpeakingChange={handleSpeakingChange}
                        onToggleLocalMute={() => togglePeerLocalMute(tile.id)}
                        onToggleDeafen={toggleDeafen}
                        onTogglePreview={requestToggleLocalPreview}
                        onOpenPreview={openCameraPreview}
                        onOpenSettings={openSettings}
                        screenAvailable={Boolean(availableScreenShares[String(tile.id)])}
                        onOpenScreen={() => watchedScreens[String(tile.id)] ? setFocusedScreenOwner(String(tile.id)) : toggleWatchScreen(tile.id, true)}
                      />
                    ))}
                    {watchedScreenEntries.filter((share) => String(share.ownerUserId) !== String(screenStageOwner)).map((share) => (
                      <ScreenShareVideo
                        key={`share-mini-${share.ownerUserId}`}
                        stream={getScreenStream(share.ownerUserId)}
                        person={String(share.ownerUserId) === String(user?.id) ? user : personById(share.ownerUserId)}
                        local={String(share.ownerUserId) === String(user?.id)}
                        viewerCount={screenViewerCounts[String(share.ownerUserId)] || 0}
                        onFocus={() => setFocusedScreenOwner(String(share.ownerUserId))}
                      />
                    ))}
                  </div>
                </div>
              ) : (
                <>
                  {activeScreenShares.map((share) => {
                    const ownerKey = String(share.ownerUserId);
                    const local = ownerKey === String(user?.id);
                    const person = local ? user : personById(share.ownerUserId);
                    const watching = local || Boolean(watchedScreens[ownerKey]);
                    return watching ? (
                      <ScreenShareVideo
                        key={`share-grid-${ownerKey}`}
                        stream={getScreenStream(share.ownerUserId)}
                        person={person}
                        local={local}
                        viewerCount={screenViewerCounts[ownerKey] || 0}
                        onFocus={() => setFocusedScreenOwner(ownerKey)}
                        onStopWatching={local ? null : () => toggleWatchScreen(share.ownerUserId, false)}
                      />
                    ) : (
                      <ScreenSharePreview
                        key={`share-preview-${ownerKey}`}
                        person={person}
                        requesting={requestingScreenOwner === ownerKey}
                        onWatch={() => toggleWatchScreen(share.ownerUserId, true)}
                      />
                    );
                  })}
                  {callTiles.map((tile) => (
                  <MediaTile
                    key={tile.id}
                    stream={tile.stream}
                    muted={tile.local}
                    local={tile.local}
                    videoEnabled={call.kind === "video" && (!tile.local || cameraEnabled)}
                    person={tile.person}
                    mediaState={tile.mediaState}
                    locallyMuted={!tile.local && Boolean(locallyMutedPeers[tile.id])}
                    localPreviewVisible={localPreviewVisible}
                    speakerId={tile.id}
                    onSpeakingChange={handleSpeakingChange}
                    onToggleLocalMute={() => togglePeerLocalMute(tile.id)}
                    onToggleDeafen={toggleDeafen}
                    onTogglePreview={requestToggleLocalPreview}
                    onOpenPreview={openCameraPreview}
                    onOpenSettings={openSettings}
                    screenAvailable={Boolean(availableScreenShares[String(tile.id)])}
                    onOpenScreen={() => watchedScreens[String(tile.id)] ? setFocusedScreenOwner(String(tile.id)) : toggleWatchScreen(tile.id, true)}
                  />
                ))}
                </>
              )}
            </div>

            {call.phase !== "ended" && (
              <footer>
                <button onClick={toggleMic} disabled={deafened} className={`qc-call-control ${!micEnabled ? "off" : ""}`} aria-label={micEnabled ? "Silenciar" : "Activar micrófono"} data-tooltip={micEnabled ? "Silenciar" : "Activar micrófono"}><i className={`fa-solid ${micEnabled ? "fa-microphone" : "fa-microphone-slash"}`} /></button>
                <button onClick={toggleDeafen} className={`qc-call-control ${deafened ? "off" : ""}`} title={deafened ? "Dejar de ensordecer" : "Ensordecer"}><i className={`fa-solid ${deafened ? "fa-volume-xmark" : "fa-headphones"}`} /></button>
                {call.kind === "audio" && (
                  <button onClick={upgradeToVideo} className="qc-call-control upgrade-video" disabled={!canUpgradeVideo || cameraPending} title={canUpgradeVideo ? "Cambiar a videollamada" : call.chatType === "grupo" && Number(call.initiatorId) !== Number(user?.id) ? "Solo quien inició la llamada grupal puede cambiarla a videollamada" : "No tienes permiso para realizar videollamadas"}><i className="fa-solid fa-video" /></button>
                )}
                {call.kind === "video" && (
                  <button onClick={toggleCamera} disabled={cameraPending} className={`qc-call-control ${!cameraEnabled ? "off" : ""} ${cameraPending ? "is-loading" : ""}`} aria-label={cameraPending ? "Solicitando cámara…" : cameraEnabled ? "Apagar cámara" : "Encender cámara"} data-tooltip={cameraPending ? "Solicitando cámara…" : cameraEnabled ? "Apagar cámara" : "Encender cámara"}><i className={`fa-solid ${cameraEnabled ? "fa-video" : "fa-video-slash"}`} /></button>
                )}
                <button onClick={() => screenShareActive ? stopScreenShare(true) : setScreenPickerOpen(true)} className={`qc-call-control qc-call-share-control ${screenShareActive ? "is-sharing" : ""}`} aria-label={screenShareActive ? "Dejar de transmitir pantalla" : "Compartir pantalla"} data-tooltip={screenShareActive ? "Dejar de transmitir" : "Compartir pantalla"}><ShareScreenIcon sharing={screenShareActive} /></button>
                <button onClick={hangup} className="qc-call-control hangup" aria-label="Colgar" data-tooltip="Desconectar"><i className="fa-solid fa-phone-slash" /></button>
              </footer>
            )}
          </>
        )}

        {!minimized && !popoutHost && <button className="qc-call-resize-handle" onPointerDown={beginResize} aria-label="Cambiar tamaño de la ventana" title="Arrastra para cambiar el tamaño" />}
        {minimized && !popoutHost && <button className="qc-call-resize-handle is-compact" onPointerDown={beginCompactResize} aria-label="Cambiar tamaño de la llamada minimizada" title="Arrastra para cambiar el tamaño" />}
      </section>
    );
  };

  return (
    <>
      {statusText && <div className="qc-call-toast">{statusText}</div>}

      {call && Object.entries(remoteStreams).map(([peerId, stream]) => (
        <RemoteAudioSink
          key={`audio-${peerId}`}
          stream={stream}
          muted={!speakerEnabled || deafened || Boolean(locallyMutedPeers[String(peerId)])}
          outputDeviceId={selectedDevices.audiooutput}
          volume={speakerVolume}
        />
      ))}


      {screenPickerOpen && (
        <div className="qc-call-modal-backdrop">
          <section className="qc-call-dialog qc-screen-picker-dialog" role="dialog" aria-modal="true">
            <button className="qc-call-dialog-close" onClick={() => setScreenPickerOpen(false)}><i className="fa-solid fa-xmark" /></button>
            <h3>Compartir pantalla</h3>
            <div className="qc-screen-picker-tabs">
              <button className={screenPickerTab === "applications" ? "active" : ""} onClick={() => setScreenPickerTab("applications")}><i className="fa-solid fa-window-maximize" /> Aplicaciones</button>
              <button className={screenPickerTab === "screen" ? "active" : ""} onClick={() => setScreenPickerTab("screen")}><i className="fa-solid fa-desktop" /> Pantalla completa</button>
              <button className={screenPickerTab === "device" ? "active" : ""} onClick={() => { setScreenPickerTab("device"); refreshDevices(); }}><i className="fa-solid fa-video" /> Dispositivo</button>
            </div>
            <div className="qc-screen-picker-body">
              {screenPickerTab === "applications" && (
                <button className="qc-screen-source-card" onClick={() => startScreenShare("applications")}>
                  <span className="qc-screen-source-preview"><i className="fa-solid fa-window-restore" /></span>
                  <strong>Seleccionar una aplicación</strong>
                  <small>El navegador mostrará las ventanas disponibles de forma segura.</small>
                </button>
              )}
              {screenPickerTab === "screen" && (
                <button className="qc-screen-source-card" onClick={() => startScreenShare("screen")}>
                  <span className="qc-screen-source-preview"><i className="fa-solid fa-display" /></span>
                  <strong>Seleccionar una pantalla completa</strong>
                  <small>Ideal cuando necesitas compartir todo el escritorio o un monitor.</small>
                </button>
              )}
              {screenPickerTab === "device" && (
                <div className="qc-screen-device-grid">
                  {devices.videoinput.length ? devices.videoinput.map((device, index) => (
                    <button key={device.deviceId} className="qc-screen-source-card is-device" onClick={() => { setSelectedDevices((prev) => ({ ...prev, videoinput: device.deviceId })); window.setTimeout(() => startScreenShare("device"), 0); }}>
                      <span className="qc-screen-source-preview"><i className="fa-solid fa-camera" /></span>
                      <strong>{device.label || `Cámara ${index + 1}`}</strong>
                      <small>Transmitir este dispositivo como fuente adicional.</small>
                    </button>
                  )) : <div className="qc-screen-empty">No se detectaron dispositivos de video.</div>}
                </div>
              )}
            </div>
            <div className="qc-screen-picker-note"><i className="fa-solid fa-shield-halved" /> Por seguridad, Chrome/Edge muestran el selector final de ventanas y pantallas.</div>
          </section>
        </div>
      )}

      {confirmHidePreview && (
        <div className="qc-call-modal-backdrop">
          <section className="qc-call-dialog qc-call-confirm-dialog" role="dialog" aria-modal="true">
            <button className="qc-call-dialog-close" onClick={() => setConfirmHidePreview(false)}><i className="fa-solid fa-xmark" /></button>
            <h3>¿Realmente quieres desactivarlo?</h3>
            <p>Ocultar “Mostrar mi cámara” solo oculta tu vista personal. Los demás usuarios de la llamada seguirán viendo tu video si la cámara continúa encendida.</p>
            <div className="qc-call-dialog-actions">
              <button className="secondary" onClick={() => setConfirmHidePreview(false)}>Cancelar</button>
              <button className="primary" onClick={() => { setLocalPreviewVisible(false); setConfirmHidePreview(false); }}>De acuerdo</button>
            </div>
          </section>
        </div>
      )}

      {previewOpen && (
        <div className="qc-call-modal-backdrop">
          <section className="qc-call-dialog qc-call-preview-dialog" role="dialog" aria-modal="true">
            <button className="qc-call-dialog-close" onClick={closeCameraPreview}><i className="fa-solid fa-xmark" /></button>
            <h3>¿Todo listo para el chat de video?</h3>
            <div className="qc-call-preview-screen"><video ref={previewVideoRef} autoPlay playsInline muted /></div>
            <label className="qc-call-field">
              <span>Cámara</span>
              <select value={selectedDevices.videoinput} onChange={(e) => setSelectedDevices((prev) => ({ ...prev, videoinput: e.target.value }))}>
                {devices.videoinput.map((item, index) => <option key={item.deviceId} value={item.deviceId}>{item.label || `Cámara ${index + 1}`}</option>)}
              </select>
            </label>
            <div className="qc-call-dialog-actions">
              <button className="secondary" onClick={closeCameraPreview}>Cerrar</button>
              {call?.kind === "video" && !cameraEnabled && <button className="primary" onClick={async () => { await toggleCamera(); closeCameraPreview(); }}>Encender la cámara</button>}
            </div>
          </section>
        </div>
      )}

      {settingsOpen && (
        <div className="qc-call-modal-backdrop">
          <section className="qc-call-dialog qc-call-settings-dialog" role="dialog" aria-modal="true">
            <button className="qc-call-dialog-close" onClick={() => setSettingsOpen(false)}><i className="fa-solid fa-xmark" /></button>
            <h3>Ajustes de voz y video</h3>
            <div className="qc-call-settings-grid">
              <label className="qc-call-field"><span><i className="fa-solid fa-microphone" /> Micrófono</span><select value={selectedDevices.audioinput} onChange={(e) => switchAudioInput(e.target.value)}>{devices.audioinput.map((item, index) => <option key={item.deviceId} value={item.deviceId}>{item.label || `Micrófono ${index + 1}`}</option>)}</select></label>
              <label className="qc-call-field"><span><i className="fa-solid fa-headphones" /> Altavoz</span><select value={selectedDevices.audiooutput} onChange={(e) => setSelectedDevices((prev) => ({ ...prev, audiooutput: e.target.value }))}>{devices.audiooutput.map((item, index) => <option key={item.deviceId} value={item.deviceId}>{item.label || `Altavoz ${index + 1}`}</option>)}</select></label>
              <label className="qc-call-field"><span>Volumen del micrófono</span><input type="range" min="0" max="1" step="0.05" value={micVolume} onChange={(e) => setMicVolume(Number(e.target.value))} /></label>
              <label className="qc-call-field"><span>Volumen del altavoz</span><input type="range" min="0" max="1" step="0.05" value={speakerVolume} onChange={(e) => setSpeakerVolume(Number(e.target.value))} /></label>
              <label className="qc-call-field qc-call-field-wide"><span><i className="fa-solid fa-video" /> Cámara</span><select value={selectedDevices.videoinput} onChange={(e) => switchVideoInput(e.target.value)}>{devices.videoinput.map((item, index) => <option key={item.deviceId} value={item.deviceId}>{item.label || `Cámara ${index + 1}`}</option>)}</select></label>
            </div>
            <div className="qc-call-dialog-actions"><button className="primary" onClick={() => setSettingsOpen(false)}>Listo</button></div>
          </section>
        </div>
      )}

      {incoming && !call && (
        <div className="qc-incoming-call-backdrop" role="presentation">
          <section className={`qc-incoming-call-card ${incoming.phase === "ended" ? "is-ended" : ""}`} role="dialog" aria-modal="true" aria-label="Llamada entrante">
            <div className="qc-incoming-call-badge">
              <i className={`fa-solid ${incoming.kind === "video" ? "fa-video" : "fa-phone"}`} />
              {incoming.kind === "video" ? "Videollamada entrante" : "Llamada entrante"}
            </div>

            <div className="qc-incoming-call-avatar-ring">
              <div className="qc-incoming-call-avatar">
                <Avatar person={incoming.caller} large />
              </div>
            </div>

            <div className="qc-incoming-call-copy">
              <strong>{incoming.title || displayName(incoming.caller)}</strong>
              <span>
                {incoming.phase === "ended"
                  ? incoming.endedMessage || "Llamada finalizada"
                  : incoming.silenced
                    ? "Llamada silenciada"
                    : "Te está llamando…"}
              </span>
            </div>

            {incoming.phase !== "ended" && (
              <div className="qc-incoming-call-actions">
                <button className="reject" onClick={rejectIncoming} title="Rechazar" aria-label="Rechazar llamada">
                  <i className="fa-solid fa-phone-slash" />
                  <span>Rechazar</span>
                </button>
                <button className="accept" onClick={acceptIncoming} title="Contestar" aria-label="Contestar llamada">
                  <i className={`fa-solid ${incoming.kind === "video" ? "fa-video" : "fa-phone"}`} />
                  <span>Aceptar</span>
                </button>
                <button className="ignore" onClick={ignoreIncoming} title="Ignorar" aria-label="Ignorar llamada">
                  <i className="fa-solid fa-bell-slash" />
                  <span>Ignorar</span>
                </button>
              </div>
            )}
          </section>
        </div>
      )}

      {call && (popoutHost ? createPortal(renderCallWindow(), popoutHost) : renderCallWindow())}
    </>
  );
});

export default CallManager;
