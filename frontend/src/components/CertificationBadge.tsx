import { useState } from "react";
import logoLoader from "../assets/logo-loader.svg";

type CertificationBadgeProps = {
  label?: string;
  inline?: boolean;
};

export function CertificationBadge({ label = "Certified", inline = false }: CertificationBadgeProps) {
  const [visible, setVisible] = useState(false);

  return (
    <button
      type="button"
      className={inline ? "certification-badge certification-badge-inline" : "certification-badge"}
      aria-label={label}
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
      onFocus={() => setVisible(true)}
      onBlur={() => setVisible(false)}
      onClick={() => setVisible((current) => !current)}
    >
      <img src={logoLoader} alt="" className="header-token-coin-logo certification-badge-icon" />
      {visible ? <span className="certification-tooltip">{label}</span> : null}
    </button>
  );
}
