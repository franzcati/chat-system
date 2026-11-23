import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, X, ArrowLeft, ArrowRight, Send, Trash2, Image, RefreshCw } from 'feather-icons-react';
import { getAvatarUrl } from '../utils/url';
import '../css/Estados.css';

const colors=['#1d3e70','#5634aa','#157e7a','#bc5268','#7a5536','#27364c'];
const call=async(url,options={})=>{
  const response=await fetch(url,{credentials:'include',cache:'no-store',...options});
  const body=await response.json().catch(()=>({}));
  if(!response.ok) throw new Error(body.error || 'No se pudo completar la operación');
  return body;
};
const stamp=value=>new Intl.DateTimeFormat('es-PE',{hour:'2-digit',minute:'2-digit'}).format(new Date(`${String(value).replace(' ','T').replace(/Z$/,'')}Z`));
const fullName=s=>`${s.nombre || ''} ${s.apellido || ''}`.trim() || 'Usuario';

export default function Estados({usuario,onOpenGroup,onOpenPrivate}) {
  const [items,setItems]=useState([]);
  const [groups,setGroups]=useState([]);
  const [canPost,setCanPost]=useState(false);
  const [selected,setSelected]=useState(null);
  const [compose,setCompose]=useState(false);
  const [text,setText]=useState('');
  const [file,setFile]=useState(null);
  const [color,setColor]=useState(colors[0]);
  const [groupId,setGroupId]=useState('');
  const [reply,setReply]=useState('');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [progress,setProgress]=useState(0);
  const load=useCallback(async()=>{
    try {
      const [data,available]=await Promise.all([call('/api/estados'),call('/api/estados/grupos')]);
      setItems(data.estados);setGroups(available.grupos);setCanPost(data.puede_publicar);
    } catch(e){setError(e.message);}
  },[]);
  useEffect(()=>{void load();const timer=setInterval(load,20000);return()=>clearInterval(timer);},[load]);
  const tracks=useMemo(()=>{
    const map=new Map();
    for(const status of items){
      const key=status.grupo_id ? `g:${status.grupo_id}`:`u:${status.autor_id}`;
      if(!map.has(key)) map.set(key,[]);
      map.get(key).push(status);
    }
    return [...map].map(([key,entries])=>({key,entries:entries.reverse(),latest:entries.at(-1),unseen:entries.some(x=>!x.visto)}));
  },[items]);
  const current=items.find(x=>Number(x.id)===Number(selected?.id));
  const sequence=current ? tracks.find(t=>t.key===(current.grupo_id?`g:${current.grupo_id}`:`u:${current.autor_id}`))?.entries || []:[];
  const index=sequence.findIndex(x=>Number(x.id)===Number(current?.id));
  const open=status=>{
    setSelected({id:status.id});setProgress(0);setReply('');setError('');
    void call(`/api/estados/${status.id}/vista`,{method:'POST'}).then(()=>setItems(prev=>prev.map(x=>x.id===status.id?{...x,visto:1}:x))).catch(()=>{});
  };
  const next=()=>index+1<sequence.length?open(sequence[index+1]):setSelected(null);
  const previous=()=>index>0?open(sequence[index-1]):setSelected(null);
  useEffect(()=>{
    if(!current || current.tipo==='video')return;
    const started=Date.now();
    const timer=setInterval(()=>{const value=Math.min(100,(Date.now()-started)/60);
      setProgress(value);if(value>=100) {clearInterval(timer);if(index+1<sequence.length)open(sequence[index+1]);else setSelected(null);}
    },100);return()=>clearInterval(timer);
  },[current?.id]);
  const publish=async e=>{
    e.preventDefault();setBusy(true);setError('');
    try{
      const body=new FormData();body.append('texto',text);body.append('fondo',color);
      if(groupId)body.append('grupo_id',groupId);
      if(file)body.append('archivo',file);
      await call('/api/estados',{method:'POST',body});
      setCompose(false);setText('');setFile(null);setGroupId('');await load();
    }catch(e){setError(e.message);}finally{setBusy(false);}
  };
  const respond=async e=>{
    e.preventDefault();if(!current || !reply.trim())return;
    setBusy(true);setError('');
    try{
      if(current.grupo_id) {
        await call(`/api/estados/${current.id}/responder`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mensaje:reply})});
        onOpenGroup?.({tipo:'grupo',grupo_id:Number(current.grupo_id),usuario_id:Number(current.grupo_id),nombre:current.grupo_nombre,grupo_nombre:current.grupo_nombre});
      } else {
        await call('/api/mensajes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({senderId:usuario.id,receiverId:current.autor_id,message:`↪ Estado #${current.id}${current.texto?` · ${current.texto.slice(0,80)}`:''}\n${reply}`})});
        onOpenPrivate?.({tipo:'privado',usuario_id:Number(current.autor_id),usuario_nombre:fullName(current),nombre:current.nombre,apellido:current.apellido,url_imagen:current.url_imagen});
      }
      setReply('');setSelected(null);
    }catch(e){setError(e.message);}finally{setBusy(false);}
  };
  const remove=async()=>{
    if(!window.confirm('¿Eliminar este estado?'))return;
    setBusy(true);
    try{await call(`/api/estados/${current.id}`,{method:'DELETE'});setSelected(null);await load();}
    catch(e){setError(e.message);}finally{setBusy(false);}
  };
  return <section className="qc-states">
    <aside className="qc-states-list">
      <header><div><span className="qc-states-eyebrow">ACTUALIZACIONES</span><h1>Estados</h1><p>Momentos que desaparecen después de 24 horas</p></div><button title="Actualizar" onClick={load}><RefreshCw size={18}/></button></header>
      {canPost&&<button className="qc-states-create" onClick={()=>{setCompose(true);setError('');}}><span><Plus size={23}/></span><div><strong>Mi estado</strong><small>Comparte un momento con tu equipo</small></div></button>}
      <h2>Estados recientes</h2>
      {tracks.length===0&&<p className="qc-states-empty">No hay estados disponibles. Los nuevos aparecerán aquí.</p>}
      {tracks.map(t=><button key={t.key} className="qc-states-person" onClick={()=>open(t.entries.find(x=>!x.visto)||t.entries[0])}>
        <span className={`qc-states-ring ${t.unseen?'is-unseen':''}`}>{t.latest.grupo_id?<span className="qc-states-group-icon">♟</span>:t.latest.url_imagen?<img src={getAvatarUrl(t.latest.url_imagen)} alt=""/>:<b>{fullName(t.latest)[0]}</b>}</span>
        <span><strong>{t.latest.grupo_id?t.latest.grupo_nombre:Number(t.latest.autor_id)===Number(usuario?.id)?'Mis estados':fullName(t.latest)}</strong><small>{t.latest.grupo_id?`Grupo · ${fullName(t.latest)} · `:''}{stamp(t.latest.creado_at)} · {t.entries.length} estado(s)</small></span>
      </button>)}
    </aside>
    <div className="qc-states-stage">
      {!current&&<div className="qc-states-placeholder"><span>◎</span><h2>Comparte estados</h2><p>Fotos, videos y textos para tu equipo. Desaparecen a las 24 horas.</p></div>}
      {current&&<div className="qc-states-viewer" key={current.id}>
        <div className="qc-states-bars">{sequence.map((x,i)=><span key={x.id}><i style={{width:i<index?'100%':i===index?`${progress}%`:'0%'}}/></span>)}</div>
        <div className="qc-states-view-head"><button onClick={()=>setSelected(null)} aria-label="Cerrar"><X/></button><strong>{current.grupo_id?current.grupo_nombre:fullName(current)}</strong><small>{stamp(current.creado_at)}</small>{Number(current.autor_id)===Number(usuario?.id)&&<button onClick={remove} title="Eliminar" disabled={busy}><Trash2 size={18}/></button>}</div>
        <button className="qc-states-nav prev" onClick={previous} aria-label="Anterior"><ArrowLeft/></button>
        <div className="qc-states-content" style={{background:current.fondo||colors[0]}}>
          {current.tipo==='imagen'&&<img src={`/api/estados/${current.id}/media`} alt={current.texto||'Estado'}/>}
          {current.tipo==='video'&&<video src={`/api/estados/${current.id}/media`} controls autoPlay playsInline onTimeUpdate={e=>setProgress(e.target.duration?100*e.target.currentTime/e.target.duration:0)} onEnded={next}/>}
          {current.texto&&<p className={current.tipo==='texto'?'is-text':''}>{current.texto}</p>}
        </div>
        <button className="qc-states-nav next" onClick={next} aria-label="Siguiente"><ArrowRight/></button>
        <footer>{Number(current.autor_id)===Number(usuario?.id)?<span>{current.vistas} visualizaciones</span>:<form onSubmit={respond}><input value={reply} onChange={e=>setReply(e.target.value)} maxLength={2000} placeholder={current.grupo_id?'Responder en el chat grupal…':'Responder en privado…'}/><button disabled={!reply.trim()||busy} aria-label="Enviar respuesta"><Send size={18}/></button></form>}</footer>
      </div>}
      {error&&<div role="alert" className="qc-states-error">{error}</div>}
    </div>
    {compose&&<div className="qc-states-overlay"><form className="qc-states-composer" onSubmit={publish}>
      <header><div><span className="qc-states-eyebrow">NUEVA ACTUALIZACIÓN</span><h2>Crear estado</h2></div><button type="button" onClick={()=>setCompose(false)} aria-label="Cerrar"><X/></button></header>
      <label>Compartir en<select value={groupId} onChange={e=>setGroupId(e.target.value)}><option value="">Mi estado · equipo de esta instancia</option>{groups.map(g=><option value={g.id} key={g.id}>Grupo · {g.nombre}</option>)}</select></label>
      <div className="qc-states-preview" style={{background:color}}>{file?<><Image size={25}/><strong>{file.name}</strong><small>{file.type.startsWith('video/')?'Video':'Imagen'} seleccionado</small></>:text||'Escribe algo para compartir...'}</div>
      <label>Mensaje<textarea value={text} maxLength={700} onChange={e=>setText(e.target.value)} placeholder="¿Qué deseas compartir?"/></label>
      <div className="qc-states-compose-row"><div className="qc-states-colors">{colors.map(c=><button type="button" key={c} onClick={()=>setColor(c)} style={{background:c}} aria-label={`Fondo ${c}`} aria-pressed={c===color}/>)}</div><label className="qc-states-file"><Image size={16}/> Foto o video<input type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/webm" onChange={e=>setFile(e.target.files?.[0]||null)}/></label></div>
      <small>Fotos y videos hasta 30 MB. En grupos solo publican propietario y administradores.</small>
      {error&&<p role="alert" className="qc-states-error">{error}</p>}
      <button className="qc-states-submit" disabled={busy||(!text.trim()&&!file)}>{busy?'Publicando…':'Publicar estado'}</button>
    </form></div>}
  </section>;
}
