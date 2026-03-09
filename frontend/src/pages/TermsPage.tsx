import { useNavigate } from "react-router-dom";

export function TermsPage() {
  const navigate = useNavigate();

  return (
    <div className="terms-page">
      <main className="terms-container">
        <h1>Términos y Condiciones de Uso</h1>
        <p className="terms-brand">Qu-e.ai</p>
        <p className="terms-updated">Última actualización: 2026</p>

        <section className="terms-section">
          <h2>1. Naturaleza del servicio</h2>
          <p>
            Qu-e.ai es una plataforma digital que conecta personas que buscan productos o servicios con personas que
            ofrecen dichos productos o servicios.
          </p>
          <p>
            Qu-e.ai no vende productos ni presta servicios directamente. La plataforma únicamente facilita el
            intercambio de información entre usuarios.
          </p>
          <p>
            Cualquier negociación, acuerdo o transacción ocurre directamente entre los usuarios y fuera del control de
            la plataforma.
          </p>
        </section>

        <section className="terms-section">
          <h2>2. Cuentas de usuario</h2>
          <p>Para utilizar ciertas funciones de Qu-e.ai es necesario crear una cuenta.</p>
          <p>Al registrarse, el usuario acepta:</p>
          <ul>
            <li>Proporcionar información veraz.</li>
            <li>Mantener actualizado su número de contacto.</li>
            <li>No utilizar la plataforma con fines fraudulentos, ilegales o engañosos.</li>
          </ul>
          <p>
            Qu-e.ai se reserva el derecho de suspender o eliminar cuentas que violen estos términos o que representen
            un riesgo para la comunidad.
          </p>
        </section>

        <section className="terms-section">
          <h2>3. Publicaciones y búsquedas</h2>
          <p>Los usuarios pueden utilizar Qu-e.ai para:</p>
          <ul>
            <li>Publicar productos o servicios que desean ofrecer.</li>
            <li>Crear búsquedas para encontrar productos o servicios que necesitan.</li>
          </ul>
          <p>Cada usuario es responsable del contenido que publica.</p>
          <p>No está permitido publicar:</p>
          <ul>
            <li>Información falsa o engañosa</li>
            <li>Productos o servicios ilegales</li>
            <li>Contenido fraudulento</li>
            <li>Información que viole leyes aplicables</li>
          </ul>
          <p>Qu-e.ai se reserva el derecho de editar o eliminar publicaciones que incumplan estas normas.</p>
        </section>

        <section className="terms-section">
          <h2>4. Acceso a información de contacto</h2>
          <p>
            Algunas funciones de la plataforma permiten revelar la información de contacto de otros usuarios.
          </p>
          <p>
            El acceso a esta información puede requerir el uso de tokens o créditos dentro de la plataforma.
          </p>
          <p>
            Una vez revelada la información de contacto, la comunicación ocurre directamente entre los usuarios fuera
            de Qu-e.ai.
          </p>
          <p>
            Qu-e.ai no participa ni supervisa las conversaciones, negociaciones o acuerdos posteriores.
          </p>
        </section>

        <section className="terms-section">
          <h2>5. Responsabilidad</h2>
          <p>Qu-e.ai no garantiza:</p>
          <ul>
            <li>La calidad de los productos o servicios ofrecidos</li>
            <li>La disponibilidad de los productos o servicios publicados</li>
            <li>La veracidad de todas las publicaciones realizadas por usuarios</li>
          </ul>
          <p>Los usuarios utilizan la plataforma bajo su propia responsabilidad.</p>
          <p>Qu-e.ai no será responsable por:</p>
          <ul>
            <li>Acuerdos realizados entre usuarios</li>
            <li>Disputas comerciales</li>
            <li>Pérdidas económicas derivadas de transacciones entre usuarios</li>
            <li>Daños causados por productos o servicios obtenidos a través de la plataforma</li>
          </ul>
        </section>

        <section className="terms-section">
          <h2>6. Uso adecuado de la plataforma</h2>
          <p>Los usuarios se comprometen a no:</p>
          <ul>
            <li>Abusar del sistema de publicaciones o búsquedas</li>
            <li>Intentar obtener información de contacto de manera indebida</li>
            <li>Automatizar o manipular el uso de la plataforma</li>
            <li>Utilizar Qu-e.ai para actividades ilegales</li>
          </ul>
          <p>Qu-e.ai podrá limitar, suspender o cancelar cuentas que hagan uso indebido del servicio.</p>
        </section>

        <section className="terms-section">
          <h2>7. Cambios en la plataforma</h2>
          <p>Qu-e.ai puede modificar o actualizar en cualquier momento:</p>
          <ul>
            <li>Funcionalidades del servicio</li>
            <li>Reglas de uso</li>
            <li>Precios o costos relacionados con tokens o créditos</li>
          </ul>
          <p>
            Estos cambios pueden realizarse para mejorar la plataforma o adaptarse a nuevas necesidades del servicio.
          </p>
        </section>

        <section className="terms-section">
          <h2>8. Modificaciones de estos términos</h2>
          <p>Qu-e.ai puede actualizar estos Términos y Condiciones cuando sea necesario.</p>
          <p>
            Las versiones actualizadas se publicarán en el sitio web y entrarán en vigor desde su publicación.
          </p>
        </section>

        <section className="terms-section">
          <h2>9. Contacto</h2>
          <p>
            Para consultas relacionadas con la plataforma o estos términos, los usuarios pueden comunicarse a través
            de los canales de contacto disponibles dentro del sitio.
          </p>
        </section>

        <button type="button" className="terms-back" onClick={() => navigate("/")}>
          Volver
        </button>
      </main>
    </div>
  );
}

