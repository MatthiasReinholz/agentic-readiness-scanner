import type { Check } from '../types.js';
import {
  californiaOptOutLinks,
  globalPrivacyControl,
  libroDeReclamaciones,
  noOutdatedOdrLink,
  noTrackingBeforeConsent,
  privacyContact,
  privacyNoticeLinked,
  registrationNumbers,
  sellerIdentity,
} from './identity-privacy.js';
import {
  aiChatAssistant,
  aiImageMarking,
  genericGreenClaims,
  manufacturerInformation,
  priorLowestPrice,
  reviewVerification,
  swissPriceDisplay,
  tdmReservation,
} from './products-ai.js';
import {
  accessibilityOverlay,
  accessibilityStatement,
  argentinaButtons,
  euWithdrawalFunction,
  staticAccessibilityBasics,
  statutoryReturnPeriod,
  subscriptionCancellation,
} from './withdrawal-accessibility.js';

/** Every legal-signals check, in catalog order. */
export const legalChecks: readonly Check[] = [
  sellerIdentity,
  registrationNumbers,
  libroDeReclamaciones,
  noOutdatedOdrLink,
  privacyNoticeLinked,
  privacyContact,
  californiaOptOutLinks,
  globalPrivacyControl,
  noTrackingBeforeConsent,
  euWithdrawalFunction,
  argentinaButtons,
  statutoryReturnPeriod,
  subscriptionCancellation,
  accessibilityStatement,
  staticAccessibilityBasics,
  accessibilityOverlay,
  manufacturerInformation,
  priorLowestPrice,
  reviewVerification,
  genericGreenClaims,
  swissPriceDisplay,
  aiChatAssistant,
  tdmReservation,
  aiImageMarking,
];
