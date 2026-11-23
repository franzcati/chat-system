import { createElement, lazy, Suspense, useEffect, useRef, useState } from 'react';
import {
  AlignCenter, AlignLeft, AlignRight, Bold, Check, CirclePlay, Clock, Crop, Image as Picture,
  Italic, MessageCircle, Palette, Play, Scan, Search, Send, Smile, Type, Underline, Upload, Users, Video, X,
} from 'lucide-react';
import emojiSpanish from '@emoji-mart/data/i18n/es.json';
import { useTheme } from '../context/ThemeContext';
import { getAvatarUrl } from '../utils/url';
import { PALETTE, statusProportion, textPresentation } from '../utils/estadoPresentacion';
import GroupAvatar from './GroupAvatar';

const EmojiPicker = lazy(() => import('./LazyEmojiPicker'));
const accepted = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/webm'];
const sizeLimit = 30 * 1024 * 1024;

export function EstadoAvatar({ user }) {
  const photo = getAvatarUrl(user?.url_imagen);
  return <span className="qc-states-avatar">{photo
    ? <img src={photo} alt="" />
    : <span aria-hidden="true">{user?.nombre?.[0]?.toUpperCase() || '?'}</span>}</span>;
}

function Destinations({ user, groups, personal, setPersonal, selected, setSelected, loading, error, onRetry }) {
  const [search, setSearch] = useState('');
  const normalized = value => value.toLocaleLowerCase('es').normalize('NFD').replace(/\p{Diacritic}/gu, '');
  const shown = groups.filter(group => normalized(group.nombre).includes(normalized(search.trim())));
  const total = Number(personal) + selected.length;

  function toggle(id, checked) {
    setSelected(previous => checked ? [...previous, id] : previous.filter(item => item !== id));
  }

  return <section className="qc-states-dest">
    <header>
      <span className="qc-states-tile"><Users size={18} /></span>
      <h3>¿Dónde quieres compartir?</h3>
      <output aria-live="polite">{total} {total === 1 ? 'destino seleccionado' : 'destinos seleccionados'}</output>
    </header>
    <div className="qc-states-dest-body">
      <label className="qc-states-dest-row is-personal">
        <EstadoAvatar user={user} />
        <span><strong>Mi estado</strong><small>Visible para los miembros de tu organización</small></span>
        <input type="checkbox" checked={personal} onChange={event => setPersonal(event.target.checked)} />
      </label>
      <h4>Grupos</h4>
      <label className="qc-states-field"><Search size={17} /><input type="search" aria-label="Buscar grupos" onKeyDown={event => { if (event.key === 'Enter') event.preventDefault(); }} placeholder="Buscar grupos…" value={search} onChange={event => setSearch(event.target.value)} /></label>
      <div className="qc-states-group-options">
        {loading && <p className="qc-states-note" role="status">Cargando grupos…</p>}
        {error && <p className="qc-states-note" role="alert">{error} <button type="button" onClick={onRetry}>Reintentar</button></p>}
        {!loading && !error && !shown.length && <p className="qc-states-note">{groups.length ? 'No hay grupos que coincidan.' : 'No tienes grupos habilitados para publicar.'}</p>}
        {shown.map(group => {
          const id = Number(group.id);
          const count = group.miembros_cantidad;
          return <label key={id} className="qc-states-dest-row">
            <GroupAvatar group={group} size={38} />
            <span><strong>{group.nombre}</strong>{count != null && <small>{count} {Number(count) === 1 ? 'miembro' : 'miembros'}</small>}</span>
            <input type="checkbox" checked={selected.includes(id)} onChange={event => toggle(id, event.target.checked)} />
          </label>;
        })}
      </div>
    </div>
  </section>;
}

