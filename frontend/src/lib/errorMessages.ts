import { ApiError } from "./apiClient";

const messages: Record<string, string> = {
  invalid_request: "Invalid request. Review the form fields.",
  unauthorized: "Session expired. Please sign in again.",
  forbidden: "You do not have permission for this action.",
  not_found: "Resource not found.",
  WHATSAPP_REQUIRED: "Registra tu numero de WhatsApp para continuar.",
  INVALID_WHATSAPP_NUMBER: "Numero de WhatsApp invalido. Debe estar en formato +503XXXXXXXX.",
  WHATSAPP_ALREADY_IN_USE: "Ese numero de WhatsApp ya esta en uso.",
  whatsapp_already_in_use: "Ese numero de WhatsApp ya esta en uso.",
  insufficient_tokens: "Not enough tokens.",
  RATE_LIMIT_EXCEEDED: "Too many reveal attempts. Please wait a moment.",
  listing_not_active: "Listing no longer available.",
  demand_not_active: "Demand no longer available.",
  CANNOT_REVEAL_OWN_LISTING: "Esta parte es la que usted esta tratando de vender.",
  OWN_DEMAND_REVEAL_BLOCKED: "This is your demand.",
  listing_has_no_contact: "Listing has no contact available.",
  demand_has_no_contact: "Demand has no contact available.",
  duplicate_listing: "You already have an active listing for this same signature.",
  OFFER_ALREADY_EXISTS: "You already have an active offer for this item. Please edit your active listing.",
  unexpected_error: "Unexpected error. Please try again."
};

export function toUiErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    const code = String(error.payload?.error ?? "");
    if (code && messages[code]) {
      return messages[code];
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
