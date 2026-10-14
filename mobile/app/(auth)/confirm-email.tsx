import { Link, Redirect, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { PrimaryButton } from "../../components/PrimaryButton";
import { TextField } from "../../components/TextField";
import { useResendConfirmation, useVerifySignup } from "../../hooks/useAuth";
import { apiErrorCode, apiErrorMessage } from "../../lib/api";

// Value sourcing (spec 0004): a fixed client side policy, not fetched
// from anywhere -- Supabase enforces its own rate limit server side too.
const RESEND_COOLDOWN_SECONDS = 30;

export default function ConfirmEmail() {
  const { email, autoResend } = useLocalSearchParams<{ email?: string; autoResend?: string }>();
  const [code, setCode] = useState("");
  const [cooldown, setCooldown] = useState(0);
  const verify = useVerifySignup();
  const resend = useResendConfirmation();

  useEffect(() => {
    if (!email || autoResend !== "true") return;
    // AC-16: arriving here from the login flow's "email not confirmed"
    // case fires one resend automatically so a code is already on its
    // way -- the signup flow already has one in flight from
    // /auth/signup itself, so autoResend defaults false there.
    resend.mutate({ email });
    setCooldown(RESEND_COOLDOWN_SECONDS);
    // Fire once on mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => setCooldown((current) => Math.max(0, current - 1)), 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  // This route is only ever reached with a real email carried from a live
  // signup or login attempt, never bookmarked or deep linked to directly.
  if (!email) {
    return <Redirect href="/(auth)/login" />;
  }

  const handleConfirm = () => {
    verify.mutate({ email, token: code });
  };

  const handleResend = () => {
    resend.mutate({ email });
    setCooldown(RESEND_COOLDOWN_SECONDS);
  };

  const canResend = cooldown === 0 && !resend.isPending;

  // AC-14: wrong vs expired both show an inline error, distinguished by
  // error_code -- the backend passes Supabase's own code through rather
  // than committing to specific copy for every value it might send.
  const verifyErrorMessage = verify.isError
    ? apiErrorCode(verify.error) === "otp_expired"
      ? "That code has expired. Request a new one."
      : "That code isn't right. Check it and try again."
    : null;

  return (
    <SafeAreaView className="flex-1 bg-bg-primary">
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        className="flex-1"
      >
        <View className="flex-1 justify-center px-6">
          <Text className="text-center font-display-lg text-display-lg text-text-primary">
            Confirm Your Email
          </Text>
          <Text className="mt-2 text-center font-body-md text-body-md text-text-secondary">
            Enter the 6-digit code we sent to {email}.
          </Text>

          <View className="mt-8 gap-3">
            <TextField
              leadingIcon="key-outline"
              placeholder="6-digit code"
              value={code}
              onChangeText={setCode}
              keyboardType="number-pad"
              maxLength={6}
              accessibilityLabel="Confirmation code"
            />
          </View>

          {verifyErrorMessage ? (
            <Text className="mt-3 text-center font-body-sm text-body-sm text-error">
              {verifyErrorMessage}
            </Text>
          ) : null}

          {resend.isError ? (
            <Text className="mt-3 text-center font-body-sm text-body-sm text-error">
              {apiErrorMessage(resend.error, "Couldn't send a new code. Try again.")}
            </Text>
          ) : null}

          <View className="mt-6">
            <PrimaryButton
              label="Confirm"
              onPress={handleConfirm}
              loading={verify.isPending}
              disabled={code.length !== 6}
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
              Already have an account?{" "}
            </Text>
            <Link href="/(auth)/login" replace>
              <Text className="font-body-md text-body-md text-accent-primary">Log in instead</Text>
            </Link>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
