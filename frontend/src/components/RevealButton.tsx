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
          className="reveal-open-whatsapp"
          title="Abrir WhatsApp"
          aria-label="Abrir WhatsApp"
        >
          Abrir WhatsApp
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
