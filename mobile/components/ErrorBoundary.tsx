import { Component, type ReactNode } from "react";
import { View, Text } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { PrimaryButton } from "./PrimaryButton";
import { queryClient } from "../lib/queryClient";
import { captureError } from "../lib/telemetry";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    captureError(error);
  }

  handleRetry = () => {
    // A plain hasError reset would re-render the same subtree that just
    // threw; clear the query cache and remount from root instead.
    this.setState({ hasError: false });
    queryClient.clear();
    router.replace("/");
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <SafeAreaView className="flex-1 bg-bg-primary">
        <View className="flex-1 items-center justify-center px-6">
          <Text
            accessibilityRole="header"
            className="text-center font-display-md text-display-md text-text-primary"
          >
            Something went wrong
          </Text>
          <Text className="mt-2 text-center font-body-md text-body-md text-text-secondary">
            The app hit an unexpected error. Your data is safe, try again.
          </Text>
          <View className="mt-6 w-full">
            <PrimaryButton label="Try again" onPress={this.handleRetry} />
          </View>
        </View>
      </SafeAreaView>
    );
  }
}
