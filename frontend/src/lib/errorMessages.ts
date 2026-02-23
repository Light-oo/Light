import { ApiError } from "./apiClient";

const messages: Record<string, string> = {
  invalid_request: "Invalid request. Review the form fields.",
  unauthorized: "Session expired. Please sign in again.",
  forbidden: "You do not have permission for this action.",
  not_found: "Resource not found.",
  insufficient_tokens: "Not enough tokens.",
  listing_not_active: "Listing no longer available.",
  CANNOT_REVEAL_OWN_LISTING: "Esta parte es la que usted está tratando de vender.",
  listing_has_no_contact: "Listing has no contact available.",
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
