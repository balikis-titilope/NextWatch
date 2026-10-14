import { Ionicons } from "@expo/vector-icons";
import { Text, View } from "react-native";
import { useTheme } from "../../hooks/useTheme";
import { passwordRequirementList } from "../../lib/validation";

// Checklist under the signup password field: grey outline while a rule is
// unmet, a green filled tick and struck through text once it is met.
export function PasswordRequirements({ password }: { password: string }) {
  const theme = useTheme();
  return (
    <View className="mt-3 gap-2" accessibilityLabel="Password requirements">
      {passwordRequirementList(password).map(({ label, met }) => (
        <View
          key={label}
          className="flex-row items-center gap-2"
          accessibilityLabel={`${label}: ${met ? "met" : "not met"}`}
        >
          <Ionicons
            name={met ? "checkmark-circle" : "checkmark-circle-outline"}
            size={20}
            color={met ? theme.success : theme["text-secondary"]}
          />
          <Text
            className={`font-body-md text-body-md ${met ? "text-success" : "text-text-secondary"}`}
            style={met ? { textDecorationLine: "line-through" } : undefined}
          >
            {label}
          </Text>
        </View>
      ))}
    </View>
  );
}
