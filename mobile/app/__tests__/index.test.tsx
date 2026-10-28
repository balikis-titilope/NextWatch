import { render } from "@testing-library/react-native";
import { useSessionStore } from "../../store/sessionStore";
import Index from "../index";

const mockRedirect = jest.fn((_props: { href: string }) => null);

jest.mock("expo-router", () => ({
  Redirect: (props: { href: string }) => mockRedirect(props),
}));

describe("Index", () => {
  beforeEach(() => {
    useSessionStore.setState({ launchRoute: null });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test("renders nothing while the launch decision hasn't resolved yet", async () => {
    const { toJSON } = await render(<Index />);

    expect(toJSON()).toBeNull();
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  test("redirects to the tabs when the launch check resolves onboarding as complete", async () => {
    useSessionStore.setState({ launchRoute: "/(tabs)" });

    await render(<Index />);

    expect(mockRedirect).toHaveBeenCalledWith({ href: "/(tabs)" });
  });

  test("redirects to onboarding when the launch check resolves onboarding as incomplete", async () => {
    useSessionStore.setState({ launchRoute: "/onboarding" });

    await render(<Index />);

    expect(mockRedirect).toHaveBeenCalledWith({ href: "/onboarding" });
  });

  test("redirects to log in when the launch check can't confirm a session", async () => {
    useSessionStore.setState({ launchRoute: "/(auth)/login" });

    await render(<Index />);

    expect(mockRedirect).toHaveBeenCalledWith({ href: "/(auth)/login" });
  });
});
