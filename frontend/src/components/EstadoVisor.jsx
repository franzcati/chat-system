import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Eye, Heart, MoreHorizontal, Pause, Play, RotateCcw, Send, Smile, Trash2, Volume2, VolumeX, X } from 'lucide-react';
import emojiSpanish from '@emoji-mart/data/i18n/es.json';
import { useTheme } from '../context/ThemeContext';
import { textPresentation } from '../utils/estadoPresentacion';
import { EstadoAvatar } from './EstadoCompositor';
import '../css/EstadoVisor.css';

const EmojiPicker = lazy(() => import('./LazyEmojiPicker'));
const imageDuration = 6000;

function displayDate(date) {
  if (!date || Number.isNaN(date.getTime())) return '';
  const day = date.toDateString() === new Date().toDateString() ? 'Hoy' : date.toLocaleDateString('es-PE', { day: 'numeric', month: 'short' });
  return `${day}, ${date.toLocaleTimeString('es-PE', { hour: 'numeric', minute: '2-digit' })}`;
}

function CircleButton({ label, children, buttonRef, className = '', ...props }) {
  return <button ref={buttonRef} type="button" className={`qc-status-icon ${className}`} aria-label={label} title={label} {...props}>{children}</button>;
}

export default function EstadoVisor({ onClose, ...props }) {
  const root = useRef(null);

  useLayoutEffect(() => {
    const dialog = root.current;
    dialog.showModal();
    return () => { if (dialog.open) dialog.close(); };
  }, []);

  useLayoutEffect(() => { root.current?.querySelector('.qc-status-close')?.focus(); }, [props.item.id]);

  return <dialog ref={root} className="qc-status-dialog" aria-label="Visor de estados"
    onCancel={event => { event.preventDefault(); onClose(); }}>
    <StatusSlide key={props.item.id} {...props} onClose={onClose} />
  </dialog>;
}

