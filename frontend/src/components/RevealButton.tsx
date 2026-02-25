type RevealButtonProps = {
  loading?: boolean;
  whatsappUrl?: string;
  error?: string;
  onReveal: () => void;
};

export function RevealButton({ loading, whatsappUrl, error, onReveal }: RevealButtonProps) {
  return (
    <div className="stack">
      {whatsappUrl ? (
        <a
          href={whatsappUrl}
          target="_blank"
          rel="noreferrer"
          className="whatsapp-icon-link"
          title="Abrir WhatsApp"
          aria-label="Abrir WhatsApp"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            <path d="M12 3.5a8.5 8.5 0 0 0-7.29 12.88L3.5 20.5l4.25-1.18A8.5 8.5 0 1 0 12 3.5Z" />
            <path d="M9.3 8.8c.2-.4.4-.4.6-.4h.5c.2 0 .4 0 .5.3l.8 1.9c.1.2.1.4 0 .6l-.4.6c-.1.1-.1.3 0 .4.4.7 1 1.2 1.6 1.6.1.1.3.1.4 0l.6-.4c.2-.1.4-.1.6 0l1.9.8c.3.1.3.3.3.5v.5c0 .2 0 .4-.4.6-.4.2-1.4.3-3-.5-1-.5-2-1.4-2.7-2.1-.7-.7-1.6-1.7-2.1-2.7-.8-1.6-.7-2.6-.5-3Z" />
          </svg>
        </a>
      ) : (
        <button type="button" onClick={onReveal} disabled={Boolean(loading)}>
          {loading ? <GlobalLoader visible mode="inline" /> : "Revelar WhatsApp"}
        </button>
      )}

      {error ? <p className="error">{error}</p> : null}
    </div>
  );
}

import { GlobalLoader } from "./GlobalLoader";
