// Mirrors this Supabase project's actual Auth password policy (Authentication
// -> Providers -> Email -> "Minimum password length" / "Password requirements"),
// so signup fails client side with a specific reason instead of a generic
// server error after submit.
const MIN_PASSWORD_LENGTH = 8;

export interface PasswordCheck {
  valid: boolean;
  missing: string[];
}

export interface PasswordRequirement {
  label: string;
  met: boolean;
}

// The same rules as checkPasswordRequirements, as a checklist the signup
// screen ticks off one by one as the user types.
export function passwordRequirementList(password: string): PasswordRequirement[] {
  return [
    {
      label: `At least ${MIN_PASSWORD_LENGTH} characters`,
      met: password.length >= MIN_PASSWORD_LENGTH,
    },
    { label: "At least 1 uppercase letter", met: /[A-Z]/.test(password) },
    { label: "At least 1 lowercase letter", met: /[a-z]/.test(password) },
    { label: "At least 1 number", met: /[0-9]/.test(password) },
    { label: "At least 1 symbol", met: /[^a-zA-Z0-9]/.test(password) },
  ];
}

export function checkPasswordRequirements(password: string): PasswordCheck {
  const missing: string[] = [];
  if (password.length < MIN_PASSWORD_LENGTH)
    missing.push(`at least ${MIN_PASSWORD_LENGTH} characters`);
  if (!/[a-z]/.test(password)) missing.push("a lowercase letter");
  if (!/[A-Z]/.test(password)) missing.push("an uppercase letter");
  if (!/[0-9]/.test(password)) missing.push("a number");
  if (!/[^a-zA-Z0-9]/.test(password)) missing.push("a symbol");
  return { valid: missing.length === 0, missing };
}
