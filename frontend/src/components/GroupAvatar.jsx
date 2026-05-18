import React from "react";
import { getAvatarUrl } from "../utils/url";

const GroupAvatar = ({
  group = {},
  size = 44,
  editable = false,
  canEdit = false,
  onEditImage,
  className = "",
}) => {
  const groupImage = group?.imagen_url;
  const groupName = group?.usuario_nombre || group?.nombre || "Grupo";

  const avatarContent = groupImage ? (
    <img
      src={getAvatarUrl(groupImage)}
      alt={groupName}
      className="wa-group-avatar-main-img"
    />
  ) : (
    <div className="wa-group-avatar-default" aria-hidden="true">
      <i className="fa-solid fa-user-group" />
    </div>
  );

  const avatar = (
    <div
      className={`wa-group-avatar-composite ${className} ${editable && canEdit ? "is-editable" : ""}`}
      style={{
        width: size,
        height: size,
        minWidth: size,
        "--group-avatar-icon-size": `${Math.max(18, Math.round(size * 0.48))}px`,
      }}
      title={groupName}
    >
      {avatarContent}
      {editable && canEdit && (
        <div className="wa-group-avatar-edit-overlay">
          <i className="fa-solid fa-camera" aria-hidden="true" />
          {size >= 84 && <span>{groupImage ? "Cambiar imagen del grupo" : "Añadir imagen del grupo"}</span>}
        </div>
      )}
    </div>
  );

  if (editable && canEdit) {
    return (
      <button
        type="button"
        className="wa-group-avatar-upload-btn"
        onClick={onEditImage}
        title={groupImage ? "Cambiar imagen del grupo" : "Añadir imagen del grupo"}
      >
        {avatar}
      </button>
    );
  }

  return avatar;
};

export default GroupAvatar;