function ImageCrop({ url, file, onApply, onCancel, onError }) {
  const image = useRef(null);
  const canvas = useRef(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [horizontal, setHorizontal] = useState(50);
  const [vertical, setVertical] = useState(50);
  const [ratio, setRatio] = useState(1);

  function bounds() {
    const { naturalWidth: width, naturalHeight: height } = image.current;
    const areaWidth = Math.min(width, height * ratio) / zoom;
    const areaHeight = areaWidth / ratio;
    return [(width - areaWidth) * horizontal / 100, (height - areaHeight) * vertical / 100, areaWidth, areaHeight];
  }

  useEffect(() => {
    if (!ready) return;
    const preview = canvas.current;
    preview.height = Math.round(preview.width / ratio);
    preview.getContext('2d').drawImage(image.current, ...bounds(), 0, 0, preview.width, preview.height);
  });

  async function apply() {
    setBusy(true);
    const area = bounds();
    const result = document.createElement('canvas');
    result.width = Math.max(1, Math.floor(Math.min(area[2], 2048, 2048 * ratio)));
    result.height = Math.max(1, Math.round(result.width / ratio));
    try {
      result.getContext('2d').drawImage(image.current, ...area, 0, 0, result.width, result.height);
      const blob = await new Promise(resolve => result.toBlob(resolve, file.type, .92));
      if (!blob || blob.size >= sizeLimit) throw new Error('No se pudo generar el recorte dentro del límite de 30 MB');
      const suffix = blob.type === 'image/jpeg' ? 'jpg' : 'png';
      onApply(new File([blob], `${file.name.replace(/\.[^.]+$/, '')}-recorte.${suffix}`, { type: blob.type }));
    } catch (error) {
      onError(error.message);
      setBusy(false);
    }
  }

  return <div className="qc-states-crop">
    <img ref={image} src={url} hidden alt="" onLoad={() => setReady(true)} onError={() => onError('No se pudo abrir la imagen para recortar')} />
    <canvas ref={canvas} width={250} aria-label="Previsualización del recorte" />
    <div className="qc-states-crop-controls">
      <label>Proporción<select value={ratio} onChange={event => setRatio(Number(event.target.value))}><option value="1">1:1</option><option value={9 / 16}>9:16</option><option value={16 / 9}>16:9</option></select></label>
      <label>Zoom<input type="range" min="1" max="4" step=".05" value={zoom} onChange={event => setZoom(Number(event.target.value))} /></label>
      <label>Horizontal<input type="range" min="0" max="100" value={horizontal} onChange={event => setHorizontal(Number(event.target.value))} /></label>
      <label>Vertical<input type="range" min="0" max="100" value={vertical} onChange={event => setVertical(Number(event.target.value))} /></label>
    </div>
    <div className="qc-states-media-actions"><button type="button" disabled={busy} onClick={onCancel}>Volver</button><button type="button" disabled={!ready || busy} onClick={apply}><Check size={16} /> Aplicar recorte</button></div>
  </div>;
}

function Multimedia({ active, file, onPick, onError, crop, setCrop, valid, setValid }) {
  const picker = useRef(null);
  const video = useRef(null);
  const dragging = useRef(0);
  const [isDragging, setDragging] = useState(false);
  const [preview, setPreview] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [proportion, setProportion] = useState('');
  const url = preview?.file === file ? preview.url : '';
  const isVideo = file?.type.startsWith('video/');

  useEffect(() => {
    if (!file) return;
    const objectUrl = URL.createObjectURL(file);
    setPreview({ file, url: objectUrl });
    setPlaying(false);
    setProportion('');
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);

  useEffect(() => { if (!active) video.current?.pause(); }, [active]);

  function select(files) {
    if (!files.length) return;
    if (files.length !== 1) return onError('Selecciona un solo archivo');
    const [next] = files;
    if (!accepted.includes(next.type)) return onError('Usa una imagen JPG, PNG, WebP o GIF, o un video MP4 o WebM');
    if (!next.size || next.size >= sizeLimit) return onError('Selecciona un archivo no vacío de menos de 30 MB');
    onPick(next);
  }

  return <div className="qc-states-multimedia">
    <input type="file" aria-label="Archivo del estado" ref={picker} accept={accepted.join(',')} hidden
      onChange={event => { select(event.target.files); event.target.value = ''; }} />
    {!file ? <div className={`qc-states-drop ${isDragging ? 'is-dragging' : ''}`}
      onDragEnter={event => { event.preventDefault(); dragging.current++; setDragging(true); }}
      onDragOver={event => event.preventDefault()}
      onDragLeave={event => { event.preventDefault(); if (--dragging.current <= 0) setDragging(false); }}
      onDrop={event => { event.preventDefault(); dragging.current = 0; setDragging(false); select(event.dataTransfer.files); }}>
      <span className="qc-states-drop-icon"><Picture size={54} /></span>
      <strong>Arrastra o selecciona una foto, video o GIF</strong>
      <small>JPG, PNG, WEBP, GIF, MP4 y WEBM · Máx. 30 MB</small>
      <button type="button" className="qc-states-button is-outline" onClick={() => picker.current.click()}><Upload size={17} /> Seleccionar archivo</button>
      <span className="qc-states-drop-hint"><Scan size={16} /> Arrastra y suelta aquí tu archivo</span>
    </div> : url && (crop
      ? <ImageCrop url={url} file={file} onApply={onPick} onCancel={() => setCrop(false)} onError={onError} />
      : <>
        <div className="qc-states-media-preview">
          {isVideo ? <div className="qc-states-video-frame">
            <video key={url} ref={video} src={url} controls playsInline preload="metadata"
              onPlaying={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)}
              onLoadedMetadata={event => {
                const media = event.currentTarget;
                setProportion(statusProportion(media.videoWidth, media.videoHeight));
                setValid(Boolean(media.videoWidth && media.videoHeight));
              }}
              onError={() => { setValid(false); onError('El navegador no puede reproducir este video'); }} />
            {proportion && <span className="qc-states-ratio"><Video size={15} />{proportion}</span>}
            {!playing && valid && <button type="button" className="qc-states-play" aria-label="Reproducir video" onClick={() => video.current.play().catch(() => onError('No se pudo reproducir el video'))}><Play fill="currentColor" /></button>}
          </div> : <img key={url} src={url} alt="Vista previa del archivo" onLoad={() => setValid(true)}
            onError={() => { setValid(false); onError('No se pudo abrir la imagen'); }} />}
        </div>
        <div className="qc-states-media-actions">
          <span title={file.name}>{file.name}</span>
          <button type="button" onClick={() => picker.current.click()}>Sustituir</button>
          <button type="button" aria-label="Quitar archivo" onClick={() => onPick(null)}><X size={17} /></button>
        </div>
      </>)}
  </div>;
}

const formats = [
  ['negrita', Bold, 'Negrita'], ['cursiva', Italic, 'Cursiva'], ['subrayado', Underline, 'Subrayado'],
];
const alignments = [
  ['left', AlignLeft, 'Alinear a la izquierda'], ['center', AlignCenter, 'Centrar'], ['right', AlignRight, 'Alinear a la derecha'],
];

export default function EstadoCompositor({ user, groups, groupsLoading, groupsError, onReloadGroups, canPost, onPublish, onCancel }) {
  const { theme } = useTheme();
  const [mode, setMode] = useState('media');
  const [personal, setPersonal] = useState(true);
  const [selected, setSelected] = useState([]);
  const [text, setText] = useState('');
  const [mediaCaption, setMediaCaption] = useState('');
  const [textCaption, setTextCaption] = useState('');
  const [appearance, setAppearance] = useState({ paleta: 'aurora', alineacion: 'center', negrita: false, cursiva: false, subrayado: false });
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [emojiTarget, setEmojiTarget] = useState(null);
  const [file, setFile] = useState(null);
  const [valid, setValid] = useState(false);
  const [crop, setCrop] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const request = useRef(null);
  const inFlight = useRef(false);
  const editor = useRef(null);
  const caption = useRef(null);
  const lastField = useRef('editor');
  const selection = useRef({});
  const isText = mode === 'text';
  const captionValue = isText ? textCaption : mediaCaption;
  const setCaption = isText ? setTextCaption : setMediaCaption;
  const style = { ...appearance, tema: theme };
  const palette = PALETTE.find(option => option.id === style.paleta);
  const cropSupported = valid && ['image/jpeg', 'image/png'].includes(file?.type);
  const canSend = !busy && canPost && !crop && (personal || selected.length > 0) && (isText ? text.trim() : file && valid);

  function pick(next) {
    setError('');
    setCrop(false);
    setValid(false);
    setFile(next);
  }

  function switchMode(next) {
    setMode(next);
    lastField.current = next === 'text' ? 'editor' : 'caption';
    setEmojiTarget(null);
    setPaletteOpen(false);
    setCrop(false);
    setError('');
  }

  function remember(target, event) {
    lastField.current = target;
    selection.current[target] = [event.target.selectionStart, event.target.selectionEnd];
  }

  function insertEmoji({ native }) {
    if (!native) return;
    const isEditor = emojiTarget === 'editor';
    const value = isEditor ? text : captionValue;
    const [start, end] = selection.current[emojiTarget] || [value.length, value.length];
    const next = value.slice(0, start) + native + value.slice(end);
    if (next.length > 700) return setError('El texto supera los 700 caracteres');
    (isEditor ? setText : setCaption)(next);
    setEmojiTarget(null);
    requestAnimationFrame(() => {
      const field = isEditor ? editor.current : caption.current;
      field?.focus();
      field?.setSelectionRange(start + native.length, start + native.length);
    });
  }

  async function submit(event) {
    event.preventDefault();
    if (!canSend || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    const body = new FormData();
    body.set('destinos', JSON.stringify({ mi_estado: personal, grupos: [...selected].sort((a, b) => a - b) }));
    body.set('texto', isText ? text.trim() : mediaCaption.trim());
    if (isText) {
      body.set('fondo', palette.color);
      body.set('apariencia', JSON.stringify(style));
      body.set('leyenda', textCaption.trim());
    }
    const snapshot = JSON.stringify([...body]);
    const attachment = isText ? null : file;
    try {
      if (request.current?.snapshot !== snapshot || request.current?.attachment !== attachment) {
        request.current = { snapshot, attachment, key: crypto.randomUUID() };
      }
      if (attachment) body.set('archivo', attachment);
      await onPublish(body, request.current.key);
    } catch (error) {
      setError(error.message);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return <form className="qc-states-composer" onSubmit={submit} onKeyDown={event => {
    if (event.key !== 'Escape') return;
    if (emojiTarget) setEmojiTarget(null);
    else if (paletteOpen) setPaletteOpen(false);
    else if (crop) setCrop(false);
  }}>
    <header className="qc-states-composer-head">
      <span className="qc-states-tile"><CirclePlay size={27} /></span>
      <div><h2>Crear estado</h2><p>Comparte fotos, videos, GIFs o texto con tu equipo.</p></div>
    </header>
    <fieldset className="qc-states-compose-grid" disabled={busy}>
      <div className="qc-states-editor-pane">
        <div className="qc-states-tabs" role="group" aria-label="Tipo de estado">
          <button type="button" aria-pressed={!isText} onClick={() => switchMode('media')}><Picture size={19} /> Multimedia</button>
          <button type="button" aria-pressed={isText} onClick={() => switchMode('text')}><Type size={20} /> Texto</button>
        </div>
        <div hidden={isText}>
          <Multimedia active={!isText} file={file} onPick={pick} onError={setError} crop={crop} setCrop={setCrop} valid={valid} setValid={setValid} />
        </div>
        {isText && <>
          <div className="qc-states-text-canvas" style={textPresentation(style)}>
            <textarea ref={editor} rows="4" aria-label="Texto del estado" maxLength={700}
              value={text} onChange={event => setText(event.target.value)} placeholder="Escribe tu estado…"
              onSelect={event => remember('editor', event)} onFocus={event => remember('editor', event)} />
          </div>
          <div className="qc-states-format" role="group" aria-label="Formato de texto">
            {formats.map(([key, Icon, name]) => <button type="button" key={key} aria-label={name} title={name} aria-pressed={appearance[key]} onClick={() => setAppearance({ ...appearance, [key]: !appearance[key] })}>{createElement(Icon, { size: 20 })}</button>)}
            <span className="qc-states-divider" />
            {alignments.map(([key, Icon, name]) => <button type="button" key={key} aria-label={name} title={name} aria-pressed={appearance.alineacion === key} onClick={() => setAppearance({ ...appearance, alineacion: key })}>{createElement(Icon, { size: 20 })}</button>)}
            <span className="qc-states-divider" />
            <button type="button" aria-label="Color de fondo" title="Color de fondo" aria-expanded={paletteOpen} onClick={() => setPaletteOpen(!paletteOpen)}><Palette size={21} /></button>
            {paletteOpen && <div className="qc-states-palette" role="group" aria-label="Colores de fondo">
              <header><strong>Color de fondo</strong><small>Cambia el color de tu estado.</small></header>
              <div>{PALETTE.map(option => <button type="button" key={option.id} style={{ '--swatch': option.swatch }}
                title={option.name} aria-label={option.name} aria-pressed={appearance.paleta === option.id}
                onClick={() => setAppearance({ ...appearance, paleta: option.id })} />)}</div>
            </div>}
          </div>
        </>}
      </div>
      <div className="qc-states-options">
        <Destinations user={user} groups={groups} personal={personal} setPersonal={setPersonal} selected={selected}
          setSelected={setSelected} loading={groupsLoading} error={groupsError} onRetry={onReloadGroups} />
        <label className="qc-states-field qc-states-caption"><MessageCircle size={18} />
          <textarea key={mode} ref={caption} rows="2" aria-label="Leyenda" placeholder="Escribe una leyenda…" maxLength={700} value={captionValue}
            onChange={event => setCaption(event.target.value)} onSelect={event => remember('caption', event)} onFocus={event => remember('caption', event)} />
        </label>
        <div className="qc-states-tools">
          {!isText && <button type="button" onClick={() => switchMode('text')}><Type size={17} /> Texto</button>}
          <button type="button" aria-expanded={Boolean(emojiTarget)} onClick={() => setEmojiTarget(emojiTarget ? null : isText ? lastField.current : 'caption')}><Smile size={17} /> Emoji</button>
          {!isText && cropSupported && <button type="button" aria-pressed={crop} onClick={() => setCrop(!crop)}><Crop size={17} /> Recortar</button>}
          <small><Clock size={17} /> Visible durante 24 horas</small>
        </div>
        {emojiTarget && <div className="qc-states-emoji"><button type="button" aria-label="Cerrar emojis" onClick={() => setEmojiTarget(null)}><X size={17} /></button>
          <Suspense fallback={<p role="status">Cargando emojis…</p>}>
            <EmojiPicker theme={theme} locale="es" i18n={emojiSpanish} perLine={7} previewPosition="none" maxFrequentRows={1} onEmojiSelect={insertEmoji} />
          </Suspense>
        </div>}
      </div>
    </fieldset>
    <footer className="qc-states-composer-actions">
      {!canPost && <p className="qc-states-feedback is-error" role="alert">Tu cuenta no tiene permiso para publicar.</p>}
      {error && <p className="qc-states-feedback is-error" role="alert">{error}</p>}
      <button type="button" className="qc-states-button is-outline" onClick={onCancel} disabled={busy}>Cancelar</button>
      <button type="submit" className="qc-states-button is-primary" disabled={!canSend}><Send size={17} /> {busy ? 'Publicando…' : 'Publicar estado'}</button>
    </footer>
  </form>;
}
