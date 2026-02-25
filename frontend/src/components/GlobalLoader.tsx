import logoLoader from "../assets/logo-loader.svg";

type GlobalLoaderProps = {
  visible: boolean;
  mode?: "overlay" | "inline";
};

export function GlobalLoader({ visible, mode = "overlay" }: GlobalLoaderProps) {
  if (!visible) {
    return null;
  }

  if (mode === "inline") {
    return (
      <span className="loader-inline" aria-hidden="true">
        <img src={logoLoader} alt="" className="loader-logo loader-logo-inline" />
      </span>
    );
  }

  return (
    <div className="loader-overlay" aria-label="Loading" role="status">
      <img src={logoLoader} alt="" className="loader-logo loader-logo-overlay" />
    </div>
  );
}
