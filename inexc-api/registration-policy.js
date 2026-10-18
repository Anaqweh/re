// Owner-approved exception to duplicate registration checks only.
// Card authentication, eligibility, balance, prices and payment retries remain enforced.
export function allowsRepeatRegistration(value) {
  return typeof value === 'string' && value.trim().toLowerCase() === 'ahmadanakwa@gmail.com';
}
