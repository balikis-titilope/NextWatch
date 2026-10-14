import { router } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { PrimaryButton } from "../components/PrimaryButton";
import { TextField } from "../components/TextField";
import { useDeactivateAccount } from "../hooks/useAuth";
import { apiErrorMessage } from "../lib/api";
import { useSessionStore } from "../store/sessionStore";

// spec 0009 AC-1/AC-2: Profile's "Delete account" action, separate from
// Sign Out, requiring the current password and the literal word DELETE
// before anything happens.
export default function DeleteAccountScreen() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const deactivate = useDeactivateAccount();
  const clearSession = useSessionStore((state) => state.clearSession);

  const canSubmit = password.length > 0 && confirm === "DELETE";

  const handleSubmit = () => {
    deactivate.mutate({ password, confirm });
  };

  const handleReturnToSignIn = async () => {
    await clearSession();
    router.replace("/(auth)/login");
  };

  if (deactivate.isSuccess) {
    return (
      <SafeAreaView className="flex-1 bg-bg-primary">
        <View className="flex-1 justify-center px-6">
          <Text className="text-center font-display-lg text-display-lg text-text-primary">
            Account deletion requested
          </Text>
          <Text className="mt-2 text-center font-body-md text-body-md text-text-secondary">
            Your account has been deactivated and signed out everywhere. It will be permanently
            deleted in 30 days. Log back in before then to cancel and restore it.
          </Text>
          <View className="mt-6">
            <PrimaryButton label="Return to Sign In" onPress={handleReturnToSignIn} />
          </View>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-bg-primary">
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        className="flex-1"
      >
        <View className="flex-1 justify-center px-6">
          <Text className="text-center font-display-lg text-display-lg text-text-primary">
            Delete Account
          </Text>
          <Text className="mt-2 text-center font-body-md text-body-md text-text-secondary">
            This deactivates your account immediately and permanently deletes it, along with your
            ratings and notifications, 30 days later. Logging back in before then cancels the
            deletion.
          </Text>

          <View className="mt-8 gap-3">
            <TextField
              leadingIcon="lock-closed-outline"
              placeholder="Current Password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              accessibilityLabel="Current Password"
            />
            <TextField
              leadingIcon="warning-outline"
              placeholder='Type "DELETE" to confirm'
              value={confirm}
              onChangeText={setConfirm}
              accessibilityLabel="Type DELETE to confirm"
            />
          </View>

          {deactivate.isError ? (
            <Text className="mt-3 text-center font-body-sm text-body-sm text-error">
              {apiErrorMessage(deactivate.error, "Couldn't delete your account. Try again.")}
            </Text>
          ) : null}

          <View className="mt-6">
            <PrimaryButton
              label="Delete My Account"
              onPress={handleSubmit}
              loading={deactivate.isPending}
              disabled={!canSubmit}
            />
          </View>

          <View className="mt-4 items-center">
            <Pressable
              onPress={() => router.back()}
              accessibilityRole="button"
              accessibilityLabel="Cancel"
              hitSlop={8}
            >
              <Text className="font-body-md text-body-md text-accent-primary">Cancel</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
