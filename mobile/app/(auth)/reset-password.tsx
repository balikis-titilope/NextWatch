import { Link, Redirect, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AuthSplit } from "../../components/auth/AuthSplit";
import { PrimaryButton } from "../../components/PrimaryButton";
import { TextField } from "../../components/TextField";
import { useRequestPasswordReset, useResetPassword } from "../../hooks/useAuth";
import { ApiError, apiErrorCode, apiErrorMessage } from "../../lib/api";

// Value sourcing (spec 0007, same fixed client side policy as spec 0004's
// confirm-email screen): Supabase enforces its own rate limit server side too.
const RESEND_COOLDOWN_SECONDS = 30;
const MIN_PASSWORD_LENGTH = 8;

export default function ResetPassword() {
  const { email } = useLocalSearchParams<{ email?: string }>();
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  // A code was already sent by the Request Reset screen right before this
  // screen was reached -- start the cooldown as if that send just
  // happened, rather than letting an immediate second send undercut it.
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN_SECONDS);
  const reset = useResetPassword();
  const resend = useRequestPasswordReset();

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => setCooldown((current) => Math.max(0, current - 1)), 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  // AC-11: this route is only ever reached carrying the email from a live
  // request-reset attempt, never bookmarked or deep linked to directly.
  if (!email) {
    return <Redirect href="/(auth)/login" />;
  }

  const passwordTooShort = newPassword.length > 0 && newPassword.length < MIN_PASSWORD_LENGTH;
  const passwordsMismatched = confirmPassword.length > 0 && confirmPassword !== newPassword;
  // AC-4/AC-5: both checked client side before any network call.
  const canSubmit =
    code.length === 6 &&
    newPassword.length >= MIN_PASSWORD_LENGTH &&
    newPassword === confirmPassword;

  const handleConfirm = () => {
    reset.mutate({ email, token: code, new_password: newPassword });
  };

  const handleResend = () => {
    resend.mutate({ email });
    setCooldown(RESEND_COOLDOWN_SECONDS);
  };

  const canResend = cooldown === 0 && !resend.isPending;

  // AC-7/AC-13: wrong code, expired code, and an unchanged password each
  // get a distinguishing inline error, mirroring confirm-email's
  // otp_invalid/otp_expired split (spec 0004) extended with same_password.
  const resetErrorCode = apiErrorCode(reset.error);
  const resetErrorMessage = reset.isError
    ? resetErrorCode === "otp_expired"
      ? "That code has expired. Request a new one."
      : resetErrorCode === "same_password"
        ? "Choose a different password."
        : reset.error instanceof ApiError && reset.error.status === 429
          ? "Too many requests. Wait a bit before trying again."
          : reset.error instanceof ApiError && reset.error.status === 503
            ? "Something went wrong. Try again."
            : "That code isn't right. Check it and try again."
    : null;

  // AC-9/AC-10: the resend action's own 404/429/503 branch on HTTP status,
  // same as the Request Reset screen.
  const resendErrorMessage = resend.isError
    ? resend.error instanceof ApiError && resend.error.status === 429
      ? "Too many requests. Wait a bit before trying again."
      : apiErrorMessage(resend.error, "Couldn't send a new code. Try again.")
    : null;

  return (
    <SafeAreaView className="flex-1 bg-bg-primary">
      <AuthSplit variant="reset">
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          className="flex-1"
        >
          <View className="flex-1 justify-center px-6 web:w-full web:max-w-[420px] web:self-center">
            <Text className="text-center font-display-lg text-display-lg text-text-primary">
              Enter Your Code
            </Text>
            <Text className="mt-2 text-center font-body-md text-body-md text-text-secondary">
              Enter the 6-digit code we sent to {email}, then choose a new password.
            </Text>

            <View className="mt-8 gap-3">
              <TextField
                leadingIcon="key-outline"
                placeholder="6-digit code"
                value={code}
                onChangeText={setCode}
                keyboardType="number-pad"
                maxLength={6}
                accessibilityLabel="Reset code"
              />
              <TextField
                leadingIcon="lock-closed-outline"
                placeholder="New Password"
                value={newPassword}
                onChangeText={setNewPassword}
                secureTextEntry
                accessibilityLabel="New Password"
              />
              <TextField
                leadingIcon="lock-closed-outline"
                placeholder="Confirm New Password"
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                secureTextEntry
                accessibilityLabel="Confirm New Password"
              />
            </View>

            {passwordTooShort ? (
              <Text className="mt-2 font-body-sm text-body-sm text-error">
                Must be at least {MIN_PASSWORD_LENGTH} characters.
              </Text>
            ) : passwordsMismatched ? (
              <Text className="mt-2 font-body-sm text-body-sm text-error">
                Passwords don&apos;t match.
              </Text>
            ) : null}

            {resetErrorMessage ? (
              <Text className="mt-3 text-center font-body-sm text-body-sm text-error">
                {resetErrorMessage}
              </Text>
            ) : null}

            {resendErrorMessage ? (
              <Text className="mt-3 text-center font-body-sm text-body-sm text-error">
                {resendErrorMessage}
              </Text>
            ) : null}

            <View className="mt-6">
              <PrimaryButton
                label="Reset Password"
                onPress={handleConfirm}
                loading={reset.isPending}
                disabled={!canSubmit}
              />
            </View>

            <View className="mt-4 items-center">
              <Pressable
                onPress={handleResend}
                disabled={!canResend}
                accessibilityRole="button"
                accessibilityLabel={
                  cooldown > 0 ? `Resend code in ${cooldown} seconds` : "Resend code"
                }
                accessibilityState={{ disabled: !canResend }}
                hitSlop={8}
              >
                <Text
                  className={`font-body-md text-body-md ${
                    canResend ? "text-accent-primary" : "text-text-secondary"
                  }`}
                >
                  {cooldown > 0 ? `Resend code in ${cooldown}s` : "Resend code"}
                </Text>
              </Pressable>
            </View>

            <View className="mt-8 flex-row justify-center">
              <Text className="font-body-md text-body-md text-text-secondary">
                Remembered your password?{" "}
              </Text>
              <Link href="/(auth)/login" replace>
                <Text className="font-body-md text-body-md text-accent-primary">Log in</Text>
              </Link>
            </View>
          </View>
        </KeyboardAvoidingView>
      </AuthSplit>
    </SafeAreaView>
  );
}
