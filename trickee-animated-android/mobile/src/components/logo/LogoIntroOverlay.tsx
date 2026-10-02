import React, { useCallback, useRef } from "react";
import { StyleSheet, useWindowDimensions, View } from "react-native";
import { TrickeeLogoAnimated } from "./TrickeeLogoAnimated";
import { motionColors } from "../../motion/tokens";

export function LogoIntroOverlay({ onComplete }: { onComplete: () => void }) {
  const { width, height } = useWindowDimensions();
  const finished = useRef(false);
  const finish = useCallback(() => {
    if (finished.current) return;
    finished.current = true;
    onComplete();
  }, [onComplete]);

  return (
    <View style={styles.overlay} accessibilityViewIsModal>
      <TrickeeLogoAnimated
        size={Math.min(340, width * 0.78, height * 0.56)}
        mode="splash"
        onComplete={finish}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFillObject, zIndex: 1000, alignItems: "center", justifyContent: "center", backgroundColor: motionColors.ink },
});
