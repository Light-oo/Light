import { ApiError } from "./apiClient";

const messages: Record<string, string> = {
  invalid_request: "Solicitud invalida. Revise los campos del formulario.",
  unauthorized: "La sesion expiro. Inicie sesion nuevamente.",
  forbidden: "No tiene permisos para esta accion.",
  not_found: "No se encontro el recurso.",
  WHATSAPP_REQUIRED: "Registra tu numero de WhatsApp para continuar.",
  INVALID_WHATSAPP_NUMBER: "Numero de WhatsApp invalido. Debe estar en formato +503XXXXXXXX.",
  WHATSAPP_ALREADY_IN_USE: "Ese numero de WhatsApp ya esta en uso.",
  whatsapp_already_in_use: "Ese numero de WhatsApp ya esta en uso.",
  insufficient_tokens: "No tiene tokens suficientes.",
  RATE_LIMIT_EXCEEDED: "Demasiados intentos de revelado. Espere un momento.",
  listing_not_active: "La publicacion ya no esta disponible.",
  demand_not_active: "La busqueda ya no esta disponible.",
  CANNOT_REVEAL_OWN_LISTING: "Esta parte es la que usted esta tratando de vender.",
  OWN_DEMAND_REVEAL_BLOCKED: "Esta es su busqueda.",
  listing_has_no_contact: "Esta publicacion no tiene contacto disponible.",
  demand_has_no_contact: "Esta busqueda no tiene contacto disponible.",
  duplicate_listing: "Ya tiene una publicacion activa para esta misma firma.",
  OFFER_ALREADY_EXISTS: "Ya tiene una oferta activa para esta pieza. Edite su publicacion activa.",
  unexpected_error: "Ocurrio un error inesperado. Intente nuevamente."
};

export function toUiErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    const code =
      typeof error.payload?.error === "string"
        ? error.payload.error
        : typeof error.payload?.error?.code === "string"
          ? error.payload.error.code
          : "";
    if (code && messages[code]) {
      return messages[code];
    }
    if (typeof error.payload?.error === "object") {
      const backendMessage = String(error.payload.error?.message ?? "").trim();
      if (backendMessage.length > 0) {
        return backendMessage;
      }
    }
    if (error.status === 401) {
      return messages.unauthorized;
    }
    return messages.unexpected_error;
  }

  if (error instanceof Error && error.message) {
    if (messages[error.message]) {
      return messages[error.message];
    }
  }

  return messages.unexpected_error;
}
