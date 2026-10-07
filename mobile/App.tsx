/**
 * Trickee GPS-First EV Intelligence — App Entry Point
 */
import React, { useCallback, useEffect, useState } from "react";
import {
  AccessibilityInfo,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AuthProvider } from "./src/context/AuthContext";
import { LiveDataProvider } from "./src/context/LiveDataContext";
import AppNavigator from "./src/navigation/AppNavigator";
import AppErrorBoundary from "./src/components/AppErrorBoundary";
import LogoIntroOverlay from "./src/components/logo/LogoIntroOverlay";
import {
  INTRO_RELEASE_VERSION,
  INTRO_SEEN_KEY,
  type IntroMode,
  selectIntroMode,
} from "./src/services/introPresentation";
import { motionColors } from "./src/motion/tokens";
import { fontFamily } from "./src/theme/typography";

const App: React.FC = () => {
  const [introMode, setIntroMode] = useState<IntroMode | null>(null);

  useEffect(() => {
    let mounted = true;
    Promise.all([
      AsyncStorage.getItem(INTRO_SEEN_KEY),
      AccessibilityInfo.isReduceMotionEnabled().catch(() => false),
    ]).then(([seenVersion, reducedMotion]) => {
      if (!mounted) return;
      setIntroMode(selectIntroMode({
        seenVersion,
        currentVersion: INTRO_RELEASE_VERSION,
        reducedMotion,
      }));
    }).catch(() => {
      if (mounted) setIntroMode('full');
    });
    return () => { mounted = false; };
  }, []);

  const finishIntro = useCallback(() => {
    setIntroMode('hidden');
    AsyncStorage.setItem(INTRO_SEEN_KEY, INTRO_RELEASE_VERSION).catch(() => {
      // Presentation state may replay next launch; auth and telemetry remain untouched.
    });
  }, []);

  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <AuthProvider>
          <AppErrorBoundary>
            <LiveDataProvider>
              <StatusBar
                translucent
                backgroundColor="transparent"
                barStyle="light-content"
              />
              <AppNavigator />
              {introMode === null ? (
                <View style={styles.introDecision} accessibilityLabel="Preparing Trickee GPS Driver">
                  <Text style={styles.introDecisionBrand}>TRICKEE GPS DRIVER</Text>
                  <Text style={styles.introDecisionCopy}>Preparing your route intelligence…</Text>
                </View>
              ) : introMode !== 'hidden' ? (
                <LogoIntroOverlay
                  mode={introMode}
                  onComplete={finishIntro}
                  fallbackMs={5750}
                />
              ) : null}
            </LiveDataProvider>
          </AppErrorBoundary>
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  introDecision: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 999,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
    backgroundColor: motionColors.ink,
  },
  introDecisionBrand: {
    color: motionColors.cyan,
    fontFamily: fontFamily.technical,
    fontSize: 10,
    letterSpacing: 2.4,
  },
  introDecisionCopy: {
    marginTop: 14,
    color: motionColors.text,
    fontFamily: fontFamily.bodyMedium,
    fontSize: 15,
  },
});

export default App;
