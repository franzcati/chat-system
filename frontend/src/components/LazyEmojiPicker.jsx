import data from "@emoji-mart/data";
import Picker from "@emoji-mart/react";

/*
 * Se carga dinámicamente desde ChatBox, Message y VerInfoGrupo.
 * Mantiene @emoji-mart/data fuera del chunk principal de ChatBox
 * hasta que el usuario abre realmente un selector de emojis.
 */
export default function LazyEmojiPicker(props) {
  return <Picker data={data} {...props} />;
}
