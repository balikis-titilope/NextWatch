import { Image } from "react-native";
import { logo } from "../assets";

// Logo-only mark for the native stack headers (Notifications, Delete Account),
// which keep their own title; tab screens use AppHeader's full lockup.
export function AppHeaderLogo() {
  return (
    <Image
      source={logo}
      accessibilityLabel="NextWatch logo"
      style={{ width: 28, height: 28 }}
      className="rounded-lg"
    />
  );
}
