import React, { useEffect, useRef } from "react";
import data from "@emoji-mart/data";
import Picker from "@emoji-mart/react";

/*
 * Emoji Mart vive dentro de un Shadow DOM. Las reglas de ChatBox.css no
 * alcanzan a su panel interior: si #root no tiene una altura limitada, la
 * lista no puede desplazarse y la navegación por categorías deja de funcionar.
 * Esta corrección sólo se activa en el selector de ChatBox.
 */
export default function LazyEmojiPicker({ fixChatScroll = false, ...props }) {
  const hostRef = useRef(null);

  useEffect(() => {
    if (!fixChatScroll || !hostRef.current) return undefined;
    const container = hostRef.current;
    let frameId = 0;
    let frameCount = 0;

    const ensureHeight = () => {
      const host = container.querySelector("em-emoji-picker");
      const shadow = host?.shadowRoot;
      const root = shadow?.querySelector("#root");
      const scroll = shadow?.querySelector(".scroll");
      if (!root || !scroll) {
        // Emoji Mart carga sus datos de forma diferida.
        if (frameCount++ < 90) frameId = requestAnimationFrame(ensureHeight);
        return;
      }
      root.style.height = "100%";
      root.style.minHeight = "0";
      root.style.maxHeight = "100%";
      scroll.style.flex = "1 1 auto";
      scroll.style.minHeight = "0";
      scroll.style.overflowY = "auto";
      scroll.style.overscrollBehaviorY = "contain";
      scroll.style.touchAction = "pan-y";
    };
    frameId = requestAnimationFrame(ensureHeight);
    return () => cancelAnimationFrame(frameId);
  }, [fixChatScroll]);

  if (!fixChatScroll) return <Picker data={data} {...props} />;

  return (
    <div ref={hostRef} className="wa-emoji-mart-scroll-host">
      <Picker data={data} {...props} />
    </div>
  );
}
