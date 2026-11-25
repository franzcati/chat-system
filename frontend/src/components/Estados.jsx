import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Image, Play, Plus, RefreshCw, Send, Sparkle, Type } from 'lucide-react';
import EstadoCompositor, { EstadoAvatar } from './EstadoCompositor';
import GroupAvatar from './GroupAvatar';
import EstadoVisor from './EstadoVisor';
import { activeStatuses, nextStatusExpiration, buildTracks, ringPaint, statusStamp, statusDate } from '../utils/estadoPresentacion';
import '../css/Estados.css';

async function call(url, options = {}) {
  const response = await fetch(url, { credentials: 'include', cache: 'no-store', ...options });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body) {
    throw Object.assign(new Error(body?.error || 'No se pudo completar la operación'), { status: response.status });
  }
  return body;
}

const nameOf = user => `${user.nombre || ''} ${user.apellido || ''}`.trim() || 'Usuario';
function StatusArt() {
  return <div className="qc-states-art" aria-hidden="true">
    <span className="qc-states-orbit" />
    <span className="qc-states-emblem"><i /></span>
    <span className="qc-states-art-tile is-image"><Image /></span>
    <span className="qc-states-art-tile is-video"><Play fill="currentColor" /></span>
    <span className="qc-states-art-tile is-text"><Type /></span>
    <span className="qc-states-art-tile is-gif">GIF</span>
    <Sparkle className="qc-states-star is-top" fill="currentColor" />
    <Sparkle className="qc-states-star is-right" fill="currentColor" />
  </div>;
}

function TrackList({ title, tracks, onOpen, empty, disabled, userId }) {
  if (!tracks.length && !empty) return null;
  return <div className="qc-states-track-section">
    <h2>{title}</h2>
    {tracks.length ? <div className="qc-states-track-list">{tracks.map(track => (
      <button type="button" key={track.key} className="qc-states-person" disabled={disabled}
        onClick={() => onOpen(track.entries.find(item => !Number(item.visto) && String(item.autor_id) !== String(userId)) || track.entries[0], track)}>
        <span className={track.group ? 'qc-status-group-pair' : undefined}>
          {track.group && <GroupAvatar group={track.group} size={37} />}
          <span className="qc-states-ring" style={{ background: ringPaint(track.entries, userId) }}><EstadoAvatar user={track.latest} /></span>
        </span>
        <span><strong>{nameOf(track.latest)}</strong>{track.group && <small>{track.group.nombre}</small>}<small>{statusStamp(track.latest.creado_at)}</small></span>
      </button>
    ))}</div> : <p className="qc-states-note">{empty}</p>}
  </div>;
}

