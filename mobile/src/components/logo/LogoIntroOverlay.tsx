import React, { useCallback, useEffect, useRef, useState } from "react";
import { Image, Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { TrickeeLogoAnimated } from "./TrickeeLogoAnimated";
import { motionColors, motionDurations } from "../../motion/tokens";
import { fontFamily } from "../../theme/typography";

const INTRO_SEEN_KEY = "trickee.motion.intro.seen.v1";

export function LogoIntroOverlay({ onComplete }: { onComplete: () => void }) {
  const { width, height } = useWindowDimensions();
  const finished = useRef(false);
  const [firstLaunch, setFirstLaunch] = useState<boolean | null>(null);
  const [canSkip, setCanSkip] = useState(false);

  useEffect(() => {
    let active = true;
    AsyncStorage.getItem(INTRO_SEEN_KEY)
      .then((seen) => { if (active) setFirstLaunch(seen !== "yes"); })
      .catch(() => { if (active) setFirstLaunch(true); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (firstLaunch === null) return;
    const timeout = setTimeout(() => setCanSkip(true), 600);
    return () => clearTimeout(timeout);
  }, [firstLaunch]);

  const finish = useCallback(() => {
    if (finished.current) return;
    finished.current = true;
    AsyncStorage.setItem(INTRO_SEEN_KEY, "yes").catch(() => undefined);
    onComplete();
  }, [onComplete]);

  return (
    <View style={styles.overlay} accessibilityViewIsModal>
      {firstLaunch === null && (
        <Image
          source={require("../../../assets/logo/trickee_logo.png")}
          resizeMode="contain"
          accessibilityLabel="Trickee logo"
          style={{ width: Math.min(340, width * 0.78, height * 0.56), height: Math.min(340, width * 0.78, height * 0.56) }}
        />
      )}
      {firstLaunch !== null && (
        <TrickeeLogoAnimated
          size={Math.min(340, width * 0.78, height * 0.56)}
          mode="splash"
          speed={firstLaunch ? 1 : motionDurations.introTotal / 900}
          onComplete={finish}
        />
      )}
      {canSkip && (
        <Pressable style={styles.skip} onPress={finish} accessibilityRole="button" accessibilityLabel="Skip Trickee introduction">
          <Text style={styles.skipText}>SKIP INTRO</Text>
        </Pressable>
      )}
      <View pointerEvents="none" style={styles.footer}>
        <Text style={styles.meta}>TRICKEE / ROUTE INTELLIGENCE</Text>
        <View style={styles.line} />
        <Text style={styles.meta}>SIGNAL CONNECTED</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFillObject, zIndex: 1000, alignItems: "center", justifyContent: "center", backgroundColor: motionColors.ink },
  skip: { position: "absolute", top: 42, right: 16, minWidth: 88, minHeight: 48, alignItems: "center", justifyContent: "center" },
  skipText: { color: "rgba(255,255,255,0.7)", fontFamily: fontFamily.technical, fontSize: 9, letterSpacing: 1 },
  footer: { position: "absolute", bottom: 28, left: 16, right: 16, flexDirection: "row", alignItems: "center", gap: 12 },
  meta: { color: "rgba(255,255,255,0.45)", fontFamily: fontFamily.technical, fontSize: 6, letterSpacing: 0.8 },
  line: { flex: 1, height: 1, backgroundColor: motionColors.yellow, opacity: 0.5 },
});
