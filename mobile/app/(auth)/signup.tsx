import { Link } from "expo-router";
import { useState } from "react";
import { Image, KeyboardAvoidingView, Linking, Platform, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { logo } from "../../assets";
import { AuthSplit } from "../../components/auth/AuthSplit";
import { PasswordRequirements } from "../../components/auth/PasswordRequirements";
import { PrimaryButton } from "../../components/PrimaryButton";
import { TextField } from "../../components/TextField";
import { PRIVACY_POLICY_URL, TERMS_URL } from "../../constants/config";
import { useSignup } from "../../hooks/useAuth";
import { apiErrorMessage } from "../../lib/api";
import { checkPasswordRequirements } from "../../lib/validation";

export default function Signup() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordFocused, setPasswordFocused] = useState(false);
  const signup = useSignup();
  const passwordCheck = checkPasswordRequirements(password);

  const handleSubmit = () => {
    signup.mutate({ email, password });
  };

  return (
    <SafeAreaView className="flex-1 bg-bg-primary">
      <AuthSplit variant="signup">
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
              Join NextWatch
            </Text>
            <Text className="mt-2 text-center font-body-md text-body-md text-text-secondary">
              Discover your next favorite story.
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
                onFocus={() => setPasswordFocused(true)}
                onBlur={() => setPasswordFocused(false)}
              />
            </View>

            {/* Shown while the field is focused, and stays up after blur
              until every rule is met so the user can see what is missing. */}
            {passwordFocused || (password.length > 0 && !passwordCheck.valid) ? (
              <PasswordRequirements password={password} />
            ) : null}

            {signup.isError ? (
              <Text className="mt-3 text-center font-body-sm text-body-sm text-error">
                {apiErrorMessage(signup.error, "Couldn't create your account. Try again.")}
              </Text>
            ) : null}

            {/* spec 0009 AC-2/AC-4: opened in the system browser (Linking), never a
              native reimplementation of the hosted text -- see the legal-screens
              child spec's Decision. */}
            <Text className="mt-4 text-center font-body-sm text-body-sm text-text-secondary">
              By creating an account, you agree to our{" "}
              <Text
                onPress={() => Linking.openURL(TERMS_URL)}
                accessibilityRole="link"
                className="text-accent-primary"
              >
                Terms of Service
              </Text>{" "}
              and{" "}
              <Text
                onPress={() => Linking.openURL(PRIVACY_POLICY_URL)}
                accessibilityRole="link"
                className="text-accent-primary"
              >
                Privacy Policy
              </Text>
              .
            </Text>

            <View className="mt-6">
              <PrimaryButton
                label="Create Account"
                onPress={handleSubmit}
                loading={signup.isPending}
                disabled={!passwordCheck.valid}
              />
            </View>

            <View className="mt-8 flex-row justify-center">
              <Text className="font-body-md text-body-md text-text-secondary">
                Already have an account?{" "}
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
