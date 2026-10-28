import { router, useFocusEffect } from "expo-router";
import Head from "expo-router/head";
import { useCallback, useEffect, useRef } from "react";
import { type LayoutChangeEvent, ScrollView, View } from "react-native";
import { LandingCallout } from "../components/landing/LandingCallout";
import { LandingDifference } from "../components/landing/LandingDifference";
import { LandingFaq } from "../components/landing/LandingFaq";
import { LandingFooter } from "../components/landing/LandingFooter";
import { LandingGlobalCinema } from "../components/landing/LandingGlobalCinema";
import { LandingHero } from "../components/landing/LandingHero";
import { LandingHowItWorks } from "../components/landing/LandingHowItWorks";
import { LandingNav } from "../components/landing/LandingNav";
import { LANDING_DESCRIPTION, LANDING_TITLE, type NavSection } from "../constants/landingContent";
import { SITE_URL } from "../lib/siteConfig";
import { trackEvent } from "../lib/telemetry";
import { useSessionStore } from "../store/sessionStore";

type Cta = "nav_join" | "nav_login" | "hero_start";

// Web only (spec 0011). Native keeps app/index.tsx. The landing page shows
// at once; the launch check (spec 0004) runs in the background, and only a
// logged in result redirects, once, while "/" is still the focused screen.
export default function LandingPage() {
  const launchRoute = useSessionStore((state) => state.launchRoute);
  const scrollRef = useRef<ScrollView>(null);
  const positions = useRef<Partial<Record<NavSection, number>>>({});
  const focused = useRef(false);
  const settled = useRef(false);

  useEffect(() => {
    trackEvent("landing_viewed");
  }, []);

  // Once the visitor leaves "/", no later launch result may pull them back.
  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      return () => {
        focused.current = false;
        settled.current = true;
      };
    }, []),
  );

  useEffect(() => {
    if (settled.current || !focused.current) return;
    // Logged out, failed and timed out all arrive as the login route: stay.
    if (!launchRoute || launchRoute === "/(auth)/login") return;
    settled.current = true;
    router.replace(launchRoute);
  }, [launchRoute]);

  const trackCta = (cta: Cta) => trackEvent("landing_cta_clicked", { cta });

  const scrollTo = (section: NavSection) => {
    const y = section === "top" ? 0 : (positions.current[section] ?? 0);
    scrollRef.current?.scrollTo({ y, animated: true });
  };

  const track = (section: NavSection) => (event: LayoutChangeEvent) => {
    positions.current[section] = event.nativeEvent.layout.y;
  };

  return (
    <View className="flex-1 bg-bg-primary">
      <Head>
        <title>{LANDING_TITLE}</title>
        <meta name="description" content={LANDING_DESCRIPTION} />
        <meta property="og:type" content="website" />
        <meta property="og:site_name" content="NextWatch" />
        <meta property="og:title" content={LANDING_TITLE} />
        <meta property="og:description" content={LANDING_DESCRIPTION} />
        <meta property="og:image" content={`${SITE_URL ?? ""}/landing-share.png`} />
        {SITE_URL ? <link rel="canonical" href={`${SITE_URL}/`} /> : null}
        {SITE_URL ? <meta property="og:url" content={`${SITE_URL}/`} /> : null}
        <meta name="twitter:card" content="summary_large_image" />
      </Head>
      <LandingNav onNavigate={scrollTo} onCta={trackCta} />
      <ScrollView ref={scrollRef}>
        <LandingHero onCta={() => trackCta("hero_start")} />
        <LandingCallout />
        <LandingDifference onLayout={track("features")} />
        <LandingGlobalCinema />
        <LandingHowItWorks onLayout={track("how")} />
        <LandingFaq />
        <LandingFooter onFeatures={() => scrollTo("features")} />
      </ScrollView>
    </View>
  );
}
