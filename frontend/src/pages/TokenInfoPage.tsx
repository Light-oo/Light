import { Card } from "../components/Card";

export function TokenInfoPage() {
  return (
    <div className="screen stack gap-lg">
      <Card className="stack gap-md">
        <h3 className="section-title">Qué son los tokens</h3>
        <p>Qu-e.ai utiliza Tokens.</p>
        <p>Cada Token tiene un valor monetario.</p>
        <p>Un (1) Token se utiliza para revelar el número de WhatsApp de la persona con quien usted desea hablar.</p>
        <p>Si un usuario tiene cero (0) Tokens, aún puede:</p>
        <ul className="tokens-info-list">
          <li>buscar piezas</li>
          <li>publicar piezas</li>
        </ul>
        <p>Sin embargo, no podrá revelar información de contacto hasta que tenga Tokens disponibles.</p>
      </Card>

      <Card className="stack gap-md">
        <h3 className="section-title">Tokens iniciales</h3>
        <p>Todas las cuentas comienzan con 25 tokens de gratitud.</p>
      </Card>

      <Card className="stack gap-md">
        <h3 className="section-title">Cómo se agregan tokens</h3>
        <p>Los tokens se agregan a la cuenta manualmente después de recibir el pago.</p>
        <p>Después de confirmar el pago, los tokens normalmente se agregan dentro de dos horas durante horario laboral.</p>
        <p>Horario laboral:</p>
        <ul className="tokens-info-list">
          <li>Lunes a viernes</li>
          <li>8:00 AM to 6:00 PM</li>
        </ul>
        <p>Si el pago se recibe fuera de horario laboral, los tokens se agregarán:</p>
        <ul className="tokens-info-list">
          <li>el mismo día si es posible, o</li>
          <li>a más tardar antes de las 10:00 AM del siguiente día laboral.</li>
        </ul>
      </Card>

      <Card className="stack gap-md">
        <h3 className="section-title">Reglas importantes</h3>
        <ul className="tokens-info-list">
          <li>Los tokens no expiran.</li>
          <li>Los tokens solo sirven para revelar contactos dentro de la aplicación.</li>
          <li>No hay reembolsos de ningún tipo.</li>
        </ul>
      </Card>
    </div>
  );
}
