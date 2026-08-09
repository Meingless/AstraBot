import astraLogoSmall from "../assets/astra-logo-96.webp";

export function Brand() {
  return (
    <div className="brand">
      <img className="brand-logo" src={astraLogoSmall} alt="Astra Discord Bot" />
      <span>ASTRA</span>
      <i>BOT</i>
    </div>
  );
}

