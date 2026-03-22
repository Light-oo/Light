const SUPPORT_WHATSAPP_E164 = "50376283646";

type SupportWhatsappButtonProps = {
  label?: string;
  className?: string;
};

export function SupportWhatsappButton({
  label = "Abrir WhatsApp",
  className = "reveal-open-whatsapp"
}: SupportWhatsappButtonProps) {
  const href = `https://wa.me/${SUPPORT_WHATSAPP_E164}?text=${encodeURIComponent("Hola")}`;

  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={className}
      title={label}
      aria-label={label}
    >
      {label}
    </a>
  );
}
