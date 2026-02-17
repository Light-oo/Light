type RevealButtonProps = {
  loading?: boolean;
  whatsappUrl?: string;
  didConsume?: boolean;
  error?: string;
  onReveal: () => void;
};

export function RevealButton({ loading, whatsappUrl, didConsume, error, onReveal }: RevealButtonProps) {
  return (
    <div className="stack">
      {whatsappUrl ? (
        <>
          <a href={whatsappUrl} target="_blank" rel="noreferrer">
            Open WhatsApp
          </a>
          <small>didConsume: {String(didConsume)}</small>
        </>
      ) : (
        <button type="button" onClick={onReveal} disabled={Boolean(loading)}>
          {loading ? "Revealing..." : "Reveal"}
        </button>
      )}

      {error ? <p className="error">{error}</p> : null}
    </div>
  );
}