export default function Estados({ usuario, onOpenGroup, onOpenPrivate, direct, onExit, onStatusFeed }) {
  const [items, setItems] = useState(() => activeStatuses(direct?.items || []));
  const [groups, setGroups] = useState([]);
  const [canPost, setCanPost] = useState(false);
  const [loading, setLoading] = useState(true);
  const [groupsLoading, setGroupsLoading] = useState(false);
  const [feedError, setFeedError] = useState('');
  const [groupsError, setGroupsError] = useState('');
  const [selected, setSelected] = useState(direct?.selection || null);
  const [compose, setCompose] = useState(false);
  const [notice, setNotice] = useState('');
  const dismissed = useRef(new Set());
  const feedRequest = useRef(0);
  const composerOpened = useRef(null);
  const viewerOpened = useRef(null);
  const moduleRoot = useRef(null);

  const load = useCallback(async () => {
    const request = ++feedRequest.current;
    try {
      const data = await call('/api/estados', { headers: { 'X-Estados-Contrato': '2' } });
      if (request !== feedRequest.current) return;
      setItems(activeStatuses(data.estados.filter(item => !dismissed.current.has(String(item.id)))));
      setCanPost(data.puede_publicar);
      setFeedError('');
    } catch (error) {
      if (request !== feedRequest.current) return;
      setFeedError(error.message);
      if (error.status === 401 || error.status === 403) {
        setItems([]);
        setCanPost(false);
      }
    } finally {
      if (request === feedRequest.current) setLoading(false);
    }
  }, []);

  const loadGroups = useCallback(async () => {
    setGroupsLoading(true);
    setGroupsError('');
    try {
      const data = await call('/api/estados/grupos');
      setGroups(data.grupos);
    } catch (error) {
      setGroupsError(error.message);
    } finally {
      setGroupsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(load, 20000);
    return () => clearInterval(timer);
  }, [load]);

  useEffect(() => {
    const now = Date.now();
    if (activeStatuses(items, now).length !== items.length) {
      setItems(previous => activeStatuses(previous));
      return;
    }
    const expiration = nextStatusExpiration(items, now);
    if (!Number.isFinite(expiration)) return;
    const timer = setTimeout(() => setItems(previous => activeStatuses(previous)),
      Math.min(2147483647, Math.max(1, expiration - Date.now())));
    return () => clearTimeout(timer);
  }, [items]);

  useEffect(() => {
    if (!loading) onStatusFeed?.(items);
  }, [items, loading, onStatusFeed]);

  const tracks = useMemo(() => [...buildTracks(items, usuario?.id, !direct).values()], [items, usuario?.id, direct]);
  const own = tracks.find(track => track.key === `u:${usuario?.id}`);
  const other = tracks.filter(track => track !== own);
  const currentTrack = tracks.find(track => track.key === selected?.key);
  const current = currentTrack?.entries.find(item => String(item.id) === selected?.id);
  const sequence = currentTrack?.entries || [];
  const index = sequence.indexOf(current);
  const group = currentTrack?.group;

  const close = useCallback(() => {
    setSelected(null);
    if (onExit) { onExit(); return; }
    requestAnimationFrame(() => {
      const trigger = viewerOpened.current;
      if (trigger?.isConnected) trigger.focus();
      else moduleRoot.current?.focus();
    });
  }, [onExit]);

  const recordView = useCallback(id => {
    void call(`/api/estados/${id}/vista`, { method: 'POST' })
      .then(() => {
        feedRequest.current++;
        setItems(previous => previous.map(item => String(item.id) === String(id) ? { ...item, visto: 1 } : item));
      })
      .catch(error => {
        if ([401, 403, 404].includes(error.status)) void load();
      });
  }, [load]);

  useEffect(() => {
    if (selected && !current) close();
  }, [close, current, selected]);

  const contextKey = selected?.key;
  const previousId = sequence[index - 1]?.id;
  const nextId = sequence[index + 1]?.id;
  const previous = useCallback(() => {
    if (previousId != null) setSelected({ id: String(previousId), key: contextKey });
  }, [contextKey, previousId]);
  const next = useCallback(() => {
    if (nextId != null) setSelected({ id: String(nextId), key: contextKey });
    else close();
  }, [close, contextKey, nextId]);

  function open(status, track) {
    viewerOpened.current = document.activeElement;
    setSelected({ id: String(status.id), key: track.key });
  }

  function start(event) {
    if (compose) return;
    composerOpened.current = event.currentTarget;
    setNotice('');
    setSelected(null);
    setCompose(true);
    void loadGroups();
  }

  function finishComposition() {
    setCompose(false);
    requestAnimationFrame(() => composerOpened.current?.focus());
  }

  async function publish(body, idempotencyKey) {
    const result = await call('/api/estados', {
      method: 'POST', headers: { 'Idempotency-Key': idempotencyKey }, body,
    });
    if (!result.id) throw new Error('El servidor no confirmó la publicación. Puedes reintentar el mismo envío.');
    finishComposition();
    setNotice('Estado publicado.');
    void load();
  }

  async function respond(message) {
    await call(`/api/estados/${current.id}/responder`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mensaje: message, destino: group ? { tipo: 'grupo', grupo_id: group.id } : { tipo: 'personal' } }),
    });
    close();
    if (group) onOpenGroup?.({ tipo: 'grupo', grupo_id: Number(group.id), usuario_id: Number(group.id), nombre: group.nombre, grupo_nombre: group.nombre });
    else onOpenPrivate?.({ tipo: 'privado', usuario_id: Number(current.autor_id), usuario_nombre: nameOf(current), nombre: current.nombre, apellido: current.apellido, url_imagen: current.url_imagen });
  }

  async function react(reaccion) {
    const { reaccion_propia } = await call(`/api/estados/${current.id}/reaccion`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reaccion }),
    });
    feedRequest.current++;
    setItems(previousItems => previousItems.map(item => item.id === current.id ? { ...item, reaccion_propia } : item));
  }

  async function remove() {
    await call(`/api/estados/${current.id}`, { method: 'DELETE' });
    dismissed.current.add(String(current.id));
    setItems(previousItems => previousItems.filter(item => String(item.id) !== String(current.id)));
    close();
    void load();
  }

  const viewer = current && <EstadoVisor item={current} sequence={sequence} index={index} group={group}
        author={nameOf(current)} date={statusDate(current.creado_at)}
        own={String(current.autor_id) === String(usuario?.id)}
        onClose={close} onPrevious={previous} onNext={next} onViewed={recordView}
        onReply={respond} onReact={react} onDelete={remove} />;
  if (direct) return viewer;

  return <section ref={moduleRoot} tabIndex={-1} className={`qc-states ${compose ? 'is-composing' : ''}`} aria-label="Estados">
    <aside className="qc-states-list">
      <header className="qc-states-list-head">
        <span className="qc-states-tile"><i className="qc-states-mark" aria-hidden="true" /></span>
        <div><h1>Estados</h1><p>Comparte fotos, videos, GIFs y textos con tu equipo. Desaparecen después de 24 horas.</p></div>
        <button type="button" className="qc-states-refresh" title="Actualizar estados" aria-label="Actualizar estados" onClick={load}><RefreshCw size={16} /></button>
      </header>
      {canPost && <button type="button" className="qc-states-button is-primary qc-states-side-create" onClick={start} disabled={compose}><Plus size={20} /> Crear estado</button>}
      {(canPost || own) && <div className="qc-states-own">
        <button type="button" className="qc-states-own-main" disabled={compose} onClick={own ? () => open(own.latest, own) : start}>
          <span className="qc-states-ring" style={own && { background: ringPaint(own.entries, usuario?.id) }}><EstadoAvatar user={usuario} /></span>
          <span><strong>Mi estado</strong><small>{own ? `${own.entries.length} ${own.entries.length === 1 ? 'publicación activa' : 'publicaciones activas'}`
            : 'Toca para agregar un estado'}</small></span>
        </button>
        {canPost && <button className="qc-states-own-add" type="button" aria-label="Agregar a Mi estado" disabled={compose} onClick={start}><Plus size={18} /></button>}
      </div>}
      {loading && <p className="qc-states-note" role="status">Cargando estados…</p>}
      {feedError && <p className="qc-states-feedback is-error" role="alert">{feedError}</p>}
      <TrackList userId={usuario?.id} disabled={compose} title="Actualizaciones recientes" tracks={other.filter(track => track.unseen)} onOpen={open}
        empty={!loading && !feedError && !other.length ? 'No hay actualizaciones recientes.' : ''} />
      <TrackList userId={usuario?.id} disabled={compose} title="Visto" tracks={other.filter(track => !track.unseen)} onOpen={open} />
    </aside>
    <div className="qc-states-stage">
      {compose ? <EstadoCompositor user={usuario} groups={groups} groupsLoading={groupsLoading} groupsError={groupsError}
        canPost={canPost} onReloadGroups={loadGroups} onPublish={publish} onCancel={finishComposition} />
      : !current && <div className="qc-states-placeholder">
        <StatusArt />
        <h2>Comparte estados</h2>
        <p>Fotos, videos, GIFs y textos para tu equipo.<br />Desaparecen en 24 horas.</p>
        {canPost && <button type="button" className="qc-states-button is-primary" onClick={start}><Send size={21} /> Crear estado</button>}
        {notice && <p className="qc-states-feedback" role="status">{notice}</p>}
      </div>}
      {!compose && viewer}
    </div>
  </section>;
}
