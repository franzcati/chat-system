import "../css/UsersManagement.css";

export default function AdminBackground() {
  return <div className="qc-users-bg-decor" aria-hidden="true">
        <span className="qc-users-orb qc-users-orb-one" />
        <span className="qc-users-orb qc-users-orb-two" />
        <span className="qc-users-chat-line qc-users-chat-line-one" />
        <span className="qc-users-chat-line qc-users-chat-line-two" />
        <i className="bi bi-chat-dots qc-users-floating-icon qc-users-floating-icon-one" />
        <i className="bi bi-chat-left-text qc-users-floating-icon qc-users-floating-icon-two" />
      </div>;
}
