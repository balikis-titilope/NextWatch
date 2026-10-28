import { Link, router } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AuthSplit } from "../../components/auth/AuthSplit";
import { PrimaryButton } from "../../components/PrimaryButton";
import { TextField } from "../../components/TextField";
import { useRequestPasswordReset } from "../../hooks/useAuth";
import { apiErrorCode, ApiError } from "../../lib/api";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const request = useRequestPasswordReset();

  const handleSubmit = () => {
    request.mutate(
      { email },
      {
        // AC-2: only navigate forward once Supabase has actually sent a
        // code -- a 404 (AC-3) or any other failure keeps the user here.
        onSuccess: () => {
          router.push({ pathname: "/(auth)/reset-password", params: { email } });
        },
      },
    );
  };

  // AC-3: a named error_code, same {message, error_code} shape as the
  // signup/login auth errors. AC-9/AC-14: 429 carries a plain string
  // detail instead (backend/main.py), so the client branches on the
  // response's HTTP status for that one.
  const errorMessage = request.isError
    ? apiErrorCode(request.error) === "email_not_found"
      ? "No account found with that email."
      : request.error instanceof ApiError && request.error.status === 429
        ? "Too many requests. Wait a bit before trying again."
        : "Something went wrong. Try again."
    : null;

  return (
    <SafeAreaView className="flex-1 bg-bg-primary">
      <AuthSplit variant="forgot">
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          className="flex-1"
        >
          <View className="flex-1 justify-center px-6 web:w-full web:max-w-[420px] web:self-center">
            <Text className="text-center font-display-lg text-display-lg text-text-primary">
              Reset Your Password
            </Text>
            <Text className="mt-2 text-center font-body-md text-body-md text-text-secondary">
              Enter your account email and we&apos;ll send you a code to reset your password.
            </Text>

            <View className="mt-8 gap-3">
              <TextField
                leadingIcon="mail-outline"
                placeholder="Email Address"
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                accessibilityLabel="Email Address"
              />
            </View>

            {errorMessage ? (
              <Text className="mt-3 text-center font-body-sm text-body-sm text-error">
                {errorMessage}
              </Text>
            ) : null}

            <View className="mt-6">
              <PrimaryButton
                label="Send Reset Code"
                onPress={handleSubmit}
                loading={request.isPending}
                disabled={email.length === 0}
              />
            </View>

            <View className="mt-8 flex-row justify-center">
              <Text className="font-body-md text-body-md text-text-secondary">Remembered it? </Text>
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
