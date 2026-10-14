import { router } from "expo-router";
import { Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { PrimaryButton } from "../components/PrimaryButton";
import { useReactivateAccount } from "../hooks/useAuth";
import { apiErrorMessage } from "../lib/api";
import { useSessionStore } from "../store/sessionStore";

// spec 0009 AC-4/AC-5: reached after a successful login (or relaunch, see
// lib/launchRouting.ts) when GET /me's deactivated_at is set -- the
// account was scheduled for deletion and is still within its 30 day
// grace period. A valid session already exists at this point (login/
// relaunch already completed), so both actions below have a bearer
// token to call with.
export default function ReactivateScreen() {
  const reactivate = useReactivateAccount();
  const clearSession = useSessionStore((state) => state.clearSession);

  const handleDecline = async () => {
    // AC-5: choosing not to reactivate leaves the account signed out and
    // still scheduled for deletion -- the same local sign-out any other
    // session clear uses, no server call (deactivation already happened
    // whenever the account was originally deleted).
    await clearSession();
    router.replace("/(auth)/login");
  };

  return (
    <SafeAreaView className="flex-1 bg-bg-primary">
      <View className="flex-1 justify-center px-6">
        <Text className="text-center font-display-lg text-display-lg text-text-primary">
          Welcome back
        </Text>
        <Text className="mt-2 text-center font-body-md text-body-md text-text-secondary">
          Your account is scheduled for deletion and will be permanently removed soon. Want to keep
          it?
        </Text>

        {reactivate.isError ? (
          <Text className="mt-3 text-center font-body-sm text-body-sm text-error">
            {apiErrorMessage(reactivate.error, "Couldn't restore your account. Try again.")}
          </Text>
        ) : null}

        <View className="mt-6">
          <PrimaryButton
            label="Reactivate My Account"
            onPress={() => reactivate.mutate()}
            loading={reactivate.isPending}
          />
        </View>

        <View className="mt-4 items-center">
          <Pressable
            onPress={handleDecline}
            accessibilityRole="button"
            accessibilityLabel="Not now"
            hitSlop={8}
          >
            <Text className="font-body-md text-body-md text-text-secondary">Not now</Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}
