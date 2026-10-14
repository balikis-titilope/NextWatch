import { Link } from "expo-router";
import { useState } from "react";
import { Image, KeyboardAvoidingView, Platform, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { logo } from "../../assets";
import { AuthSplit } from "../../components/auth/AuthSplit";
import { PrimaryButton } from "../../components/PrimaryButton";
import { TextField } from "../../components/TextField";
import { useLogin } from "../../hooks/useAuth";
import { apiErrorCode, apiErrorMessage } from "../../lib/api";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const login = useLogin();

  const handleSubmit = () => {
    login.mutate({ email, password });
  };

  // AC-16: an unconfirmed account gets a distinguishing message and a way
  // forward, not the generic "invalid credentials" copy -- a fresh code
  // is already on its way by the time confirm-email opens (autoResend).
  const emailNotConfirmed = login.isError && apiErrorCode(login.error) === "email_not_confirmed";

  return (
    <SafeAreaView className="flex-1 bg-bg-primary">
      <AuthSplit variant="login">
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          className="flex-1"
        >
          <View className="flex-1 justify-center px-6 web:w-full web:max-w-[420px] web:self-center">
            <Image
              source={logo}
              style={{ width: 64, height: 64 }}
              className="mb-6 self-center rounded-xl"
            />

            <Text className="text-center font-display-lg text-display-lg text-text-primary">
              Welcome Back
            </Text>
            <Text className="mt-2 text-center font-body-md text-body-md text-text-secondary">
              Sign in to continue to NextWatch.
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
              <TextField
                leadingIcon="lock-closed-outline"
                placeholder="Password"
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                accessibilityLabel="Password"
              />
            </View>

            <View className="mt-3 items-end">
              <Link href="/(auth)/forgot-password">
                <Text className="font-body-sm text-body-sm text-accent-primary">
                  Forgot password?
                </Text>
              </Link>
            </View>

            {emailNotConfirmed ? (
              <View className="mt-3 items-center">
                <Text className="text-center font-body-sm text-body-sm text-error">
                  {apiErrorMessage(login.error, "Confirm your email before logging in.")}
                </Text>
                <Link
                  href={{
                    pathname: "/(auth)/confirm-email",
                    params: { email, autoResend: "true" },
                  }}
                  className="mt-1"
                >
                  <Text className="font-body-sm text-body-sm text-accent-primary">
                    Confirm your email
                  </Text>
                </Link>
              </View>
            ) : login.isError ? (
              <Text className="mt-3 text-center font-body-sm text-body-sm text-error">
                {/* A real "wrong password" already carries that exact message
                  in the response body (backend/auth.py's sign_in). Falling
                  back to that same wording here for every other failure
                  (network error, 503 auth-provider-unavailable, rate
                  limit) would tell the user their password was wrong when
                  it wasn't -- so the fallback stays generic. */}
                {apiErrorMessage(login.error, "Something went wrong. Try again.")}
              </Text>
            ) : null}

            <View className="mt-6">
              <PrimaryButton label="Log In" onPress={handleSubmit} loading={login.isPending} />
            </View>

            <View className="mt-8 flex-row justify-center">
              <Text className="font-body-md text-body-md text-text-secondary">
                Don&apos;t have an account?{" "}
              </Text>
              <Link href="/(auth)/signup" replace>
                <Text className="font-body-md text-body-md text-accent-primary">Sign Up</Text>
              </Link>
            </View>
          </View>
        </KeyboardAvoidingView>
      </AuthSplit>
    </SafeAreaView>
  );
}