function StatusSlide({ item, sequence, index, group, author, date, own, onClose, onPrevious, onNext, onViewed, onReply, onReact, onDelete }) {
  const { theme } = useTheme();
  const [ready, setReady] = useState(item.tipo === 'texto');
  const [fit, setFit] = useState('contain');
  const [progress, setProgress] = useState(0);
  const [manualPause, setManualPause] = useState(false);
  const [hidden, setHidden] = useState(() => document.hidden);
  const [muted, setMuted] = useState(true);
  const [menu, setMenu] = useState(false);
  const [emoji, setEmoji] = useState(false);
  const [editing, setEditing] = useState(false);
  const [reply, setReply] = useState('');
  const [pending, setPending] = useState('');
  const [error, setError] = useState('');
  const [mediaError, setMediaError] = useState(false);
  const elapsed = useRef(0);
  const seen = useRef(false);
  const action = useRef('');
  const frame = useRef(null);
  const video = useRef(null);
  const replyField = useRef(null);
  const menuButton = useRef(null);
  const emojiButton = useRef(null);
  const caret = useRef(null);
  const touchStart = useRef(null);

  const isVideo = item.tipo === 'video';
  const isText = item.tipo === 'texto';
  const path = `/api/estados/${encodeURIComponent(item.id)}/media`;
  const style = isText ? textPresentation(item.apariencia, item.fondo || '#1d3e70') : null;
  const blockedNavigation = pending === 'reply' || pending === 'delete';
  const paused = manualPause || hidden || menu || emoji || editing || Boolean(reply.trim()) || Boolean(pending) || Boolean(error);

  useEffect(() => {
    const update = () => setHidden(document.hidden);
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);

  useEffect(() => {
    if (!ready || seen.current) return;
    seen.current = true;
    onViewed(item.id);
  }, [item.id, onViewed, ready]);

  useEffect(() => {
    if (!ready || mediaError || isVideo || paused) return;
    let id;
    let last = performance.now();
    function tick(now) {
      elapsed.current += Math.max(0, now - last);
      last = now;
      setProgress(Math.min(100, elapsed.current * 100 / imageDuration));
      if (elapsed.current >= imageDuration) onNext();
      else id = requestAnimationFrame(tick);
    }
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [isVideo, mediaError, onNext, paused, ready]);

  useEffect(() => {
    const player = video.current;
    if (!isVideo || !ready || !player) return;
    if (paused || mediaError) player.pause();
    else {
      let active = true;
      player.play().catch(() => { if (active) setManualPause(true); });
      return () => { active = false; };
    }
  }, [isVideo, mediaError, paused, ready]);

  function drawVideoBackdrop() {
    const player = video.current;
    const canvas = frame.current;
    if (!canvas || !player?.videoWidth || player.readyState < 2) return;
    canvas.getContext('2d')?.drawImage(player, 0, 0, canvas.width, canvas.height);
  }

  function mediaReady(width, height) {
    const ratio = width / height;
    setFit(ratio >= .68 && ratio <= .95 ? 'cover' : 'contain');
    setReady(true);
  }

  function reset() {
    elapsed.current = 0;
    if (isVideo && ready) video.current.currentTime = 0;
    setProgress(0);
    setMenu(false);
    menuButton.current?.focus();
    setManualPause(false);
    setError('');
  }

  function startVideo() {
    if (!video.current) return;
    setError('');
    setManualPause(false);
    void video.current.play().catch(() => {
      setManualPause(true);
      setError('No se pudo iniciar el video. Intenta reproducirlo otra vez.');
    });
  }

  function togglePause() {
    if (mediaError) return;
    if (manualPause && isVideo && !hidden && !editing && !reply.trim() && !pending && !emoji && !menu) {
      startVideo();
      return;
    }
    setManualPause(!manualPause);
  }

  function toggleSound() {
    if (video.current) video.current.muted = !muted;
    setMuted(!muted);
  }

  function keyDown(event) {
    if (event.key === 'Escape') {
      if (emoji || menu) {
        event.preventDefault();
        (emoji ? emojiButton : menuButton).current?.focus();
        setMenu(false);
        setEmoji(false);
      } else if (blockedNavigation) event.preventDefault();
      return;
    }
    if (event.target.closest('input,textarea,[data-status-popover]') || event.altKey || event.ctrlKey || event.metaKey) return;
    if (['ArrowLeft', 'ArrowRight'].includes(event.key)) {
      event.preventDefault();
      if (!blockedNavigation) {
        if (event.key === 'ArrowLeft' && index > 0) onPrevious();
        if (event.key === 'ArrowRight') onNext();
      }
    } else if ((event.key === ' ' && !event.target.closest('button')) || event.key.toLowerCase() === 'k') {
      event.preventDefault();
      togglePause();
    } else if (event.key.toLowerCase() === 'm' && isVideo) {
      event.preventDefault();
      toggleSound();
    }
  }

  function swipe(event) {
    const start = touchStart.current;
    touchStart.current = null;
    if (!start || blockedNavigation || !event.changedTouches.length) return;
    const { clientX, clientY } = event.changedTouches[0];
    const dx = clientX - start.clientX;
    if (Math.abs(dx) < 48 || Math.abs(dx) < Math.abs(clientY - start.clientY) * 1.35) return;
    if (dx < 0) onNext();
    else if (index > 0) onPrevious();
  }

  async function run(name, work) {
    if (action.current) return;
    action.current = name;
    setPending(name);
    setError('');
    try { await work(); }
    catch (cause) { setError(cause.message || 'No se pudo completar la operación'); }
    finally {
      action.current = '';
      setPending('');
    }
  }

  function insertEmoji({ native }) {
    if (!native) return;
    const [start, end] = caret.current ?? [reply.length, reply.length];
    const value = reply.slice(0, start) + native + reply.slice(end);
    if (value.length > 2000) return;
    setReply(value);
    setEmoji(false);
    requestAnimationFrame(() => {
      replyField.current?.focus();
      replyField.current?.setSelectionRange(start + native.length, start + native.length);
    });
  }

  function remove() {
    setMenu(false);
    if (window.confirm('¿Eliminar este estado? Se retirará de todos sus destinos.')) void run('delete', onDelete);
  }

  return <div className="qc-status-shell" onKeyDown={keyDown}>
    <div className="qc-status-backdrop" aria-hidden="true">
      {!mediaError && ready && !isText && !isVideo && <img src={path} alt="" />}
      {isVideo && <canvas ref={frame} width={80} height={110} hidden={!ready || mediaError} />}
      {style && <div style={{ background: style.background }} />}
    </div>
    <CircleButton label="Cerrar" className="qc-status-close" onClick={onClose} disabled={blockedNavigation}><X size={24} /></CircleButton>
    <CircleButton label="Anterior" className="qc-status-prev" onClick={onPrevious} disabled={!index || blockedNavigation}><ChevronLeft /></CircleButton>
    <article className="qc-status-frame" aria-label={`Estado de ${author}`}>
      <div className="qc-status-media" style={style ? { background: style.background } : undefined}
        onTouchStart={event => { touchStart.current = event.touches.length === 1 ? event.touches[0] : null; }}
        onTouchCancel={() => { touchStart.current = null; }} onTouchEnd={swipe}>
        {!mediaError && (isText
          ? <div className="qc-status-text" style={{ ...style, background: 'transparent' }}>{item.texto}</div>
          : isVideo
            ? <video ref={video} src={path} playsInline muted={muted} preload="auto" style={{ objectFit: fit }}
                onLoadedData={event => { mediaReady(event.currentTarget.videoWidth, event.currentTarget.videoHeight); drawVideoBackdrop(); }}
                onTimeUpdate={event => {
                  const player = event.currentTarget;
                  if (Number.isFinite(player.duration) && player.duration > 0) setProgress(Math.min(100, 100 * player.currentTime / player.duration));
                  drawVideoBackdrop();
                }}
                onEnded={() => { if (!paused && !mediaError) onNext(); }}
                onError={() => setMediaError(true)} aria-label="Video del estado" />
            : <img src={path} style={{ objectFit: fit }} alt={item.texto ? 'Imagen del estado con leyenda' : 'Imagen del estado'}
                onLoad={event => mediaReady(event.currentTarget.naturalWidth, event.currentTarget.naturalHeight)}
                onError={() => setMediaError(true)} />)}
        {mediaError ? <p className="qc-status-media-message" role="alert">El contenido ya no está disponible.</p>
           : !ready && (isVideo
            ? <CircleButton label="Iniciar video" className="qc-status-start-video" onClick={startVideo}><Play /></CircleButton>
            : <p className="qc-status-media-message" role="status">Cargando estado…</p>)}
      </div>
      <header className="qc-status-header">
        <div className="qc-status-progress" aria-label={`Estado ${index + 1} de ${sequence.length}`}>
          {sequence.map((entry, position) => <span key={entry.id} aria-hidden="true"><i style={{ width: `${position < index ? 100 : position === index ? progress : 0}%` }} /></span>)}
        </div>
        <div className="qc-status-meta">
          <CircleButton label="Volver al estado anterior" className="qc-status-header-prev" onClick={onPrevious} disabled={!index || blockedNavigation}><ChevronLeft /></CircleButton>
          <span className="qc-status-avatar"><EstadoAvatar user={item} /></span>
          <div className="qc-status-byline">
            <strong>{author}</strong>
            <time dateTime={date && !Number.isNaN(date.getTime()) ? date.toISOString() : undefined}>{displayDate(date)}</time>
            {group && <small title={group.nombre}>{group.nombre}</small>}
          </div>
          <div className="qc-status-controls">
            {ready && !mediaError && <CircleButton label={manualPause ? 'Continuar' : 'Pausar'} className="qc-status-playback" onClick={togglePause}>{manualPause ? <Play /> : <Pause />}</CircleButton>}
            {isVideo && !mediaError && <CircleButton label={muted ? 'Activar sonido' : 'Silenciar'} aria-pressed={!muted} onClick={toggleSound}>{muted ? <VolumeX /> : <Volume2 />}</CircleButton>}
            <CircleButton buttonRef={menuButton} label="Más opciones" onClick={() => { setMenu(!menu); setEmoji(false); }} aria-expanded={menu}><MoreHorizontal /></CircleButton>
            {menu && <div className="qc-status-menu" data-status-popover role="group" aria-label="Opciones del estado">
              <button type="button" onClick={reset} disabled={!ready || mediaError}><RotateCcw size={17} /> Volver a reproducir</button>
              {own && <button type="button" onClick={remove} disabled={Boolean(pending)}><Trash2 size={17} /> Eliminar estado</button>}
              <button type="button" onClick={onClose} disabled={blockedNavigation}><X size={17} /> Cerrar visor</button>
            </div>}
          </div>
        </div>
      </header>
      <footer className="qc-status-footer">
        {(isText ? item.leyenda : item.texto) && <p className="qc-status-caption">{isText ? item.leyenda : item.texto}</p>}
        {error && <div className="qc-status-error" role="alert"><span>{error}</span><CircleButton label="Cerrar aviso" onClick={() => setError('')}><X size={16} /></CircleButton></div>}
        {own ? <div className="qc-status-views"><Eye size={22} /> {item.vistas ?? 0} {Number(item.vistas) === 1 ? 'visualización' : 'visualizaciones'}</div>
          : <form className="qc-status-reply" onSubmit={event => {
            event.preventDefault();
            if (reply.trim() && !pending) void run('reply', () => onReply(reply.trim()));
          }}>
            <CircleButton buttonRef={emojiButton} label={emoji ? 'Cerrar emojis' : 'Elegir emoji'} className="qc-status-emoji-button" onClick={() => { setEmoji(!emoji); setMenu(false); }} aria-expanded={emoji} disabled={blockedNavigation}><Smile /></CircleButton>
            <div className="qc-status-reply-field">
              <input ref={replyField} value={reply} maxLength={2000} aria-label={group ? `Responder en ${group.nombre}` : 'Responder en privado'}
                placeholder="Escribe una respuesta…" disabled={blockedNavigation}
                onFocus={() => setEditing(true)} onBlur={event => { caret.current = [event.target.selectionStart, event.target.selectionEnd]; setEditing(false); }}
                onChange={event => setReply(event.target.value)} />
              {reply.trim() && <button type="submit" className="qc-status-send" aria-label="Enviar respuesta" disabled={Boolean(pending)}><Send size={21} /></button>}
            </div>
            <CircleButton label={item.reaccion_propia ? 'Quitar corazón' : 'Enviar corazón'} className="qc-status-heart"
              aria-pressed={Boolean(item.reaccion_propia)} disabled={Boolean(pending)} onClick={() => void run('reaction', () => onReact(!item.reaccion_propia))}>
              <Heart fill={item.reaccion_propia ? 'currentColor' : 'none'} />
            </CircleButton>
            {emoji && <div className="qc-status-emoji" data-status-popover>
              <Suspense fallback={<p role="status">Cargando emojis…</p>}>
                <EmojiPicker theme={theme} locale="es" i18n={emojiSpanish} perLine={7} previewPosition="none" onEmojiSelect={insertEmoji} />
              </Suspense>
            </div>}
          </form>}
      </footer>
    </article>
    <CircleButton label="Siguiente" className="qc-status-next" onClick={onNext} disabled={blockedNavigation}><ChevronRight /></CircleButton>
  </div>;
}
