import { useState } from "react";
import logoLoader from "../assets/logo-loader.svg";

type CertificationBadgeProps = {
  label?: string;
};

export function CertificationBadge({ label = "Certified" }: CertificationBadgeProps) {
  const [visible, setVisible] = useState(false);

  return (
    <button
      type="button"
      className="certification-badge"
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
